package research

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
	researchprompts "github.com/D0bby999/anytools/internal/prompts/research"
	"github.com/D0bby999/anytools/internal/rag/search"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// These drive the pipeline with the REAL web_search tool over a fake searcher,
// and scripted rag_search / web_fetch tools, so the egress rule is exercised
// through runtime.TurnContext.CallTool exactly as production runs it. The HTTP
// surface, the database and the BYOK chain are in internal/app's e2e test.

var markerRE = regexp.MustCompile(`\[\[cite:(chunk|url):[A-Za-z0-9_.:-]+\]\]`)

// scriptModel answers each stage by its system prompt. The synthesis cites
// every marker it was shown, plus one it was not.
type scriptModel struct {
	scholarly  bool
	mu         sync.Mutex
	subqueries int
	synthInput string
	// freshness is what decompose answers.
	freshness string
	// reflections counts reflect calls; the first says "not sufficient" with
	// two follow-ups, later ones say "sufficient". badReflect answers prose.
	reflections int
	badReflect  bool
	// neverSatisfied keeps asking for more, with new queries each time.
	neverSatisfied bool
	// citeAll makes synthesis also cite url:1..url:30, including results
	// ranking left out of the material.
	citeAll bool
	// verifyInput is what the claim check was shown; badVerify answers prose.
	verifyInput string
	badVerify   bool
}

func (m *scriptModel) Name() string         { return "stub" }
func (m *scriptModel) DefaultModel() string { return "stub-1" }
func (m *scriptModel) Chat(ctx context.Context, req runtime.ChatRequest) (*runtime.ChatResponse, error) {
	return m.ChatStream(ctx, req, nil)
}

func (m *scriptModel) ChatStream(_ context.Context, req runtime.ChatRequest, onChunk func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
	system, user := req.Messages[0].Content, req.Messages[1].Content
	switch system {
	case researchprompts.Rephrase:
		return &runtime.ChatResponse{Content: `{"topic":"How does RAG reduce hallucination?","title":"RAG and hallucination"}`}, nil
	case researchprompts.Decompose:
		qs := make([]string, 0, m.subqueries)
		for i := 0; i < m.subqueries; i++ {
			qs = append(qs, "sub-question "+string(rune('a'+i)))
		}
		qs = append(qs, qs[0]) // a duplicate the pipeline must drop
		raw, _ := json.Marshal(map[string]any{"subqueries": qs, "freshness": m.freshness, "scholarly": m.scholarly})
		return &runtime.ChatResponse{Content: string(raw)}, nil
	case researchprompts.Reflect:
		m.mu.Lock()
		defer m.mu.Unlock()
		m.reflections++
		if m.badReflect {
			return &runtime.ChatResponse{Content: "I think we should keep going."}, nil
		}
		if m.neverSatisfied {
			n := strconv.Itoa(m.reflections)
			return &runtime.ChatResponse{Content: `{"sufficient":false,"gaps":["gap ` + n + `"],` +
				`"next_queries":["more ` + n + `"]}`}, nil
		}
		if m.reflections == 1 {
			// "sub-question a" repeats an earlier search and must be dropped.
			return &runtime.ChatResponse{Content: `{"sufficient":false,"gaps":["no controlled studies"],` +
				`"next_queries":["follow-up one","follow-up two","sub-question a"]}`}, nil
		}
		return &runtime.ChatResponse{Content: `{"sufficient":true,"gaps":[],"next_queries":[]}`}, nil
	case researchprompts.Verify:
		m.mu.Lock()
		defer m.mu.Unlock()
		m.verifyInput = user
		if m.badVerify {
			return &runtime.ChatResponse{Content: "looks fine to me"}, nil
		}
		// One claim per cited marker in the report: the first supported, the
		// rest partial; plus one citing a source the report never cited, and
		// one with a verdict the check does not know.
		report, _, _ := strings.Cut(strings.TrimPrefix(user, "Check at most 25 claims.\n\nThe report:\n\n"), "\n\nThe cited sources:")
		var claims []map[string]any
		for i, mk := range markerRE.FindAllStringSubmatch(report, -1) {
			id := strings.TrimSuffix(strings.TrimPrefix(mk[0], "[[cite:"), "]]")
			verdict := "partial"
			if i == 0 {
				verdict = "supported"
			}
			claims = append(claims, map[string]any{"claim": "claim " + id, "cites": []string{id}, "verdict": verdict})
		}
		claims = append(claims, map[string]any{"claim": "borrowed", "cites": []string{"url:999"}, "verdict": "supported"})
		if len(claims) > 1 {
			claims = append(claims, map[string]any{"claim": "odd", "cites": claims[0]["cites"], "verdict": "probably"})
		}
		raw, _ := json.Marshal(map[string]any{"claims": claims})
		return &runtime.ChatResponse{Content: string(raw)}, nil
	case researchprompts.Synthesize:
		m.mu.Lock()
		m.synthInput = user
		m.mu.Unlock()
		var b strings.Builder
		b.WriteString("# RAG and hallucination\n\nSummary.")
		seen := map[string]bool{}
		for _, mk := range markerRE.FindAllString(user, -1) {
			if !seen[mk] {
				seen[mk] = true
				b.WriteString(" Claim " + mk + ".")
			}
		}
		b.WriteString(" Invented [[cite:url:99]].")
		if m.citeAll {
			for i := 1; i <= 30; i++ {
				b.WriteString(" All [[cite:url:" + strconv.Itoa(i) + "]].")
			}
		}
		if onChunk != nil {
			onChunk(runtime.StreamChunk{Content: b.String()})
		}
		return &runtime.ChatResponse{Content: b.String()}, nil
	}
	return nil, errors.New("unexpected stage")
}

