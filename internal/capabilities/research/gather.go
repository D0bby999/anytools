package research

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/staged"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/rag/search"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// gather.go — the gather stage: rounds of searching, then choosing and reading
// the pages the report will stand on.
//
// A round searches the knowledge base, then the web, for a set of queries.
// Deep mode then asks the model whether the material answers the question
// (reflect.go); if not, the gaps it names become the next round's queries, up
// to the mode's round cap. The loop always ends: at the cap, when the model
// says the material is sufficient, when it proposes nothing new, or when its
// answer cannot be read. Postclaw's engine (internal/research/engine.go) is
// the model for this, including the fail-safe on an unreadable reflection.
//
// Web results from every round go into one pool, deduplicated and ranked
// (sources.go), and only the best reach the report. The top pages are then
// read in full, a few at a time.

// fetchParallelism bounds concurrent page reads within one turn.
const fetchParallelism = 4

// gathered is what the gather stage hands to synthesis and verification.
type gathered struct {
	material     []string // enveloped text, in the order synthesis reads it
	sources      []citations.Source
	blocks       map[string]string // citation key → enveloped text, for verify
	kbSources    int
	webSources   int
	kbOnlyReason string
	// engine is "key" (the user's Tavily/Brave), "duckduckgo" (keyless), or "".
	engine        string
	rounds        int
	followUps     []string // queries added by reflection
	openQuestions []string // gaps the last reflection still saw
}

func (g *gathered) addKB(content string, srcs []citations.Source) {
	blocks := splitBlocks(content)
	for _, s := range srcs {
		key := citations.Key(s.Kind, s.ID)
		if _, dup := g.blocks[key]; dup {
			continue
		}
		g.blocks[key] = blocks[key]
		g.sources = append(g.sources, s)
		g.kbSources++
	}
	g.material = append(g.material, content)
}

