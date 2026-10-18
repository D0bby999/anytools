package app

// writing_diagnosis_e2e_test.go — up-methods phase 4, end to end through the
// wiring: a writing evidence card's revision pass diagnosed on the learner's
// chat route, by a scripted OpenAI-compatible upstream reached through the
// real BYOK chain (as quiz_mastery_e2e_test.go does it).
//
// What the engine decides, whatever the model says: no draft, no call (409);
// another user's card is 404 before any call; at most three issues, each
// quoting the draft; nothing the model writes reaches the worksheet's
// answers; one diagnosis per pass and draft.

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/testutil"
)

// diagnosisModel answers every chat completion with reply. While hold is
// set, each request signals arrived and waits for hold to close.
type diagnosisModel struct {
	server  *httptest.Server
	mu      sync.Mutex
	reply   string
	bodies  []string
	hold    chan struct{}
	arrived chan struct{}
}

func newDiagnosisModel(t *testing.T) *diagnosisModel {
	t.Helper()
	m := &diagnosisModel{}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		m.mu.Lock()
		m.bodies = append(m.bodies, string(body))
		reply, hold, arrived := m.reply, m.hold, m.arrived
		m.mu.Unlock()
		if hold != nil {
			arrived <- struct{}{}
			<-hold
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "cmpl-diagnose", "object": "chat.completion", "model": "fake-1",
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

func (m *diagnosisModel) set(reply string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reply = reply
}

func (m *diagnosisModel) calls() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.bodies...)
}

const e2eDraft = "Hi Sam, the launch moves to Friday because the payment tests failed twice on staging. " +
	"I think we should probably maybe tell the client this week. The numbers are in the attached sheet."

// newWritingCard creates a writing evidence card and, when draft is not
// empty, saves it in §2. It returns the card's id and revision.
func newWritingCard(t *testing.T, e *e2e, draft string) (string, string) {
	t.Helper()
	created := e.json(http.MethodPost, "/v1/worksheets", map[string]any{
		"kind": worksheet.WritingEvidenceKind, "title": "Launch delay email"}, http.StatusCreated)
	id, rev := created["id"].(string), created["updated_at"].(string)
	if draft != "" {
		patched := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": rev, "answers": map[string]any{
			"task":  map[string]any{"situation": "Telling the client about a delay", "task": "status"},
			"draft": map[string]any{"draft": draft},
		}}, http.StatusOK)
		rev = patched["updated_at"].(string)
	}
	return id, rev
}