type resolver struct{ p runtime.ChatProvider }

func (r resolver) ChatFor(context.Context, uuid.UUID, string) (runtime.ChatProvider, error) {
	return r.p, nil
}

type fakeSearcher struct {
	mu        sync.Mutex
	hasKey    bool
	keyless   bool
	err       error
	queries   []string
	freshness []string
	next      int
	urls      []string
}

// Keyless implements tools.KeylessSearcher.
func (s *fakeSearcher) Keyless() bool { return s.keyless }

func (s *fakeSearcher) Available(context.Context, uuid.UUID) (bool, error) { return s.hasKey, nil }

func (s *fakeSearcher) Search(ctx context.Context, _ uuid.UUID, q string, limit int) ([]tools.WebResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.queries = append(s.queries, q)
	s.freshness = append(s.freshness, search.FreshnessFrom(ctx))
	if s.err != nil {
		return nil, s.err
	}
	out := make([]tools.WebResult, 0, limit)
	for i := 0; i < limit; i++ {
		s.next++
		// A distinct site per result, so the per-site cap does not decide
		// how many sources a report gets.
		u := "https://site" + strconv.Itoa(s.next) + ".example/page"
		s.urls = append(s.urls, u)
		out = append(out, tools.WebResult{Title: "Page", URL: u, Snippet: "RAG grounds generation in retrieved text."})
	}
	return out, nil
}

func (s *fakeSearcher) calls() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.queries)
}

type scriptedTool struct {
	name    string
	network bool
	mu      sync.Mutex
	calls   int
	run     func(args map[string]any, in runtime.ToolInput) runtime.ToolResult
}

func (t *scriptedTool) Name() string       { return t.name }
func (t *scriptedTool) NeedsNetwork() bool { return t.network }
func (t *scriptedTool) Definition() runtime.ToolDefinition {
	return runtime.ToolDefinition{Type: "function", Function: runtime.ToolFunctionSchema{Name: t.name}}
}
func (t *scriptedTool) Execute(_ context.Context, args map[string]any, in runtime.ToolInput) (runtime.ToolResult, error) {
	t.mu.Lock()
	t.calls++
	t.mu.Unlock()
	return t.run(args, in), nil
}