// gather runs the rounds and assembles the material. The knowledge base goes
// first in every round, so the egress rule (CallTool closes the network gate
// once the learner's text is in context, unless the session allows the web)
// keeps its phase 9 meaning.
func (c *Capability) gather(
	ctx context.Context, tc *runtime.TurnContext, model *staged.Model,
	topic string, subqueries []string, freshness string, limits Limits,
) (gathered, error) {
	end := staged.Stage(tc, StageGather)
	defer end()

	g := gathered{blocks: map[string]string{}}
	book := citations.NewURLBook()
	pool := newCandidatePool()

	hasKey, err := c.search.Available(ctx, tc.Turn.UserID)
	if err != nil {
		return g, fmt.Errorf("check search keys: %w", err)
	}
	keyless := false
	if ks, ok := c.search.(tools.KeylessSearcher); ok {
		keyless = ks.Keyless()
	}
	webPossible := hasKey || keyless
	switch {
	case hasKey:
		g.engine = "key"
	case keyless:
		g.engine = search.ProviderDuckDuckGo
		c.observe(tc, "no search key is connected, so the web is searched through DuckDuckGo")
	}

	// With the web in play the knowledge base gets half the budget, so a
	// generous knowledge base cannot crowd every web source out of a quick
	// report; without it, the knowledge base gets the lot.
	kbBudget := limits.Sources
	if webPossible {
		kbBudget = (limits.Sources + 1) / 2
	}
	webCtx := search.WithFreshness(ctx, freshness)

	queries := subqueries
	asked := map[string]bool{}
	for _, q := range subqueries {
		asked[strings.ToLower(q)] = true
	}
	webGated, webFailures, webCalls := false, 0, 0

	for round := 1; ; round++ {
		g.rounds = round
		if round > 1 {
			tc.Emit(runtime.Event{
				Type: runtime.EvProgress, Stage: StageGather, Source: c.Name(),
				Content:  fmt.Sprintf("round %d: %s", round, strings.Join(queries, "; ")),
				Metadata: map[string]any{"round": round, "queries": queries},
			})
		}
		if err := c.searchKB(ctx, tc, queries, limits, kbBudget, book, &g); err != nil {
			return g, err
		}
		if webPossible && !webGated {
			for _, q := range queries {
				res, err := tc.CallTool(webCtx, StageGather, "web_search", map[string]any{
					"query": q, "limit": limits.WebPerQuery,
				}, book)
				if errors.Is(err, runtime.ErrToolGated) {
					webGated = true
					break
				}
				if err != nil {
					return g, err
				}
				webCalls++
				if res.IsError {
					webFailures++
					continue
				}
				pool.add(res.Sources, splitBlocks(res.Content))
			}
		}

		if round == 1 && limits.PaperQueries > 0 && !webGated {
			webGated = c.searchPapers(ctx, tc, queries, limits, book, pool) || webGated
		}
		if round == 1 && limits.ZoteroQueries > 0 && !webGated {
			webGated = c.searchZotero(ctx, tc, queries, limits, book, pool) || webGated
		}

		if round >= limits.Rounds {
			break
		}
		next, gaps := c.reflect(ctx, tc, model, topic, subqueries, g, pool, limits)
		g.openQuestions = gaps
		fresh := make([]string, 0, len(next))
		for _, q := range next {
			if k := strings.ToLower(q); !asked[k] {
				asked[k] = true
				fresh = append(fresh, q)
			}
		}
		if len(fresh) == 0 {
			break
		}
		g.followUps = append(g.followUps, fresh...)
		queries = fresh
	}

	switch {
	case !webPossible:
		g.kbOnlyReason = ReasonNoSearchKey
		c.observe(tc, "no web search is available, so this report uses your knowledge base only")
	case webGated && pool.len() == 0:
		g.kbOnlyReason = ReasonWebOffWithDocuments
		c.observe(tc, "the web stays off once your documents are in play; turn on \"allow web\" to search both")
	case pool.len() == 0 && webFailures > 0 && webFailures == webCalls:
		g.kbOnlyReason = ReasonSearchFailed
		c.observe(tc, "the web search failed, so this report uses your knowledge base only")
	}

	chosen := pool.best(limits.Sources - g.kbSources)
	for _, cand := range chosen {
		g.sources = append(g.sources, cand.source)
		g.blocks[citations.Key(cand.source.Kind, cand.source.ID)] = cand.block
		g.material = append(g.material, cand.block)
		g.webSources++
	}
	if err := c.readPages(ctx, tc, chosen, limits.Fetch, book, &g); err != nil {
		return g, err
	}

	tc.Emit(runtime.Event{
		Type: runtime.EvProgress, Stage: StageGather, Source: c.Name(),
		Content: fmt.Sprintf("%d passages from your documents, %d web sources chosen from %d found, %d round(s)",
			g.kbSources, g.webSources, pool.len(), g.rounds),
		Metadata: map[string]any{
			"kb_sources": g.kbSources, "web_sources": g.webSources, "web_found": pool.len(),
			"rounds": g.rounds, "kb_only_reason": g.kbOnlyReason, "engine": g.engine,
		},
	})
	return g, nil
}

// searchPapers runs paper_search on the first limits.PaperQueries
// sub-questions (learning-depth phase 6). Papers join the same pool as web
// results, ranked academic and one per site. A failure is observed and
// skipped: papers add to a report, they never block one. It reports whether
// the egress gate closed.
func (c *Capability) searchPapers(
	ctx context.Context, tc *runtime.TurnContext, queries []string, limits Limits,
	book *citations.URLBook, pool *candidatePool,
) bool {
	if _, err := tc.Tools.Get("paper_search"); err != nil {
		return false // not wired for this turn
	}
	found, failed := 0, false
	for i, q := range queries {
		if i >= limits.PaperQueries {
			break
		}
		res, err := tc.CallTool(ctx, StageGather, "paper_search", map[string]any{"query": q, "limit": 5}, book)
		if errors.Is(err, runtime.ErrToolGated) {
			return true
		}
		if err != nil || res.IsError {
			failed = true
			continue
		}
		found += len(res.Sources)
		pool.add(res.Sources, splitBlocks(res.Content))
	}
	switch {
	case found > 0:
		c.observe(tc, fmt.Sprintf("searched scholarly papers too: %d found", found))
	case failed:
		c.observe(tc, "the paper search failed, so this report uses web pages and your documents")
	}
	return false
}

