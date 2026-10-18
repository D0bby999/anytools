package app

// mastery_learn_e2e_test.go — AC2, end to end, through the wiring.
//
// Learn → quiz correct → explain-back fails (the gap cites the passage that
// closes it) → explain-back passes → the module graduates IN THAT REQUEST,
// with no further quiz answer. The model is the scripted OpenAI-compatible
// upstream of quiz_mastery_e2e_test.go, reached through the real BYOK chain.

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/testutil"
)

// learnReply teaches from the first passage it was shown.
func learnReply(user string) any {
	ids := passageIDs.FindAllStringSubmatch(user, -1)
	return map[string]any{"explanation": "Parametric memory is what the model learned in training, " +
		"held in its weights. [[cite:chunk:" + ids[0][1] + "]] It is not the retrieved passages. " +
		"[[cite:chunk:" + bogusChunk + "]]"}
}

// explainBackReply passes an explanation that says where the memory lives,
// and otherwise names that gap with a real and an invented citation.
func explainBackReply(user string) any {
	ids := passageIDs.FindAllStringSubmatch(user, -1)
	_, learner, _ := strings.Cut(user, "The learner's explanation:")
	if strings.Contains(strings.ToLower(learner), "weights") {
		return map[string]any{"gaps": []string{}, "misconceptions": []string{},
			"feedback": "You said where it lives and why. [[cite:chunk:" + ids[0][1] + "]]", "passed": true}
	}
	return map[string]any{
		"gaps": []string{"You did not say where parametric memory is stored. [[cite:chunk:" + ids[0][1] +
			"]] [[cite:chunk:" + bogusChunk + "]]"},
		"misconceptions": []string{},
		"feedback":       "Say where it lives.",
		"passed":         false,
	}
}

