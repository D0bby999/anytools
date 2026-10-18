package app

// quiz_mastery_e2e_test.go — AC4, end to end, through the wiring.
//
// Generate questions from an indexed PDF → answer them → read the bank; then
// build a mastery path → take the diagnostic → fail one knowledge point → watch
// it come back as due on the same day, and watch an override restore it.
//
// The model is a scripted OpenAI-compatible upstream reached through the real
// BYOK chain, exactly as grounded_chat_e2e_test.go does it; the parser and
// embedder are phase 5's replay doubles. The clock is the services' own, so
// "due again within the hour" is asserted by moving time, not by waiting.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/testutil"
)

// ── the scripted upstream ────────────────────────────────────────────────────

type quizModel struct {
	server *httptest.Server
	mu     sync.Mutex
	calls  map[string]int
	// users are the user messages each kind of call received, in order.
	users map[string][]string
}

var (
	passageIDs   = regexp.MustCompile(`id="chunk:([0-9a-f-]{36})"`)
	plannedTypes = regexp.MustCompile(`type=(mcq|short|tf|cloze)`)
	allowedTypes = regexp.MustCompile(`Allowed question types: ([a-z, ]+)\.`)
	planAtMost   = regexp.MustCompile(`Plan at most (\d+) questions`)
)

// bogusChunk is a citation no passage backs; the generator must drop it.
const bogusChunk = "00000000-0000-4000-8000-000000000000"

func newQuizModel(t *testing.T) *quizModel {
	t.Helper()
	m := &quizModel{calls: map[string]int{}, users: map[string][]string{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Stream   bool `json:"stream"`
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.Unmarshal(body, &req); err != nil || len(req.Messages) < 2 {
			t.Errorf("quiz model: unusable request %s", body)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if req.Stream {
			t.Error("quiz model: quiz and mastery calls are not streamed")
		}
		system, user := req.Messages[0].Content, req.Messages[1].Content

		var kind string
		var reply any
		switch {
		case strings.HasPrefix(system, "You are planning a set of questions"):
			kind, reply = "ideate", ideateReply(user)
		case strings.HasPrefix(system, "You are writing questions from a plan"):
			kind, reply = "generate", generateReply(user)
		case strings.HasPrefix(system, "You are marking one free-text answer"):
			kind, reply = "judge", judgeReply(user)
		case strings.HasPrefix(system, "You are turning someone's own study material into a plan"):
			kind, reply = "path", pathReply()
		case strings.HasPrefix(system, "You are teaching one idea"):
			kind, reply = "learn", learnReply(user)
		case strings.HasPrefix(system, "You are judging a learner's explanation"):
			kind, reply = "explain_back", explainBackReply(user)
		default:
			t.Errorf("quiz model: unexpected system prompt %q", truncateForMsg(system))
			http.Error(w, "unexpected", http.StatusInternalServerError)
			return
		}
		m.mu.Lock()
		m.calls[kind]++
		m.users[kind] = append(m.users[kind], user)
		m.mu.Unlock()

		content, _ := json.Marshal(reply)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "cmpl-" + kind, "object": "chat.completion", "model": "fake-1",
			"choices": []any{map[string]any{
				"index":         0,
				"message":       map[string]any{"role": "assistant", "content": "```json\n" + string(content) + "\n```"},
				"finish_reason": "stop",
			}},
			"usage": map[string]any{"prompt_tokens": 500, "completion_tokens": 80, "total_tokens": 580},
		})
	})
	m.server = httptest.NewServer(mux)
	t.Cleanup(m.server.Close)
	return m
}

// lastUser is the user message of the latest call of a kind.
func (m *quizModel) lastUser(kind string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if u := m.users[kind]; len(u) > 0 {
		return u[len(u)-1]
	}
	return ""
}

func (m *quizModel) count(kind string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls[kind]
}