// searchZotero runs zotero_search on the first limits.ZoteroQueries
// sub-questions when the learner has connected a Zotero library (up-methods
// phase 20). Like papers, items join the web pool and are ranked with it, so
// they count against the report's source budget and nothing else; a failure
// is observed and skipped. It reports whether the egress gate closed.
func (c *Capability) searchZotero(
	ctx context.Context, tc *runtime.TurnContext, queries []string, limits Limits,
	book *citations.URLBook, pool *candidatePool,
) bool {
	tool, err := tc.Tools.Get("zotero_search")
	if err != nil {
		return false // not wired for this turn
	}
	if z, ok := tool.(interface {
		Connected(context.Context, uuid.UUID) bool
	}); ok && !z.Connected(ctx, tc.Turn.UserID) {
		return false
	}
	found, failed := 0, false
	for i, q := range queries {
		if i >= limits.ZoteroQueries {
			break
		}
		res, err := tc.CallTool(ctx, StageGather, "zotero_search", map[string]any{"query": q, "limit": 5}, book)
		if errors.Is(err, runtime.ErrToolGated) {
			return true
		}
		if err != nil || res.IsError {
			failed = true
			continue
		}
		found += len(res.Sources)
		pool.add(res.Sources, splitBlocks(res.Content))
	}
	switch {
	case found > 0:
		c.observe(tc, fmt.Sprintf("searched your Zotero library too: %d items found", found))
	case failed:
		c.observe(tc, "your Zotero library could not be searched, so this report uses the other sources")
	}
	return false
}

// searchKB runs rag_search for each query until the knowledge-base budget is
// spent. A failing knowledge base (awaiting a reindex, say) is reported, not
// fatal: the web half can still produce a report.
func (c *Capability) searchKB(
	ctx context.Context, tc *runtime.TurnContext, queries []string, limits Limits, budget int,
	book *citations.URLBook, g *gathered,
) error {
	if len(tc.Session.KBIDs) == 0 {
		return nil
	}
	for _, q := range queries {
		if g.kbSources >= budget {
			return nil
		}
		res, err := tc.CallTool(ctx, StageGather, "rag_search", map[string]any{
			"query": q, "limit": min(limits.KBPerQuery, budget-g.kbSources),
		}, book)
		if err != nil {
			if errors.Is(err, runtime.ErrTurnCancelled) {
				return err
			}
			c.observe(tc, "your knowledge base could not be searched: "+shortErr(err))
			return nil
		}
		if res.IsError || len(res.Sources) == 0 {
			continue
		}
		g.addKB(res.Content, res.Sources)
	}
	return nil
}

// readPages reads up to n of the chosen pages in full, fetchParallelism at a
// time, and adds each page's text under its search result's citation id. A
// page that cannot be read keeps its snippet.
func (c *Capability) readPages(
	ctx context.Context, tc *runtime.TurnContext, chosen []*candidate, n int,
	book *citations.URLBook, g *gathered,
) error {
	if n > len(chosen) {
		n = len(chosen)
	}
	if n <= 0 || !tc.ToolAvailable("web_fetch") {
		return nil
	}
	pages := make([]runtime.ToolResult, n)
	errs := make([]error, n)
	sem := make(chan struct{}, fetchParallelism)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			pages[i], errs[i] = tc.CallTool(ctx, StageGather, "web_fetch",
				map[string]any{"url": chosen[i].source.URL}, book)
		}(i)
	}
	wg.Wait()
	for i := 0; i < n; i++ {
		if errors.Is(errs[i], runtime.ErrTurnCancelled) {
			return errs[i]
		}
		if errs[i] != nil || pages[i].IsError {
			continue
		}
		key := citations.Key(chosen[i].source.Kind, chosen[i].source.ID)
		g.blocks[key] = g.blocks[key] + "\n\n" + pages[i].Content
		g.material = append(g.material, pages[i].Content)
	}
	return nil
}