func ragReturning(n int) *scriptedTool {
	return &scriptedTool{name: "rag_search", run: func(args map[string]any, _ runtime.ToolInput) runtime.ToolResult {
		limit, _ := args["limit"].(int)
		var srcs []citations.Source
		var parts []string
		for i := 0; i < min(n, limit); i++ {
			id := uuid.NewString()
			srcs = append(srcs, citations.Source{Kind: citations.KindChunk, ID: id, Title: "Notes.pdf", Page: i + 1, DocumentID: "d1"})
			parts = append(parts, tools.Wrap("Notes.pdf", "chunk:"+id, "passage\n\nCite this passage as "+citations.Format(citations.KindChunk, id)))
		}
		return runtime.ToolResult{Retrieved: len(srcs) > 0, Content: strings.Join(parts, "\n\n"), Sources: srcs}
	}}
}

// fetchTool is web_fetch's contract without the network: it refuses any URL the
// turn's search did not return, which is the behaviour the real tool has.
func fetchTool() *scriptedTool {
	return &scriptedTool{name: "web_fetch", network: true, run: func(args map[string]any, in runtime.ToolInput) runtime.ToolResult {
		u, _ := args["url"].(string)
		if in.URLs == nil || !in.URLs.Has(u) {
			return runtime.ToolResult{IsError: true, Content: "not a search result"}
		}
		id := in.URLs.ID(u)
		return runtime.ToolResult{
			Content: tools.Wrap("Page", "url:"+id, "full page text"),
			Sources: []citations.Source{{Kind: citations.KindURL, ID: id, Title: "Page", URL: u}},
		}
	}}
}

type memReports struct {
	mu      sync.Mutex
	reports []Report
	notes   map[uuid.UUID]string
}

func (s *memReports) InsertReport(_ context.Context, r Report) (*Report, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r.ID = uuid.New()
	s.reports = append(s.reports, r)
	return &r, nil
}

func (s *memReports) SetReportNote(_ context.Context, _, id uuid.UUID, note string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.notes == nil {
		s.notes = map[uuid.UUID]string{}
	}
	s.notes[id] = note
	return nil
}

type memMessages struct{ stored []runtime.ChatMessage }

func (m *memMessages) AppendMessage(_ context.Context, msg runtime.ChatMessage) (*runtime.ChatMessage, error) {
	msg.ID = uuid.New()
	m.stored = append(m.stored, msg)
	return &msg, nil
}

type noteBook struct{ titles []string }

func (n *noteBook) WriteNote(_ context.Context, _, _ uuid.UUID, title, _ string) (string, error) {
	n.titles = append(n.titles, title)
	return "note-1", nil
}

type setup struct {
	model    *scriptModel
	searcher *fakeSearcher
	rag      *scriptedTool
	fetch    *scriptedTool
	reports  *memReports
	notes    tools.NoteWriter
	kbs      bool
	allowWeb bool
	mode     string
	// papers registers paper_search (learning depth, phase 6).
	papers tools.PaperSearcher
	// zotero registers zotero_search (up-methods phase 20).
	zotero tools.ZoteroSearcher
}

func (s *setup) run(t *testing.T) (*runtime.TurnContext, []runtime.Event, error) {
	t.Helper()
	registry := runtime.NewToolRegistry()
	registry.Register(s.rag, tools.NewWebSearch(s.searcher), s.fetch)
	if s.papers != nil {
		registry.Register(tools.NewPaperSearch(s.papers))
	}
	if s.zotero != nil {
		registry.Register(tools.NewZoteroSearch(s.zotero))
	}
	sessionID, userID := uuid.New(), uuid.New()
	session := runtime.Session{ID: sessionID, UserID: userID, AllowWeb: s.allowWeb}
	if s.kbs {
		session.KBIDs = []uuid.UUID{uuid.New()}
	}
	bus := runtime.NewStreamBus(uuid.New(), sessionID)
	tc := &runtime.TurnContext{
		Turn:    runtime.Turn{ID: uuid.New(), UserID: userID, SessionID: sessionID, Capability: "research"},
		Session: session, Input: "how does rag reduce hallucination",
		Params: map[string]string{"mode": s.mode}, Bus: bus, Tools: registry,
		Providers: resolver{p: s.model},
	}
	err := New(Config{Reports: s.reports, Messages: &memMessages{}, Search: s.searcher, Notes: s.notes}).Run(context.Background(), tc)
	replay, _, cancel := bus.Subscribe(0)
	cancel()
	return tc, replay, err
}

