package app

// solve_research_e2e_test.go — phase 9, end to end, through the wiring.
//
// Solve: a photographed algebra problem → plan (the photo reaches the model as
// an image part) → reason → a streamed LaTeX write-up citing the learner's own
// PDF → "turn into a question" and "save to notebook" (which says, truthfully,
// that the notebook is not on this branch yet).
//
// Research: quick mode with a search key cites web results and resolves every
// citation; without a key it runs KB-only and says so; with documents in play
// and "allow web" off the web is never queried; a CHAT turn never sees a web
// tool, even with "allow web" on.
//
// The model is a scripted OpenAI-compatible upstream reached through the real
// BYOK chain (as grounded_chat_e2e_test.go does it). The web is scripted at the
// webDeps seam: no live Tavily or Brave key was available to this phase, so the
// search provider's wire format is pinned separately by internal/rag/search's
// recorded-HTTP tests.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/chat"
	profileprompts "github.com/D0bby999/anytools/internal/prompts/profile"
	researchprompts "github.com/D0bby999/anytools/internal/prompts/research"
	solveprompts "github.com/D0bby999/anytools/internal/prompts/solve"
	writingprompts "github.com/D0bby999/anytools/internal/prompts/writing"
	"github.com/D0bby999/anytools/internal/testutil"
	"github.com/D0bby999/anytools/internal/tools"
)

// ── the scripted upstream ────────────────────────────────────────────────────

var anyMarker = regexp.MustCompile(`\[\[cite:(?:chunk|url):[A-Za-z0-9_.:-]+\]\]`)

type stageModel struct {
	server *httptest.Server
	mu     sync.Mutex
	calls  map[string]int
	// imageURL is the data: URL the plan stage received, if any.
	imageURL string
	// chatTools are the tool names a chat turn was offered.
	chatTools []string
	// synthInput is what the research synthesis was shown.
	synthInput string
	// bodies are every request's raw body, in order (learning-depth phase 9
	// reads them for what the profile reached).
	bodies []string
}

type wireMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

// text returns a message's text, whether content is a string or a parts array.
func (m wireMessage) text() (string, string) {
	var s string
	if json.Unmarshal(m.Content, &s) == nil {
		return s, ""
	}
	var parts []struct {
		Type     string `json:"type"`
		Text     string `json:"text"`
		ImageURL struct {
			URL string `json:"url"`
		} `json:"image_url"`
	}
	_ = json.Unmarshal(m.Content, &parts)
	var text, image string
	for _, p := range parts {
		if p.Type == "image_url" {
			image = p.ImageURL.URL
		} else {
			text += p.Text
		}
	}
	return text, image
}

func newStageModel(t *testing.T) *stageModel {
	t.Helper()
	m := &stageModel{calls: map[string]int{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Stream   bool          `json:"stream"`
			Messages []wireMessage `json:"messages"`
			Tools    []struct {
				Function struct {
					Name string `json:"name"`
				} `json:"function"`
			} `json:"tools"`
		}
		if err := json.Unmarshal(body, &req); err != nil || len(req.Messages) < 2 {
			t.Errorf("stage model: unusable request %s", truncateForMsg(string(body)))
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		system, _ := req.Messages[0].text()
		user, image := req.Messages[len(req.Messages)-1].text()
		m.mu.Lock()
		m.bodies = append(m.bodies, string(body))
		m.mu.Unlock()

		kind, reply := m.answer(t, system, user, image)
		if kind == "chat" {
			m.mu.Lock()
			m.chatTools = nil
			for _, tool := range req.Tools {
				m.chatTools = append(m.chatTools, tool.Function.Name)
			}
			m.mu.Unlock()
		}
		m.mu.Lock()
		m.calls[kind]++
		m.mu.Unlock()

		if req.Stream {
			streamText(w, reply)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "cmpl-" + kind, "object": "chat.completion", "model": "fake-1",
			"choices": []any{map[string]any{
				"index": 0, "finish_reason": "stop",
				"message": map[string]any{"role": "assistant", "content": reply},
			}},
			"usage": map[string]any{"prompt_tokens": 300, "completion_tokens": 60, "total_tokens": 360},
		})
	})
	m.server = httptest.NewServer(mux)
	t.Cleanup(m.server.Close)
	return m
}