// userContent is the user message of a recorded chat completion request.
func userContent(t *testing.T, body string) (system, user string) {
	t.Helper()
	var req struct {
		Messages []struct {
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal([]byte(body), &req); err != nil || len(req.Messages) < 2 {
		t.Fatalf("unusable request %s", body)
	}
	return req.Messages[0].Content, req.Messages[len(req.Messages)-1].Content
}

func TestWritingDiagnosisEndToEnd(t *testing.T) {
	model := newDiagnosisModel(t)
	e := buildE2E(t, model.server.URL, []string{"chat"}, nil)

	// up's step one: no draft, no diagnosis, no call.
	empty, _ := newWritingCard(t, e, "")
	res := e.do(http.MethodPost, "/v1/worksheets/"+empty+"/diagnose", map[string]any{"pass": 1})
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusConflict || !strings.Contains(string(raw), "save your own draft first") {
		t.Fatalf("no draft: %d %s", res.StatusCode, raw)
	}

	id, _ := newWritingCard(t, e, e2eDraft)
	// Another user's card answers like a missing one, before any model call.
	bob := e.as(testutil.NewUser(t, e.pool))
	for _, probe := range []struct{ method, path string }{
		{http.MethodPost, "/v1/worksheets/" + id + "/diagnose"},
		{http.MethodGet, "/v1/worksheets/" + id + "/diagnoses"},
	} {
		if got := bob.status(probe.method, probe.path, map[string]any{"pass": 1}); got != http.StatusNotFound {
			t.Errorf("bob %s %s: %d", probe.method, probe.path, got)
		}
	}
	if n := len(model.calls()); n != 0 {
		t.Fatalf("%d model calls before any allowed diagnosis", n)
	}

	model.set(jsonReply(map[string]any{
		"rewritten_draft": "REWRITE9K Dear Sam, the launch is now on Friday.",
		"issues": []any{
			map[string]any{"quote": "probably maybe", "problem": "Two hedges blur the request", "basis": "The reader must act",
				"confidence": "high", "might_be_wrong": "The team may hedge by habit", "after": "REWRITE9K we must"},
			map[string]any{"quote": "the payments test failed", "problem": "not in the draft", "basis": "b",
				"confidence": "low", "might_be_wrong": "w"},
			map[string]any{"quote": e2eDraft, "problem": "the whole draft", "basis": "b", "confidence": "low", "might_be_wrong": "w"},
			map[string]any{"quote": "on staging", "problem": "Which staging?", "basis": "b", "confidence": "medium", "might_be_wrong": "w"},
			map[string]any{"quote": "this week", "problem": "When exactly?", "basis": "b", "confidence": "low", "might_be_wrong": "w"},
			map[string]any{"quote": "attached sheet", "problem": "A fourth kept issue", "basis": "b", "confidence": "low", "might_be_wrong": "w"},
		},
	}))
	res = e.do(http.MethodPost, "/v1/worksheets/"+id+"/diagnose", map[string]any{"pass": 1})
	raw, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("diagnose: %d %s", res.StatusCode, raw)
	}
	if strings.Contains(string(raw), "REWRITE9K") {
		t.Fatalf("a rewrite reached the learner: %s", raw)
	}
	var d struct {
		ID     string `json:"id"`
		Pass   int    `json:"pass"`
		Model  string `json:"model"`
		Issues []struct {
			Quote, Problem, Basis, Confidence string
			MightBeWrong                      string `json:"might_be_wrong"`
		} `json:"issues"`
	}
	_ = json.Unmarshal(raw, &d)
	if d.Pass != 1 || d.Model != "fake-1" || len(d.Issues) != 3 {
		t.Fatalf("diagnosis %s", raw)
	}
	for i, want := range []string{"probably maybe", "on staging", "this week"} {
		if d.Issues[i].Quote != want || !strings.Contains(e2eDraft, d.Issues[i].Quote) {
			t.Errorf("issue %d quotes %q, want %q", i, d.Issues[i].Quote, want)
		}
	}

	// The draft went to the model inside its envelope, with pass one's
	// question in the system prompt.
	calls := model.calls()
	if len(calls) != 1 {
		t.Fatalf("%d model calls", len(calls))
	}
	system, user := userContent(t, calls[0])
	open := strings.LastIndex(user, `<document source="The learner's unaided draft" id="draft" trust="untrusted">`)
	at := strings.Index(user, "probably maybe tell the client")
	if open < 0 || at < open || at > strings.LastIndex(user, "</document>") {
		t.Fatalf("the draft is not inside its envelope:\n%s", user)
	}
	if !strings.Contains(system, "Task and fact") || strings.Contains(system, "{{") {
		t.Fatalf("pass one's question is not in the system prompt:\n%s", system)
	}

	// Nothing reached the worksheet's answers: the draft is the learner's,
	// §6 and §8 are untouched.
	got := e.json(http.MethodGet, "/v1/worksheets/"+id, nil, http.StatusOK)
	answers := mapAt(got, "worksheet", "answers")
	if mapAt(answers, "draft")["draft"] != e2eDraft || answers["passes"] != nil || answers["ai"] != nil {
		t.Fatalf("the diagnosis changed the worksheet: %v", answers)
	}
	if strings.Contains(e.raw(http.MethodGet, "/v1/worksheets/"+id, nil), "REWRITE9K") {
		t.Fatal("a rewrite reached the worksheet")
	}

	// One diagnosis per pass and draft: the stored one, no second call.
	again := e.json(http.MethodPost, "/v1/worksheets/"+id+"/diagnose", map[string]any{"pass": 1}, http.StatusOK)
	if again["id"] != d.ID || len(model.calls()) != 1 {
		t.Fatalf("the stored diagnosis was not reused: %v, %d calls", again["id"], len(model.calls()))
	}
	listed := e.json(http.MethodGet, "/v1/worksheets/"+id+"/diagnoses", nil, http.StatusOK)
	if list, _ := listed["diagnoses"].([]any); len(list) != 1 {
		t.Fatalf("diagnoses %v", listed)
	}

	// Unreadable output is 422, and nothing is stored.
	model.set("Here is a cleaner version of your email: Dear Sam, …")
	if got := e.status(http.MethodPost, "/v1/worksheets/"+id+"/diagnose", map[string]any{"pass": 2}); got != http.StatusUnprocessableEntity {
		t.Fatalf("unreadable output: %d", got)
	}
	if n := e.scalar(`SELECT count(*) FROM worksheet_diagnoses WHERE worksheet_id = $1`, id); n != 1 {
		t.Fatalf("%d diagnoses stored", n)
	}
	if got := e.status(http.MethodPost, "/v1/worksheets/"+id+"/diagnose", map[string]any{"pass": 6}); got != http.StatusBadRequest {
		t.Fatalf("pass 6: %d", got)
	}
}

// A PATCH of the draft while its diagnosis is running loses nothing: the
// diagnosis writes only its own table, under the draft it read.
func TestADraftEditedDuringItsDiagnosisIsKept(t *testing.T) {
	model := newDiagnosisModel(t)
	e := buildE2E(t, model.server.URL, []string{"chat"}, nil)
	id, rev := newWritingCard(t, e, e2eDraft)

	model.set(jsonReply(map[string]any{"issues": []any{map[string]any{
		"quote": "on staging", "problem": "p", "basis": "b", "confidence": "low", "might_be_wrong": "w"}}}))
	hold, arrived := make(chan struct{}), make(chan struct{}, 1)
	model.mu.Lock()
	model.hold, model.arrived = hold, arrived
	model.mu.Unlock()

	status := make(chan int, 1)
	go func() {
		status <- e.status(http.MethodPost, "/v1/worksheets/"+id+"/diagnose", map[string]any{"pass": 3})
	}()
	<-arrived
	edited := e2eDraft + " Sorry for the short notice."
	e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": rev,
		"answers": map[string]any{"draft": map[string]any{"draft": edited}}}, http.StatusOK)
	close(hold)
	if got := <-status; got != http.StatusOK {
		t.Fatalf("the diagnosis: %d", got)
	}

	got := e.json(http.MethodGet, "/v1/worksheets/"+id, nil, http.StatusOK)
	if draft := mapAt(got, "worksheet", "answers", "draft")["draft"]; draft != edited {
		t.Fatalf("the edit was lost: %q", draft)
	}
	// The diagnosis is of the draft it read, so it is not the current
	// draft's: the card lists none until the edited draft is diagnosed.
	if n := e.scalar(`SELECT count(*) FROM worksheet_diagnoses WHERE worksheet_id = $1 AND pass = 3`, id); n != 1 {
		t.Fatalf("%d diagnoses stored", n)
	}
	listed := e.json(http.MethodGet, "/v1/worksheets/"+id+"/diagnoses", nil, http.StatusOK)
	if list, _ := listed["diagnoses"].([]any); len(list) != 0 {
		t.Fatalf("a diagnosis of the old draft is listed as current: %v", listed)
	}
}