func TestLearnThenExplainBackGraduatesTheModuleInTheSameRequest(t *testing.T) {
	e, model, clock, kbID := newQuizE2E(t)

	created := e.json(http.MethodPost, "/v1/mastery/paths",
		map[string]any{"kb_id": kbID, "goal": "Explain parametric memory"}, http.StatusCreated)
	pathID := mapAt(created, "path")["id"].(string)
	detail := e.json(http.MethodPost, "/v1/mastery/paths/"+pathID+"/approve", map[string]any{"modules": []any{
		map[string]any{"name": "Memory in RAG", "objective": "Explain parametric memory", "pass_threshold": 0.5,
			"knowledge_points": []any{map[string]string{"name": "Parametric memory", "type": "concept"}}},
	}}, http.StatusCreated)
	kpID := detail["modules"].([]any)[0].(map[string]any)["knowledge_points"].([]any)[0].(map[string]any)["knowledge_point"].(map[string]any)["id"].(string)
	if gate := e.json(http.MethodGet, "/v1/mastery/paths/"+pathID, nil, http.StatusOK)["explain_gate"]; gate != true {
		t.Fatalf("a new path is not gated: explain_gate = %v", gate)
	}

	// 1. Learn: the session teaches before it tests, with a real citation.
	next := e.json(http.MethodGet, "/v1/mastery/paths/"+pathID+"/next", nil, http.StatusOK)
	explanation := mapAt(next, "explanation")
	if next["kind"] != "learn" || explanation == nil {
		t.Fatalf("first Next = %v; want a learn card", next)
	}
	body := explanation["body_md"].(string)
	if !strings.Contains(body, "[[cite:chunk:") || strings.Contains(body, bogusChunk) {
		t.Fatalf("explanation body %q: want the real citation only", body)
	}
	if srcs := explanation["sources"].([]any); len(srcs) != 1 {
		t.Fatalf("explanation sources = %v", srcs)
	}
	// "Got it, test me" / "Teach me this" again: cached, no second call.
	again := e.json(http.MethodPost, "/v1/mastery/points/"+kpID+"/learn", nil, http.StatusOK)
	if again["cached"] != true || model.count("learn") != 1 {
		t.Fatalf("second learn: cached=%v, learn calls=%d", again["cached"], model.count("learn"))
	}

	// 2. Quiz: two correct answers put the point over its 0.5 bar.
	for i := 0; i < 2; i++ {
		q := e.json(http.MethodPost, "/v1/mastery/paths/"+pathID+"/diagnostic", nil, http.StatusCreated)["questions"].([]any)[0].(map[string]any)
		res := e.json(http.MethodPost, fmt.Sprintf("/v1/questions/%s/attempt", q["id"]),
			map[string]any{"user_answer": "B"}, http.StatusCreated)
		if mapAt(res, "attempt")["is_correct"] != true {
			t.Fatalf("attempt %d = %v", i, res)
		}
	}
	// Over the bar and not due: the explain-back is the ONLY thing missing.
	var (
		estimate float64
		dueAt    time.Time
		status   string
	)
	if err := e.pool.QueryRow(t.Context(), `SELECT mastery_estimate, due_at, status FROM kp_state WHERE kp_id = $1`, kpID).
		Scan(&estimate, &dueAt, &status); err != nil {
		t.Fatal(err)
	}
	if estimate < 0.5 || !dueAt.After(clock.Now()) || status != "active" {
		t.Fatalf("before the explain-back: estimate %.2f, due %v (now %v), status %s; want over the bar, not due, active",
			estimate, dueAt, clock.Now(), status)
	}
	next = e.json(http.MethodGet, "/v1/mastery/paths/"+pathID+"/next", nil, http.StatusOK)
	if next["kind"] != "explain_back" || next["prompt"] == "" {
		t.Fatalf("Next after a correct answer = %v; want the explain-back", next)
	}

	// 3. A weak explanation fails and names the gap, citing the passage.
	failReq := uuid.NewString()
	failed := e.json(http.MethodPost, "/v1/mastery/points/"+kpID+"/explain-back",
		map[string]any{"text": "It is the stuff a model memorises during training.", "request_id": failReq}, http.StatusCreated)
	attempt := mapAt(failed, "attempt")
	gaps, _ := attempt["gaps"].([]any)
	if attempt["verdict"] != "failed" || len(gaps) != 1 {
		t.Fatalf("failed explain-back = %v", failed)
	}
	if gap := gaps[0].(string); !strings.Contains(gap, "[[cite:chunk:") || strings.Contains(gap, bogusChunk) {
		t.Fatalf("gap %q: want the real passage's citation and not the invented one", gap)
	}
	if srcs := attempt["sources"].([]any); len(srcs) != 1 || srcs[0].(map[string]any)["page"].(float64) < 1 {
		t.Fatalf("gap sources = %v; want the one real passage with its page", srcs)
	}
	if grads := failed["graduated"].([]any); len(grads) != 0 {
		t.Fatalf("a failed explain-back graduated %v", grads)
	}

	// 4. A good explanation passes, and the module graduates in this request.
	passReq := uuid.NewString()
	passed := e.json(http.MethodPost, "/v1/mastery/points/"+kpID+"/explain-back",
		map[string]any{"text": "It is what a model learned in training, stored in its weights rather than in retrieved text.",
			"request_id": passReq}, http.StatusCreated)
	if mapAt(passed, "attempt")["verdict"] != "passed" {
		t.Fatalf("passing explain-back = %v", passed)
	}
	grads := passed["graduated"].([]any)
	if len(grads) != 1 || grads[0].(map[string]any)["name"] != "Memory in RAG" {
		t.Fatalf("graduated = %v; want the module, in the same request", grads)
	}

	// 5. A replayed request id returns the stored verdict and bills nothing.
	judged := model.count("explain_back")
	replay := e.json(http.MethodPost, "/v1/mastery/points/"+kpID+"/explain-back",
		map[string]any{"text": "It is what a model learned in training, stored in its weights rather than in retrieved text.",
			"request_id": passReq}, http.StatusOK)
	if replay["replayed"] != true || mapAt(replay, "attempt")["verdict"] != "passed" || model.count("explain_back") != judged {
		t.Fatalf("replay = %v, judge calls %d → %d", replay, judged, model.count("explain_back"))
	}

	// The map shows it explained and graduated.
	mod := e.json(http.MethodGet, "/v1/mastery/paths/"+pathID, nil, http.StatusOK)["modules"].([]any)[0].(map[string]any)
	kp := mod["knowledge_points"].([]any)[0].(map[string]any)
	if mod["graduated"] != true || mapAt(kp, "state")["explain_passed_at"] == nil {
		t.Fatalf("module after the pass = %v", mod)
	}

	// 6. The learner disputes the earlier failure: recorded as theirs.
	failedID := attempt["id"].(string)
	over := e.json(http.MethodPost, "/v1/mastery/explain-back/"+failedID+"/override", nil, http.StatusOK)
	if a := mapAt(over, "attempt"); a["verdict"] != "failed" || a["override_passed"] != true {
		t.Fatalf("override = %v; want the judge's verdict kept and the learner's beside it", over)
	}
	if got := e.status(http.MethodPost, "/v1/mastery/explain-back/"+failedID+"/override", nil); got != http.StatusBadRequest {
		t.Errorf("second override: status %d, want 400", got)
	}

	// Isolation: another account gets 404 on every one of the three routes.
	stranger := e.as(testutil.NewUser(t, e.pool))
	for _, probe := range []struct {
		path string
		body any
	}{
		{"/v1/mastery/points/" + kpID + "/learn", map[string]any{}},
		{"/v1/mastery/points/" + kpID + "/explain-back", map[string]any{"text": "Stolen explanation of it all.", "request_id": uuid.NewString()}},
		{"/v1/mastery/explain-back/" + failedID + "/override", nil},
	} {
		if got := stranger.status(http.MethodPost, probe.path, probe.body); got != http.StatusNotFound {
			t.Errorf("stranger POST %s: status %d, want 404", probe.path, got)
		}
	}
	// The stranger reusing the learner's request id gets nothing of theirs.
	if got := stranger.status(http.MethodPost, "/v1/mastery/points/"+kpID+"/explain-back",
		map[string]any{"text": "Replaying someone else's key here.", "request_id": passReq}); got != http.StatusNotFound {
		t.Errorf("stranger replaying the learner's request id: status %d, want 404", got)
	}
}