func ideateReply(user string) any {
	ids := passageIDs.FindAllStringSubmatch(user, -1)
	n := 1
	if match := planAtMost.FindStringSubmatch(user); match != nil {
		fmt.Sscanf(match[1], "%d", &n)
	}
	types := []string{"mcq"}
	if match := allowedTypes.FindStringSubmatch(user); match != nil {
		types = strings.Split(match[1], ", ")
	}
	ideas := make([]any, 0, n)
	for i := 0; i < n && len(ids) > 0; i++ {
		ideas = append(ideas, map[string]any{
			"focus":      fmt.Sprintf("where parametric memory lives (%d)", i),
			"type":       types[i%len(types)],
			"difficulty": "easy",
			"chunk_ids":  []string{ids[0][1]},
		})
	}
	return map[string]any{"ideas": ideas, "note": ""}
}

func generateReply(user string) any {
	ids := passageIDs.FindAllStringSubmatch(user, -1)
	cite := "[[cite:chunk:" + ids[0][1] + "]]"
	var questions []any
	for i, match := range plannedTypes.FindAllStringSubmatch(user, -1) {
		explanation := "Parametric memory is the knowledge held in the model's weights. " + cite
		if i == 0 {
			explanation += " It is also cheap to update. [[cite:chunk:" + bogusChunk + "]]"
		}
		q := map[string]any{
			"type": match[1], "explanation": explanation, "difficulty": "easy",
			"chunk_ids": []string{ids[0][1]}, "options": []any{},
		}
		switch match[1] {
		case "mcq":
			q["prompt"] = "Where does a retrieval-augmented model keep its parametric memory?"
			q["options"] = []any{
				map[string]string{"label": "A", "body": "In the retrieved passages"},
				map[string]string{"label": "B", "body": "In the model's weights"},
				map[string]string{"label": "C", "body": "In the search index"},
				map[string]string{"label": "D", "body": "In the prompt template"},
			}
			q["answer"] = "B"
		case "tf":
			q["prompt"] = "Parametric memory is stored in the model's weights."
			q["answer"] = "true"
		case "cloze":
			q["prompt"] = "Parametric memory is stored in the model's ____."
			q["answer"] = "weights"
		default:
			q["prompt"] = "In one sentence, what is parametric memory?"
			q["answer"] = "Knowledge stored in the model's weights."
		}
		questions = append(questions, q)
	}
	return map[string]any{"questions": questions, "note": ""}
}

func judgeReply(user string) any {
	_, answered, _ := strings.Cut(user, "The learner answered:")
	if strings.Contains(strings.ToLower(answered), "weight") {
		return map[string]any{"correct": true, "reason": "Right.", "missing": []string{}, "error_type": ""}
	}
	return map[string]any{
		"correct": false, "reason": "The answer does not say where it is stored.",
		"missing": []string{"the weights"}, "error_type": "concept",
	}
}

func pathReply() any {
	return map[string]any{
		"modules": []any{map[string]any{
			"name": "Memory in RAG", "objective": "Tell the two memories apart", "pass_threshold": 0.7,
			"knowledge_points": []any{
				map[string]string{"name": "Parametric memory", "type": "concept"},
				map[string]string{"name": "Non-parametric memory", "type": "concept"},
			},
		}},
		"note": "",
	}
}

// ── harness ──────────────────────────────────────────────────────────────────

type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *testClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

// newQuizE2E is the AC4 harness: one user with an indexed PDF, every quiz and
// mastery call routed to the scripted model.
func newQuizE2E(t *testing.T) (*e2e, *quizModel, *testClock, uuid.UUID) {
	t.Helper()
	model := newQuizModel(t)
	clock := &testClock{now: time.Now().UTC()}
	e := buildE2E(t, model.server.URL, []string{"quiz", "mastery"}, clock.Now)

	kbID := uuid.MustParse(e.json(http.MethodPost, "/v1/kb",
		map[string]string{"name": "Retrieval papers"}, http.StatusCreated)["id"].(string))
	e.upload(kbID, "rag.pdf", ragFixturePDF(t))
	e.drainJobs()
	return e, model, clock, kbID
}

// as returns the same harness acting as another user.
func (e *e2e) as(user uuid.UUID) *e2e {
	other := *e
	other.user = user
	return &other
}

func (e *e2e) status(method, path string, body any) int {
	e.t.Helper()
	res := e.do(method, path, body)
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	return res.StatusCode
}

