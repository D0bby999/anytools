package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/researchapi"
	"github.com/D0bby999/anytools/internal/api/solveapi"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/connectors/zotero"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/search"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/tools"
)

// wire_research.go assembles phase 9: the solve and research HTTP surfaces,
// and the BYOK web-search adapter the research capability and web_search
// share.
//
// The capabilities themselves are registered in buildChatRuntime, because they
// run on the SAME orchestrator as chat — one turn table, one bus registry, one
// recovery sweeper. What is here is what sits around them.
//
// The notebook (phase 8's NoteWriter) arrives through the chat runtime, which
// builds it into write_note and research too. Tests pass nil, and then "save to
// notebook" and research's automatic note say plainly that the notebook is not
// available; research_reports is written regardless.

// webDeps are the two network collaborators phase 9 adds. Production passes
// the zero value; the end-to-end test replaces them so it can script the web
// without a live search key or a public page.
type webDeps struct {
	// searcher defaults to the user's own keys through byok.SearchFor.
	searcher tools.WebSearcher
	// fetchClient defaults to security.FetchClient (nil → tools.NewWebFetch's
	// own default).
	fetchClient *http.Client
	// papers is research's paper_search and the related papers (phase 6).
	papers *paperService
	// zotero is research's zotero_search and "Add from Zotero" (up methods,
	// phase 20); it defaults to the allowlisted api.zotero.org client.
	zotero *zotero.Client
}

func (d webDeps) withDefaults(svc *byok.Service, pool *pg.Pool) webDeps {
	if d.papers == nil {
		d.papers = newPaperService(pool, svc)
	}
	if d.zotero == nil {
		d.zotero = newZoteroClient()
	}
	if d.searcher == nil {
		keyless := keylessSearch()
		svc.UseKeylessSearch(keyless != nil)
		d.searcher = byokSearcher{svc: svc, keyless: keyless}
	}
	return d
}

// buildSolveResearch assembles the two handlers over the running chat runtime.
func buildSolveResearch(pool *pg.Pool, rt chatRuntime, kb knowledgeSubsystem, web webDeps) (*solveapi.Handler, *researchapi.Handler) {
	notes := rt.notes

	solveHandler := solveapi.NewHandler(solveapi.Config{
		Starter:   rt.handler,
		Messages:  rt.chatStore,
		Questions: pg.NewQuestionStore(pool),
		Authz:     ownership{authz: kb.authz},
		Notes:     notes,
	})
	researchHandler := researchapi.NewHandler(researchapi.Config{
		Starter:   rt.handler,
		Reports:   pg.NewResearchStore(pool),
		Search:    web.searcher,
		Notes:     notes,
		Knowledge: reportKnowledge{own: ownership{authz: kb.authz}, svc: kb.service},
		Pages:     pageFetcher{client: web.fetchClient},
	})
	return solveHandler, researchHandler
}

// byokSearcher is tools.WebSearcher over the user's search_connections.
//
// Resolved per CALL, like every BYOK lane: a key deleted in Settings between
// two research turns must stop being used by the second.
//
// keyless is DuckDuckGo, the last resort: used when the user has no key, or
// when every key they have failed this query. Nil when the operator turned it
// off (ANYTOOLS_KEYLESS_SEARCH=0).
type byokSearcher struct {
	svc     *byok.Service
	keyless search.Client
}

// keylessSearch is the DuckDuckGo fallback unless the operator disabled it.
func keylessSearch() search.Client {
	if config.Getenv("ANYTOOLS_KEYLESS_SEARCH") == "0" {
		return nil
	}
	return search.NewDuckDuckGo()
}

// Keyless implements tools.KeylessSearcher.
func (s byokSearcher) Keyless() bool { return s.keyless != nil }

// Available implements tools.WebSearcher.
func (s byokSearcher) Available(ctx context.Context, userID uuid.UUID) (bool, error) {
	chain, err := s.svc.SearchFor(ctx, userID)
	if err != nil {
		return false, err
	}
	return chain.Len() > 0, nil
}

// Search implements tools.WebSearcher. The chain walks Tavily and Brave in the
// user's order and benches a key that fails, exactly as the chat chain does.
func (s byokSearcher) Search(ctx context.Context, userID uuid.UUID, query string, limit int) ([]tools.WebResult, error) {
	chain, err := s.svc.SearchFor(ctx, userID)
	if err != nil {
		return nil, err
	}
	if chain.Len() == 0 {
		if s.keyless != nil {
			return s.searchKeyless(ctx, query, limit)
		}
		return nil, tools.ErrNoSearchKey
	}
	var results []search.Result
	err = chain.Do(ctx, func(ctx context.Context, client search.Client, _ byok.Entry[search.Client]) error {
		r, err := client.Search(ctx, query, limit)
		if err != nil {
			return err
		}
		results = r
		return nil
	})
	if err != nil && s.keyless != nil && ctx.Err() == nil {
		// Every key failed (spent quota, an outage): the keyless engine is
		// the last resort rather than losing the web for this query.
		return s.searchKeyless(ctx, query, limit)
	}
	if errors.Is(err, byok.ErrNoRoute) {
		return nil, tools.ErrNoSearchKey
	}
	if err != nil {
		return nil, err
	}
	return webResults(results), nil
}

func (s byokSearcher) searchKeyless(ctx context.Context, query string, limit int) ([]tools.WebResult, error) {
	results, err := s.keyless.Search(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	return webResults(results), nil
}

func webResults(results []search.Result) []tools.WebResult {
	out := make([]tools.WebResult, 0, len(results))
	for _, r := range results {
		out = append(out, tools.WebResult{Title: r.Title, URL: r.URL, Snippet: r.Snippet})
	}
	return out
}

// reportKnowledge adds a research report (and its pages) to a knowledge base,
// through the same ownership check and upload path the Knowledge page uses.
type reportKnowledge struct {
	own ownership
	svc *knowledge.Service
}

func (k reportKnowledge) OwnsKB(ctx context.Context, userID, kbID uuid.UUID) (bool, error) {
	return k.own.OwnsKB(ctx, userID, kbID)
}

func (k reportKnowledge) AddDocument(ctx context.Context, userID, kbID uuid.UUID, filename string, data []byte) error {
	_, err := k.svc.Upload(ctx, userID, kbID, filename, data)
	if knowledge.IsDuplicateDocument(err) {
		return researchapi.ErrAlreadyInKnowledgeBase
	}
	return err
}

// maxPageBytes caps one fetched source page.
const maxPageBytes = 10 << 20

// pageFetcher reads a cited page for a knowledge base. Only HTML and PDF are
// kept: those are what the knowledge base can parse. The URL always comes
// from a stored report's sources, never from the request.
type pageFetcher struct{ client *http.Client }

func (f pageFetcher) FetchPage(ctx context.Context, link string) ([]byte, string, error) {
	client := f.client
	if client == nil {
		client = security.FetchClient(20 * time.Second)
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, link, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; AnyTools/1.0)")
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("page returned HTTP %d", resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/html") && !strings.Contains(ct, "application/pdf") {
		return nil, "", fmt.Errorf("unsupported page type %q", ct)
	}
	data, tooBig, err := blob.ReadAllLimited(resp.Body, maxPageBytes)
	if err != nil {
		return nil, "", err
	}
	if tooBig {
		return nil, "", fmt.Errorf("page is larger than %d MB", maxPageBytes>>20)
	}
	return data, ct, nil
}