func newSetup() *setup {
	return &setup{
		model: &scriptModel{subqueries: 3}, searcher: &fakeSearcher{hasKey: true},
		rag: ragReturning(2), fetch: fetchTool(), reports: &memReports{}, mode: ModeQuick,
	}
}

func resultOf(t *testing.T, events []runtime.Event) runtime.Event {
	t.Helper()
	for _, ev := range events {
		if ev.Type == runtime.EvResult {
			return ev
		}
	}
	t.Fatal("no result event")
	return runtime.Event{}
}

func TestQuickResearchWithAKeyAndNoDocumentsUsesTheWeb(t *testing.T) {
	s := newSetup()
	_, events, err := s.run(t)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if s.rag.calls != 0 {
		t.Error("a session with no knowledge bases was searched")
	}
	report := s.reports.reports[0]
	if report.KBOnly || report.Mode != ModeQuick {
		t.Fatalf("report = %+v", report)
	}
	if n := len(report.Sources); n < 2 || n > 5 {
		t.Fatalf("quick report stands on %d sources, want 2..5", n)
	}
	issued := map[string]bool{}
	for _, u := range s.searcher.urls {
		issued[u] = true
	}
	for _, src := range report.Sources {
		if src.Kind != citations.KindURL || !issued[src.URL] {
			t.Fatalf("a citation that does not resolve to a gathered URL: %+v", src)
		}
	}
	if strings.Contains(report.ReportMD, "url:99") {
		t.Fatal("an invented url citation survived")
	}
	if got := resultOf(t, events).Metadata["dropped_citations"]; got != 1 {
		t.Errorf("dropped = %v", got)
	}
	var order []string
	for _, ev := range events {
		if ev.Type == runtime.EvStageStart {
			order = append(order, ev.Stage)
		}
	}
	if strings.Join(order, ",") != "rephrase,decompose,gather,synthesize,verify" {
		t.Fatalf("stages = %v", order)
	}
}

// THE egress rule: documents in context and the web not allowed → the web is
// never queried, and the report says why.
func TestDocumentTextInContextClosesTheWebUnlessAllowed(t *testing.T) {
	s := newSetup()
	s.kbs = true
	_, events, err := s.run(t)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if s.searcher.calls() != 0 || s.fetch.calls != 0 {
		t.Fatalf("the web was queried after the learner's documents were read (search %d, fetch %d)",
			s.searcher.calls(), s.fetch.calls)
	}
	report := s.reports.reports[0]
	if !report.KBOnly || report.KBOnlyReason != ReasonWebOffWithDocuments {
		t.Fatalf("report = %+v", report)
	}
	for _, src := range report.Sources {
		if src.Kind != citations.KindChunk {
			t.Fatalf("a KB-only report cites %+v", src)
		}
	}
	if resultOf(t, events).Metadata["kb_only_reason"] != ReasonWebOffWithDocuments {
		t.Error("the result does not say why the web was not used")
	}

	// Same session with the toggle on: both.
	s2 := newSetup()
	s2.kbs, s2.allowWeb = true, true
	if _, _, err := s2.run(t); err != nil {
		t.Fatal(err)
	}
	kinds := map[string]int{}
	for _, src := range s2.reports.reports[0].Sources {
		kinds[src.Kind]++
	}
	if kinds[citations.KindChunk] == 0 || kinds[citations.KindURL] == 0 || s2.reports.reports[0].KBOnly {
		t.Fatalf("allow-web report sources = %v", kinds)
	}
}