func (e *e2e) scalar(sql string, args ...any) int {
	e.t.Helper()
	var n int
	if err := e.pool.QueryRow(e.t.Context(), sql, args...).Scan(&n); err != nil {
		e.t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func mapAt(v any, keys ...string) map[string]any {
	m, _ := v.(map[string]any)
	for _, k := range keys {
		m, _ = m[k].(map[string]any)
	}
	return m
}

// ── the quiz half ────────────────────────────────────────────────────────────

func TestQuizStoresAnswersAndExplanationsAndHidesThemUntilAttempted(t *testing.T) {
	e, model, _, kbID := newQuizE2E(t)

	gen := e.json(http.MethodPost, "/v1/quiz/generate", map[string]any{
		"kb_id": kbID, "n": 2, "types": []string{"mcq", "short"},
	}, http.StatusCreated)
	questions := gen["questions"].([]any)
	if len(questions) != 2 {
		t.Fatalf("generated %d questions, want 2: %v", len(questions), gen)
	}
	if got := gen["dropped_citations"].(float64); got != 1 {
		t.Errorf("dropped_citations = %v, want 1 (the marker no passage backed)", got)
	}
	if gen["provider"] == "" || gen["model"] != "fake-1" {
		t.Errorf("provider/model not reported: %v / %v", gen["provider"], gen["model"])
	}

	var mcq, short map[string]any
	for _, raw := range questions {
		q := raw.(map[string]any)
		if _, leaked := q["answer"]; leaked {
			t.Fatalf("an unanswered question carried its answer: %v", q)
		}
		switch q["type"] {
		case "mcq":
			mcq = q
		case "short":
			short = q
		}
	}
	if mcq == nil || short == nil {
		t.Fatalf("want one mcq and one short, got %v", questions)
	}

	// Stored with answer + explanation, and the explanation cites only a real
	// passage.
	var answer, explanation string
	if err := e.pool.QueryRow(t.Context(),
		`SELECT answer, explanation FROM questions WHERE id = $1`, mcq["id"]).Scan(&answer, &explanation); err != nil {
		t.Fatalf("load stored question: %v", err)
	}
	if answer != "B" || !strings.Contains(explanation, "[[cite:chunk:") || strings.Contains(explanation, bogusChunk) {
		t.Fatalf("stored answer %q / explanation %q", answer, explanation)
	}

	// Wrong on the multiple-choice: marked in Go, no model call.
	judgesBefore := model.count("judge")
	wrong := e.json(http.MethodPost, fmt.Sprintf("/v1/questions/%s/attempt", mcq["id"]),
		map[string]any{"user_answer": "A"}, http.StatusCreated)
	if mapAt(wrong, "attempt")["is_correct"] != false || wrong["answer"] != "B" || wrong["explanation"] == "" {
		t.Fatalf("mcq attempt = %v", wrong)
	}
	sources, _ := wrong["sources"].([]any)
	if len(sources) != 1 {
		t.Fatalf("attempt sources = %v, want the one real passage", wrong["sources"])
	}
	if src := sources[0].(map[string]any); src["document_id"] == nil || src["page"].(float64) < 1 {
		t.Errorf("a source that cannot open its page: %v", src)
	}
	if model.count("judge") != judgesBefore {
		t.Error("a multiple-choice answer was sent to the model to be judged")
	}
	if wrong["scheduled"] != nil {
		t.Errorf("a bank question with no knowledge point scheduled something: %v", wrong["scheduled"])
	}

	// Right on the short answer: marked by the model with the rubric.
	right := e.json(http.MethodPost, fmt.Sprintf("/v1/questions/%s/attempt", short["id"]),
		map[string]any{"user_answer": "It is in the weights", "self_attribution": "confident"}, http.StatusCreated)
	attempt := mapAt(right, "attempt")
	if attempt["is_correct"] != true || attempt["rating"] != "easy" || mapAt(attempt, "judge")["mode"] != "llm" {
		t.Fatalf("short attempt = %v", right)
	}

	// A dispute is recorded by overriding, never pre-declared.
	if got := e.status(http.MethodPost, fmt.Sprintf("/v1/questions/%s/attempt", short["id"]),
		map[string]any{"user_answer": "x", "self_attribution": "disputed"}); got != http.StatusBadRequest {
		t.Errorf("pre-declared dispute: status %d, want 400", got)
	}

	// Override the mcq verdict once; the second is refused.
	attemptID := mapAt(wrong, "attempt")["id"]
	over := e.json(http.MethodPost, fmt.Sprintf("/v1/quiz/attempts/%s/override", attemptID),
		map[string]any{"is_correct": true}, http.StatusOK)
	if a := mapAt(over, "attempt"); a["is_correct"] != true || a["self_attribution"] != "disputed" {
		t.Fatalf("override = %v", over)
	}
	if got := e.status(http.MethodPost, fmt.Sprintf("/v1/quiz/attempts/%s/override", attemptID),
		map[string]any{"is_correct": false}); got != http.StatusBadRequest {
		t.Errorf("second override: status %d, want 400", got)
	}

	// The bank shows both, answered, with answers now revealed.
	bank := e.json(http.MethodGet, "/v1/quiz/questions?answered=true&kb_id="+kbID.String(), nil, http.StatusOK)
	entries := bank["questions"].([]any)
	if len(entries) != 2 {
		t.Fatalf("bank has %d answered entries, want 2", len(entries))
	}
	for _, raw := range entries {
		entry := raw.(map[string]any)
		q := entry["question"].(map[string]any)
		if q["revealed"] != true || q["answer"] == nil || entry["attempts"].(float64) != 1 {
			t.Errorf("bank entry = %v", entry)
		}
	}

	// Isolation: another account sees none of it.
	stranger := e.as(testutil.NewUser(t, e.pool))
	for _, probe := range []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, fmt.Sprintf("/v1/quiz/questions/%s", mcq["id"]), nil},
		{http.MethodPost, fmt.Sprintf("/v1/questions/%s/attempt", mcq["id"]), map[string]any{"user_answer": "B"}},
		{http.MethodPost, fmt.Sprintf("/v1/quiz/attempts/%s/override", attemptID), map[string]any{"is_correct": true}},
		{http.MethodGet, "/v1/quiz/questions?kb_id=" + kbID.String(), nil},
		{http.MethodPost, "/v1/quiz/generate", map[string]any{"kb_id": kbID}},
	} {
		if got := stranger.status(probe.method, probe.path, probe.body); got != http.StatusNotFound {
			t.Errorf("stranger %s %s: status %d, want 404", probe.method, probe.path, got)
		}
	}
	if got := len(stranger.json(http.MethodGet, "/v1/quiz/questions", nil, http.StatusOK)["questions"].([]any)); got != 0 {
		t.Errorf("stranger's bank lists %d questions", got)
	}
}