func streamText(w http.ResponseWriter, text string) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	for _, word := range strings.SplitAfter(text, " ") {
		if word != "" {
			writeSSE(w, flusher, map[string]any{
				"choices": []any{map[string]any{"delta": map[string]any{"content": word}}},
			})
		}
	}
	writeSSE(w, flusher, map[string]any{
		"choices": []any{map[string]any{"delta": map[string]any{}, "finish_reason": "stop"}},
		"usage":   map[string]any{"prompt_tokens": 300, "completion_tokens": 60, "total_tokens": 360},
	})
	fmt.Fprint(w, "data: [DONE]\n\n")
	flusher.Flush()
}

func (m *stageModel) count(kind string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls[kind]
}

// requests returns every request body received so far.
func (m *stageModel) requests() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.bodies...)
}

func (m *stageModel) snapshot() (image string, chatTools []string, synth string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.imageURL, append([]string(nil), m.chatTools...), m.synthInput
}

func jsonReply(v any) string {
	raw, _ := json.Marshal(v)
	return "```json\n" + string(raw) + "\n```"
}

// answer scripts one reply per stage, recognised by its system prompt.
func (m *stageModel) answer(t *testing.T, system, user, image string) (string, string) {
	// Chat's first message is its rules followed by the conversation's
	// context, ending at the cache boundary (chat/prompt.go).
	if strings.HasPrefix(system, chat.SystemPrompt) {
		system = chat.SystemPrompt
	}
	switch system {
	case solveprompts.Plan:
		m.mu.Lock()
		m.imageURL = image
		m.mu.Unlock()
		return "solve-plan", jsonReply(map[string]any{
			"problem": "Solve $2x + 3 = 11$ for $x$.", "topic": "linear equations",
			"approach": []string{"isolate x", "check"}, "search": "parametric memory", "unreadable": "",
		})
	case solveprompts.Reason:
		return "solve-reason", jsonReply(map[string]any{
			"steps": []any{
				map[string]any{"title": "Isolate", "work": "$2x = 8$", "cites": []string{}},
				map[string]any{"title": "Divide", "work": `$x = \frac{8}{2} = 4$`, "cites": []string{}},
			},
			"final_answer": "$x = 4$",
			"check":        map[string]any{"verdict": "", "explanation": ""},
		})
	case solveprompts.Write:
		cite := ""
		if mk := anyMarker.FindString(user); mk != "" {
			cite = " " + mk
		}
		return "solve-write", "Solve $2x + 3 = 11$.\n\n1. **Isolate** $$2x = 8$$ as the notes describe." + cite +
			"\n2. **Divide** $x = \\frac{8}{2}$. [[cite:chunk:" + bogusChunk + "]]\n\n**Answer:** $x = 4$"
	case researchprompts.Rephrase:
		return "research-rephrase", jsonReply(map[string]string{
			"topic": "How does retrieval-augmented generation use parametric memory?", "title": "RAG memory",
		})
	case researchprompts.Decompose:
		return "research-decompose", jsonReply(map[string]any{
			"subqueries": []string{"parametric memory", "non-parametric memory", "retrieval-augmented generation"},
		})
	case researchprompts.Synthesize:
		m.mu.Lock()
		m.synthInput = user
		m.mu.Unlock()
		var b strings.Builder
		b.WriteString("# RAG memory\n\nA summary.")
		seen := map[string]bool{}
		for _, mk := range anyMarker.FindAllString(user, -1) {
			if !seen[mk] {
				seen[mk] = true
				b.WriteString(" A claim " + mk + ".")
			}
		}
		b.WriteString(" An invented claim [[cite:url:77]].")
		return "research-synthesize", b.String()
	case researchprompts.Reflect:
		return "research-reflect", jsonReply(map[string]any{"sufficient": true, "gaps": []string{}, "next_queries": []string{}})
	case researchprompts.Verify:
		// One claim per marker the report cites, all supported.
		report, _, _ := strings.Cut(user, "The cited sources:")
		var claims []map[string]any
		for _, mk := range anyMarker.FindAllString(report, -1) {
			id := strings.TrimSuffix(strings.TrimPrefix(mk, "[[cite:"), "]]")
			claims = append(claims, map[string]any{"claim": "claim " + id, "cites": []string{id}, "verdict": "supported"})
		}
		return "research-verify", jsonReply(map[string]any{"claims": claims})
	case chat.SystemPrompt:
		return "chat", "No search needed."
	case profileprompts.Consolidate:
		// Learning-depth phase 9: one cited struggle, one statement citing
		// nothing, one absolute.
		return "profile-consolidate", jsonReply(map[string]any{"operations": []any{
			map[string]any{"op": "add", "section": "struggles", "text": "Across recent answers, recall mistakes recur on this point.", "refs": []string{"S1"}},
			map[string]any{"op": "add", "section": "preferences", "text": "Likes podcasts.", "refs": []string{}},
			map[string]any{"op": "add", "section": "strengths", "text": "Has mastered retrieval.", "refs": []string{"S2"}},
		}})
	}
	// up-methods phase 4: a writing diagnosis, one system prompt per pass.
	for n := 1; n <= len(writingprompts.Passes); n++ {
		if system == writingprompts.Diagnose(n) {
			return "writing-diagnose", jsonReply(map[string]any{"issues": []any{}})
		}
	}
	t.Errorf("stage model: unexpected system prompt %q", truncateForMsg(system))
	return "unknown", "?"
}