func TestNoSearchKeyRunsKBOnlyAndSaysSo(t *testing.T) {
	s := newSetup()
	s.kbs = true
	s.searcher.hasKey = false
	_, events, err := s.run(t)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if s.searcher.calls() != 0 {
		t.Fatal("searched without a key")
	}
	if r := s.reports.reports[0]; r.KBOnlyReason != ReasonNoSearchKey || len(r.Sources) == 0 {
		t.Fatalf("report = %+v", r)
	}
	if !strings.Contains(s.model.synthInput, "The web was NOT used") {
		t.Error("the synthesis was not told the web was not used")
	}
	said := false
	for _, ev := range events {
		said = said || (ev.Type == runtime.EvObservation && strings.Contains(ev.Content, "knowledge base only"))
	}
	if !said {
		t.Error("the stream never said the report is KB-only")
	}
}

func TestAFailingSearchFallsBackToKBOnly(t *testing.T) {
	s := newSetup()
	s.searcher.err = errors.New("429")
	if _, _, err := s.run(t); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if r := s.reports.reports[0]; r.KBOnlyReason != ReasonSearchFailed {
		t.Fatalf("reason = %q", r.KBOnlyReason)
	}
}

func TestDeepModeCapsSubquestionsAndReadsOnlySearchedPages(t *testing.T) {
	s := newSetup()
	s.mode = ModeDeep
	s.model.subqueries = 9
	s.notes = &noteBook{}
	_, events, err := s.run(t)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	// 6 sub-questions, then one reflection adds two NEW follow-ups (its
	// third repeats a sub-question and is dropped), then the second says
	// the material is sufficient.
	if got := s.searcher.calls(); got != 8 {
		t.Fatalf("searches = %d, want 8 (6 sub-questions + 2 follow-ups)", got)
	}
	if s.model.reflections != 2 {
		t.Fatalf("reflections = %d, want 2 (the second says sufficient)", s.model.reflections)
	}
	if s.fetch.calls != 6 {
		t.Fatalf("fetched %d pages, want the deep cap of 6", s.fetch.calls)
	}
	if n := len(s.reports.reports[0].Sources); n > 20 {
		t.Fatalf("deep report stands on %d sources, cap is 20", n)
	}
	var decomposed []any
	for _, ev := range events {
		if ev.Type == runtime.EvProgress && ev.Stage == StageDecompose {
			decomposed, _ = ev.Metadata["subqueries"].([]any)
			if decomposed == nil {
				if qs, ok := ev.Metadata["subqueries"].([]string); ok {
					for _, q := range qs {
						decomposed = append(decomposed, q)
					}
				}
			}
		}
	}
	if len(decomposed) != 6 {
		t.Fatalf("sub-questions = %d, want the deep cap of 6", len(decomposed))
	}
	if r := s.reports.reports[0]; s.reports.notes[r.ID] != "note-1" {
		t.Fatalf("the report was not saved as a note: %+v", r)
	}
	if resultOf(t, events).Metadata["note_saved"] != true {
		t.Error("note_saved not reported")
	}
}

func TestWithoutANotebookTheReportIsStillStoredAndTheStreamSaysSo(t *testing.T) {
	s := newSetup()
	_, events, err := s.run(t)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.reports.reports) != 1 || s.reports.reports[0].NoteID != "" {
		t.Fatalf("reports = %+v", s.reports.reports)
	}
	said := false
	for _, ev := range events {
		said = said || (ev.Type == runtime.EvObservation && strings.Contains(ev.Content, "notebook is not available"))
	}
	if !said || resultOf(t, events).Metadata["note_saved"] != false {
		t.Error("a missing notebook was not reported honestly")
	}
}