// ── the mastery half ─────────────────────────────────────────────────────────

func TestMasteryFailedPointIsDueAgainTheSameDay(t *testing.T) {
	e, _, clock, kbID := newQuizE2E(t)

	created := e.json(http.MethodPost, "/v1/mastery/paths",
		map[string]any{"kb_id": kbID, "goal": "Explain the two memories of RAG"}, http.StatusCreated)
	pathID := mapAt(created, "path")["id"].(string)
	proposal := mapAt(created, "proposal")["modules"].([]any)
	if len(proposal) != 1 {
		t.Fatalf("proposal = %v", created["proposal"])
	}

	detail := e.json(http.MethodPost, "/v1/mastery/paths/"+pathID+"/approve",
		map[string]any{"modules": proposal}, http.StatusCreated)
	if mods := detail["modules"].([]any); len(mods) != 1 ||
		len(mods[0].(map[string]any)["knowledge_points"].([]any)) != 2 {
		t.Fatalf("approved detail = %v", detail)
	}

	diag := e.json(http.MethodPost, "/v1/mastery/paths/"+pathID+"/diagnostic", nil, http.StatusCreated)
	qs := diag["questions"].([]any)
	if len(qs) != 2 {
		t.Fatalf("diagnostic produced %d questions, want one per knowledge point", len(qs))
	}
	failedQ := qs[0].(map[string]any)
	failedKP := failedQ["knowledge_point_id"].(string)

	// Fail the first knowledge point.
	res := e.json(http.MethodPost, fmt.Sprintf("/v1/questions/%s/attempt", failedQ["id"]),
		map[string]any{"user_answer": "A", "self_attribution": "knowledge_gap"}, http.StatusCreated)
	sched := res["scheduled"].(map[string]any)
	if sched["rating"] != "again" || sched["knowledge_point_id"] != failedKP {
		t.Fatalf("scheduled = %v", sched)
	}
	dueAt, err := time.Parse(time.RFC3339Nano, sched["due_at"].(string))
	if err != nil {
		t.Fatalf("due_at: %v", err)
	}
	if wait := dueAt.Sub(clock.Now()); wait <= 0 || wait > time.Hour {
		t.Fatalf("a failed knowledge point is due in %v; want within the hour", wait)
	}

	// Due is computed on READ: not yet, then the point is back without any job
	// having run.
	isDue := func() bool {
		for _, raw := range e.json(http.MethodGet, "/v1/mastery/due", nil, http.StatusOK)["due"].([]any) {
			if raw.(map[string]any)["knowledge_point_id"] == failedKP {
				return true
			}
		}
		return false
	}
	if isDue() {
		t.Fatal("the failed knowledge point is due before its relearning step")
	}
	clock.Advance(30 * time.Minute)
	if !isDue() {
		t.Fatal("the failed knowledge point is not due 30 minutes later")
	}

	// The session serves a due point, and counts the other as still due: the
	// relearned one and the never-answered one (new points are due from
	// approval) are both waiting.
	next := e.json(http.MethodGet, "/v1/mastery/paths/"+pathID+"/next", nil, http.StatusOK)
	if next["due"] != true || next["remaining_due"].(float64) != 1 {
		t.Fatalf("next = %v, want a due point with one more due behind it", next)
	}

	// The mistake is on the error list with the learner's own attribution.
	errs := e.json(http.MethodGet, "/v1/mastery/paths/"+pathID+"/errors", nil, http.StatusOK)["errors"].([]any)
	if len(errs) != 1 || errs[0].(map[string]any)["self_attribution"] != "knowledge_gap" {
		t.Fatalf("errors = %v", errs)
	}

	// Override: the verdict was wrong. The card is replayed from before the
	// attempt, not stepped twice — no lapse, one review — and a mistake whose
	// only evidence was that verdict is gone.
	e.json(http.MethodPost, fmt.Sprintf("/v1/quiz/attempts/%s/override", mapAt(res, "attempt")["id"]),
		map[string]any{"is_correct": true}, http.StatusOK)
	if got := e.scalar(`SELECT reviews FROM kp_state WHERE kp_id = $1`, failedKP); got != 1 {
		t.Errorf("reviews after override = %d, want 1", got)
	}
	if got := e.scalar(`SELECT lapses FROM kp_state WHERE kp_id = $1`, failedKP); got != 0 {
		t.Errorf("lapses after override = %d, want 0", got)
	}
	if got := len(e.json(http.MethodGet, "/v1/mastery/paths/"+pathID+"/errors", nil, http.StatusOK)["errors"].([]any)); got != 0 {
		t.Errorf("error records after override = %d, want 0", got)
	}

	// Isolation.
	stranger := e.as(testutil.NewUser(t, e.pool))
	for _, probe := range []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, "/v1/mastery/paths/" + pathID, nil},
		{http.MethodGet, "/v1/mastery/paths/" + pathID + "/next", nil},
		{http.MethodGet, "/v1/mastery/paths/" + pathID + "/errors", nil},
		{http.MethodPost, "/v1/mastery/paths/" + pathID + "/diagnostic", nil},
		{http.MethodPost, "/v1/mastery/paths/" + pathID + "/propose", nil},
		{http.MethodPost, "/v1/mastery/paths/" + pathID + "/approve", map[string]any{"modules": proposal}},
		{http.MethodDelete, "/v1/mastery/paths/" + pathID, nil},
	} {
		if got := stranger.status(probe.method, probe.path, probe.body); got != http.StatusNotFound {
			t.Errorf("stranger %s %s: status %d, want 404", probe.method, probe.path, got)
		}
	}
	if n := stranger.json(http.MethodGet, "/v1/mastery/due", nil, http.StatusOK)["count"].(float64); n != 0 {
		t.Errorf("stranger's due list has %v items", n)
	}
	if got := stranger.status(http.MethodPost, "/v1/mastery/paths",
		map[string]any{"kb_id": kbID, "goal": "steal"}); got != http.StatusNotFound {
		t.Errorf("stranger creating a path on someone else's KB: status %d, want 404", got)
	}
}