// ── the scripted web ─────────────────────────────────────────────────────────

// scriptedWeb stands in for the user's Tavily key: a WebSearcher that records
// every query, and a page server web_fetch reads through a fixture transport.
type scriptedWeb struct {
	mu      sync.Mutex
	hasKey  bool
	queries []string
	pages   *httptest.Server
}

func (s *scriptedWeb) Available(context.Context, uuid.UUID) (bool, error) { return s.hasKey, nil }

func (s *scriptedWeb) Search(_ context.Context, _ uuid.UUID, q string, limit int) ([]tools.WebResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.hasKey {
		return nil, tools.ErrNoSearchKey
	}
	s.queries = append(s.queries, q)
	slug := strings.ReplaceAll(q, " ", "-")
	out := []tools.WebResult{
		{Title: "On " + q, URL: "http://docs.test/" + slug, Snippet: "An overview of " + q + "."},
		{Title: "More on " + q, URL: "http://notes.test/" + slug, Snippet: "Further reading on " + q + "."},
	}
	if limit < len(out) {
		out = out[:limit]
	}
	return out, nil
}

func (s *scriptedWeb) searches() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.queries)
}

func newScriptedWeb(t *testing.T, hasKey bool) *scriptedWeb {
	t.Helper()
	pages := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<html><head><title>Page %s</title></head><body><article><h1>Page %[1]s</h1>
<p>Retrieval-augmented generation combines parametric memory held in model weights with a
non-parametric memory, a dense vector index of passages the model retrieves at answer time.</p>
<p>The page at %[1]s explains how the two memories complement one another in practice.</p>
</article></body></html>`, r.URL.Path)
	}))
	t.Cleanup(pages.Close)
	return &scriptedWeb{hasKey: hasKey, pages: pages}
}

// fetchClient reaches the page server whatever host a URL names, so web_fetch
// can be exercised on public-looking names without a public network.
func (s *scriptedWeb) fetchClient() *http.Client {
	addr := s.pages.Listener.Addr().String()
	return &http.Client{Transport: &http.Transport{
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, addr)
		},
	}}
}

// ── harness ──────────────────────────────────────────────────────────────────

// newPhase9E2E is one user with an indexed PDF, solve, research and chat routed
// to the stage model, and the given web.
func newPhase9E2E(t *testing.T, web *scriptedWeb) (*e2e, *stageModel, uuid.UUID) {
	t.Helper()
	model := newStageModel(t)
	e := buildE2EWith(t, model.server.URL, []string{"chat", "solve", "research"}, nil,
		webDeps{searcher: web, fetchClient: web.fetchClient()})

	kbID := uuid.MustParse(e.json(http.MethodPost, "/v1/kb",
		map[string]string{"name": "Retrieval papers"}, http.StatusCreated)["id"].(string))
	e.upload(kbID, "rag.pdf", ragFixturePDF(t))
	e.drainJobs()
	return e, model, kbID
}

// resultOf returns the result frame's content and metadata, failing on an error.
func resultOf(t *testing.T, frames []e2eFrame) (string, map[string]any) {
	t.Helper()
	for _, f := range frames {
		switch f.event {
		case "stream_error":
			t.Fatalf("the turn failed: %v", f.data["content"])
		case "result":
			content, _ := f.data["content"].(string)
			meta, _ := f.data["metadata"].(map[string]any)
			return content, meta
		}
	}
	t.Fatalf("no result frame in %d frames", len(frames))
	return "", nil
}

func stagesOf(frames []e2eFrame) string {
	var out []string
	for _, f := range frames {
		if f.event == "stage_start" {
			out = append(out, fmt.Sprint(f.data["stage"]))
		}
	}
	return strings.Join(out, ",")
}

func algebraPhoto(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile("../capabilities/solve/testdata/algebra.png")
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(raw)
}

// ── solve ────────────────────────────────────────────────────────────────────

// The success criterion: a photographed algebra problem → a worked LaTeX
// solution, grounded in the learner's PDF, that can be kept.
func TestSolveAPhotographedProblemEndToEnd(t *testing.T) {
	e, model, kbID := newPhase9E2E(t, newScriptedWeb(t, false))
	photo := algebraPhoto(t)

	started := e.json(http.MethodPost, "/v1/solve", map[string]any{
		"image":  map[string]string{"mime_type": "image/png", "data": "data:image/png;base64," + photo},
		"kb_ids": []string{kbID.String()},
	}, http.StatusAccepted)
	sessionID, turnID := started["session_id"].(string), started["turn_id"].(string)

	frames := e.readTurnStream(turnID)
	if got := stagesOf(frames); got != "plan,reason,write" {
		t.Fatalf("stages = %s", got)
	}
	image, _, _ := model.snapshot()
	if image != "data:image/png;base64,"+photo {
		t.Fatal("the photo did not reach the model as an image part, byte for byte")
	}
	answer, meta := resultOf(t, frames)
	if !strings.Contains(answer, `$$2x = 8$$`) || !strings.Contains(answer, `\frac{8}{2}`) {
		t.Fatalf("the LaTeX did not survive: %q", answer)
	}
	if strings.Contains(answer, bogusChunk) || meta["dropped_citations"] != float64(1) {
		t.Fatalf("the invented citation was not dropped: %v", meta)
	}
	if meta["final_answer"] != "$x = 4$" {
		t.Errorf("final answer = %v", meta["final_answer"])
	}
	var cited map[string]any
	for _, f := range frames {
		if f.event == "sources" {
			list, _ := mapAt(f.data, "metadata")["sources"].([]any)
			if len(list) == 1 {
				cited, _ = list[0].(map[string]any)
			}
		}
	}
	if cited == nil || cited["kind"] != "chunk" || cited["document_id"] == nil || cited["page"].(float64) < 1 {
		t.Fatalf("the solution's citation does not open a page: %v", cited)
	}
	if !strings.Contains(answer, "[[cite:chunk:"+cited["id"].(string)+"]]") {
		t.Fatal("the answer does not carry the marker its chip renders from")
	}

	// The photo was sent, not stored: the transcript records its hash.
	if n := e.scalar(`SELECT count(*) FROM chat_messages WHERE session_id = $1 AND
		(content LIKE '%' || $2 || '%' OR attachments::text LIKE '%' || $2 || '%')`,
		sessionID, photo[:64]); n != 0 {
		t.Fatalf("%d transcript rows carry the photo's bytes", n)
	}
	if n := e.scalar(`SELECT count(*) FROM chat_messages WHERE session_id = $1 AND role = 'user'
		AND attachments->'images'->0->>'sha256' <> ''`, sessionID); n != 1 {
		t.Fatal("the transcript does not record what was attached")
	}

	messageID := meta["message_id"].(string)
	// Save to notebook: phase 8 is not on this branch, and the answer says so.
	res := e.do(http.MethodPost, "/v1/solve/messages/"+messageID+"/note", nil)
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable || !strings.Contains(string(raw), "notebook_unavailable") {
		t.Fatalf("save note: %d %s", res.StatusCode, raw)
	}

	// Turn it into a question: filed in the session's knowledge base, answer
	// hidden until attempted, its explanation the write-up.
	q := mapAt(e.json(http.MethodPost, "/v1/solve/messages/"+messageID+"/question", nil, http.StatusCreated), "question")
	if q["prompt"] != "Solve $2x + 3 = 11$ for $x$." || q["type"] != "short" || q["kb_id"] != kbID.String() {
		t.Fatalf("question = %v", q)
	}
	if _, leaked := q["answer"]; leaked {
		t.Fatal("a new question carried its answer")
	}
	if n := e.scalar(`SELECT count(*) FROM questions WHERE id = $1 AND answer = '$x = 4$'
		AND cardinality(source_chunk_ids) = 1`, q["id"]); n != 1 {
		t.Fatal("the stored question lost its answer or its source")
	}

	// "Check my answer" continues the same session.
	check := e.json(http.MethodPost, "/v1/solve", map[string]any{
		"session_id": sessionID, "problem": "2x + 3 = 11", "variant": "check", "user_answer": "x = 7",
	}, http.StatusAccepted)
	if _, meta := resultOf(t, e.readTurnStream(check["turn_id"].(string))); meta["variant"] != "check" {
		t.Fatalf("check result = %v", meta)
	}
	if model.count("solve-plan") != 2 {
		t.Errorf("plan calls = %d", model.count("solve-plan"))
	}

	// Refusals a person can act on.
	for _, bad := range []map[string]any{
		{},
		{"image": map[string]string{"data": base64.StdEncoding.EncodeToString([]byte("not an image"))}},
		{"problem": "x", "variant": "check"},
	} {
		if got := e.status(http.MethodPost, "/v1/solve", bad); got != http.StatusBadRequest {
			t.Errorf("POST /v1/solve %v: status %d, want 400", bad, got)
		}
	}

	// Isolation: a second account reaches none of it.
	stranger := e.as(testutil.NewUser(t, e.pool))
	for _, probe := range []struct {
		method, path string
		body         any
	}{
		{http.MethodPost, "/v1/solve", map[string]any{"session_id": sessionID, "problem": "x"}},
		{http.MethodPost, "/v1/solve", map[string]any{"problem": "x", "kb_ids": []string{kbID.String()}}},
		{http.MethodPost, "/v1/solve/messages/" + messageID + "/note", nil},
		{http.MethodPost, "/v1/solve/messages/" + messageID + "/question", nil},
		{http.MethodPost, "/v1/solve/messages/" + messageID + "/question", map[string]any{"kb_id": kbID}},
		{http.MethodGet, "/v1/turns/" + turnID + "/events", nil},
	} {
		if got := stranger.status(probe.method, probe.path, probe.body); got != http.StatusNotFound {
			t.Errorf("stranger %s %s: status %d, want 404", probe.method, probe.path, got)
		}
	}
}

// ── research ─────────────────────────────────────────────────────────────────

// report reads a stored report and checks the one property the phase rests on:
// every marker in it resolves to a source the report carries.
func (e *e2e) report(id string) (string, []map[string]any) {
	e.t.Helper()
	rep := e.json(http.MethodGet, "/v1/research/reports/"+id, nil, http.StatusOK)
	md, _ := rep["report_md"].(string)
	raw, _ := rep["sources"].([]any)
	byKey := map[string]bool{}
	var sources []map[string]any
	for _, r := range raw {
		src := r.(map[string]any)
		sources = append(sources, src)
		byKey[fmt.Sprintf("%v:%v", src["kind"], src["id"])] = true
	}
	for _, mk := range anyMarker.FindAllString(md, -1) {
		key := strings.TrimSuffix(strings.TrimPrefix(mk, "[[cite:"), "]]")
		if !byKey[key] {
			e.t.Fatalf("report %s cites %s, which resolves to nothing", id, mk)
		}
	}
	return md, sources
}

func TestQuickResearchWithASearchKeyCitesResolvingWebSources(t *testing.T) {
	web := newScriptedWeb(t, true)
	e, _, kbID := newPhase9E2E(t, web)

	started := e.json(http.MethodPost, "/v1/research",
		map[string]any{"query": "how does RAG use parametric memory", "mode": "quick"}, http.StatusAccepted)
	if started["web_available"] != true || started["mode"] != "quick" {
		t.Fatalf("start = %v", started)
	}
	frames := e.readTurnStream(started["turn_id"].(string))
	if got := stagesOf(frames); got != "rephrase,decompose,gather,synthesize,verify" {
		t.Fatalf("stages = %s", got)
	}
	_, meta := resultOf(t, frames)
	if meta["kb_only"] != false || meta["dropped_citations"] != float64(1) || meta["note_saved"] != false {
		t.Fatalf("result = %v", meta)
	}
	reportID := meta["report_id"].(string)

	// The stored report carries its claim check, read back over HTTP.
	stored := e.json(http.MethodGet, "/v1/research/reports/"+reportID, nil, http.StatusOK)
	check, _ := stored["verification"].(map[string]any)
	if check["status"] != "checked" || check["total"] == float64(0) || check["supported"] != check["total"] {
		t.Fatalf("stored verification = %v", check)
	}
	if stored["engine"] != "key" {
		t.Fatalf("stored engine = %v", stored["engine"])
	}

	md, sources := e.report(reportID)
	if len(sources) < 2 || len(sources) > 5 {
		t.Fatalf("a quick report stands on %d sources, want 2..5", len(sources))
	}
	for _, src := range sources {
		url, _ := src["url"].(string)
		if src["kind"] != "url" || !(strings.HasPrefix(url, "http://docs.test/") || strings.HasPrefix(url, "http://notes.test/")) {
			t.Fatalf("a citation that does not open a gathered page: %v", src)
		}
	}
	if strings.Contains(md, "url:77") {
		t.Fatal("an invented citation survived into the stored report")
	}

	list := e.json(http.MethodGet, "/v1/research/reports", nil, http.StatusOK)["reports"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["id"] != reportID {
		t.Fatalf("list = %v", list)
	}
	if got := e.status(http.MethodPost, "/v1/research/reports/"+reportID+"/note", nil); got != http.StatusServiceUnavailable {
		t.Errorf("save note without a notebook: status %d, want 503", got)
	}

	// Keep studying it: the report and the pages it cites become documents in
	// the learner's knowledge base, and are indexed like any upload.
	added := e.json(http.MethodPost, "/v1/research/reports/"+reportID+"/knowledge",
		map[string]any{"kb_id": kbID.String(), "include_sources": true}, http.StatusCreated)
	// The scripted web serves the same bytes for the same path on two hosts;
	// a knowledge base keeps one copy and says the other is already there.
	pagesIn, _ := added["sources_added"].(float64)
	pagesAlready, _ := added["sources_already"].(float64)
	if added["report_added"] != true || pagesIn == 0 || int(pagesIn+pagesAlready) != len(sources) || added["sources_failed"] != float64(0) {
		t.Fatalf("to knowledge = %v (report cites %d pages)", added, len(sources))
	}
	again := e.json(http.MethodPost, "/v1/research/reports/"+reportID+"/knowledge",
		map[string]any{"kb_id": kbID.String()}, http.StatusCreated)
	if again["report_added"] != false || again["report_already"] != true {
		t.Fatalf("adding the same report twice = %v", again)
	}
	e.drainJobs()
	docs := e.json(http.MethodGet, "/v1/kb/"+kbID.String()+"/documents", nil, http.StatusOK)["documents"].([]any)
	reportDoc := false
	for _, d := range docs {
		doc := d.(map[string]any)
		if doc["status"] != "ready" {
			t.Errorf("document %v is %v: %v", doc["title"], doc["status"], doc["error"])
		}
		reportDoc = reportDoc || strings.HasPrefix(doc["title"].(string), "Research - RAG memory")
	}
	if !reportDoc || len(docs) != 2+int(pagesIn) {
		t.Fatalf("knowledge base holds %d documents, want the PDF, the report and %d pages: %v", len(docs), int(pagesIn), docs)
	}
	if got := e.status(http.MethodPost, "/v1/research", map[string]any{"query": "x", "mode": "slow"}); got != http.StatusBadRequest {
		t.Errorf("unknown mode: status %d", got)
	}

	stranger := e.as(testutil.NewUser(t, e.pool))
	for _, probe := range []struct{ method, path string }{
		{http.MethodGet, "/v1/research/reports/" + reportID},
		{http.MethodPost, "/v1/research/reports/" + reportID + "/note"},
		{http.MethodPost, "/v1/research/reports/" + reportID + "/knowledge"},
		{http.MethodGet, "/v1/research/reports/not-a-uuid"},
	} {
		if got := stranger.status(probe.method, probe.path, nil); got != http.StatusNotFound {
			t.Errorf("stranger %s %s: status %d, want 404", probe.method, probe.path, got)
		}
	}
	if got := stranger.status(http.MethodPost, "/v1/research",
		map[string]any{"query": "x", "session_id": started["session_id"]}); got != http.StatusNotFound {
		t.Errorf("stranger continuing the session: status %d, want 404", got)
	}
	if n := len(stranger.json(http.MethodGet, "/v1/research/reports", nil, http.StatusOK)["reports"].([]any)); n != 0 {
		t.Errorf("a stranger lists %d reports", n)
	}
}

func TestResearchWithoutASearchKeyIsKBOnlyAndSaysSo(t *testing.T) {
	web := newScriptedWeb(t, false)
	e, _, kbID := newPhase9E2E(t, web)

	started := e.json(http.MethodPost, "/v1/research", map[string]any{
		"query": "parametric memory", "kb_ids": []string{kbID.String()},
	}, http.StatusAccepted)
	if started["web_available"] != false {
		t.Fatalf("start = %v; the page must know up front that the report is KB-only", started)
	}
	frames := e.readTurnStream(started["turn_id"].(string))
	_, meta := resultOf(t, frames)
	if meta["kb_only"] != true || meta["kb_only_reason"] != "no_search_key" {
		t.Fatalf("result = %v", meta)
	}
	said := false
	for _, f := range frames {
		c, _ := f.data["content"].(string)
		said = said || (f.event == "observation" && strings.Contains(c, "knowledge base only"))
	}
	if !said {
		t.Error("the stream never said the report is KB-only")
	}
	_, sources := e.report(meta["report_id"].(string))
	if len(sources) < 2 {
		t.Fatalf("a KB-only report stands on %d sources", len(sources))
	}
	for _, src := range sources {
		if src["kind"] != "chunk" || src["document_id"] == nil || src["page"].(float64) < 1 {
			t.Fatalf("a KB citation that does not open a page: %v", src)
		}
	}
	if web.searches() != 0 {
		t.Fatal("searched without a key")
	}
}

// ── the egress rule ──────────────────────────────────────────────────────────

// Documents in context and "allow web" off: the web is never queried, and the
// report says why. With the toggle on, a deep report stands on both, and the
// pages it read went through web_fetch.
func TestTheWebStaysOffOnceDocumentsAreInPlayUnlessAllowed(t *testing.T) {
	web := newScriptedWeb(t, true)
	e, model, kbID := newPhase9E2E(t, web)

	off := e.json(http.MethodPost, "/v1/research", map[string]any{
		"query": "parametric memory", "kb_ids": []string{kbID.String()},
	}, http.StatusAccepted)
	_, meta := resultOf(t, e.readTurnStream(off["turn_id"].(string)))
	if meta["kb_only_reason"] != "web_off_with_documents" {
		t.Fatalf("result = %v", meta)
	}
	if web.searches() != 0 {
		t.Fatalf("the web was searched %d times after the learner's documents were read", web.searches())
	}
	for _, f := range e.readTurnStream(off["turn_id"].(string)) {
		if f.event == "tool_call" && strings.HasPrefix(fmt.Sprint(f.data["content"]), "web_") {
			t.Fatalf("a web tool ran: %v", f.data)
		}
	}

	on := e.json(http.MethodPost, "/v1/research", map[string]any{
		"query": "parametric memory", "kb_ids": []string{kbID.String()}, "allow_web": true, "mode": "deep",
	}, http.StatusAccepted)
	_, meta = resultOf(t, e.readTurnStream(on["turn_id"].(string)))
	if meta["kb_only"] != false || meta["web_sources"].(float64) == 0 || meta["kb_sources"].(float64) == 0 {
		t.Fatalf("allow-web deep result = %v", meta)
	}
	_, sources := e.report(meta["report_id"].(string))
	kinds := map[any]int{}
	for _, src := range sources {
		kinds[src["kind"]]++
	}
	if kinds["chunk"] == 0 || kinds["url"] == 0 || len(sources) > 20 {
		t.Fatalf("deep report sources by kind = %v (total %d)", kinds, len(sources))
	}
	if _, _, synth := model.snapshot(); !strings.Contains(synth, "dense vector index") {
		t.Error("deep mode did not read any page through web_fetch")
	}
}

// A CHAT turn has no network tool at all — not even with "allow web" on — so a
// grounded conversation can never be steered into fetching a URL.
func TestAChatTurnNeverSeesAWebTool(t *testing.T) {
	e, model, kbID := newPhase9E2E(t, newScriptedWeb(t, true))

	sess := e.json(http.MethodPost, "/v1/chat/sessions",
		map[string]any{"title": "c", "kb_ids": []string{kbID.String()}}, http.StatusCreated)
	sessionID := sess["id"].(string)
	e.json(http.MethodPatch, "/v1/chat/sessions/"+sessionID, map[string]any{"allow_web": true}, http.StatusOK)

	turn := e.json(http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
		map[string]any{"message": "hello"}, http.StatusAccepted)
	resultOf(t, e.readTurnStream(turn["turn_id"].(string)))

	_, offered, _ := model.snapshot()
	joined := strings.Join(offered, ",")
	if !strings.Contains(joined, "rag_search") {
		t.Fatalf("chat was offered %v; the harness is not measuring a grounded turn", offered)
	}
	if strings.Contains(joined, "web_search") || strings.Contains(joined, "web_fetch") {
		t.Fatalf("a chat turn was offered a web tool: %v", offered)
	}
}
