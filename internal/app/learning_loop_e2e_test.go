package app

// learning_loop_e2e_test.go — AC5, end to end, through the wiring.
//
// Minimal start → the gate is shut with reasons → a real quiz attempt (the
// scripted model reached through the real BYOK chain) → the nightly job and
// the live endpoint both suggest it → accept, score 0–2, write back → the gate
// still wants a second review → second review → advance → the stack gate wants
// delayed and transfer evidence → an evidence chain with all four timepoints
// opens it. The Playwright flow the phase file names is proven here instead;
// the web package has no browser runner (see the delegate report).

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/learning/loop"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// answer generates one multiple-choice question and answers it, returning the
// attempt id: a record the product made, which is what evidence points at.
func (e *e2e) answerOne(t *testing.T, kbID string) string {
	t.Helper()
	gen := e.json(http.MethodPost, "/v1/quiz/generate",
		map[string]any{"kb_id": kbID, "n": 1, "types": []string{"mcq"}}, http.StatusCreated)
	q := gen["questions"].([]any)[0].(map[string]any)
	res := e.json(http.MethodPost, fmt.Sprintf("/v1/questions/%s/attempt", q["id"]),
		map[string]any{"user_answer": "B"}, http.StatusCreated)
	return mapAt(res, "attempt")["id"].(string)
}

func (e *e2e) gateMissing(t *testing.T, cycleID string) string {
	t.Helper()
	body := e.json(http.MethodPost, "/v1/cycles/"+cycleID+"/advance", nil, http.StatusConflict)
	if body["code"] != "gate_closed" || len(mapAt(body, "gate")["cannot_prove"].([]any)) == 0 {
		t.Fatalf("shut gate body = %v", body)
	}
	return fmt.Sprint(body["problems"])
}

func TestLearningLoopAC5(t *testing.T) {
	e, _, clock, kbUUID := newQuizE2E(t)
	kbID := kbUUID.String()

	started := e.json(http.MethodPost, "/v1/learning/states", map[string]string{
		"goal": "Explain the two memories of RAG", "real_scenario": "A design review at work",
		"outcome_12w": "Explain it to a colleague without notes", "first_task": "Answer one question a day",
	}, http.StatusCreated)
	stateID := mapAt(started, "state")["id"].(string)
	cycleID := mapAt(started, "cycle")["id"].(string)

	// The gate is shut, and says why.
	if missing := e.gateMissing(t, cycleID); !strings.Contains(missing, "baseline") || !strings.Contains(missing, "weekly reviews") {
		t.Fatalf("calibrate gate missing = %s", missing)
	}

	// A real attempt, then the nightly job proposes it for this week.
	first := e.answerOne(t, kbID)
	job := loop.NewSuggestJob(e.pool, pg.NewLoopStore(e.pool))
	job.SetClock(clock.Now)
	if n, ran, err := job.RunOnce(t.Context()); err != nil || !ran || n < 1 {
		t.Fatalf("suggest job: n=%d ran=%v err=%v", n, ran, err)
	}
	live := e.json(http.MethodGet, "/v1/learning/evidence/suggest?cycle_id="+cycleID, nil, http.StatusOK)
	var hint string
	for _, raw := range live["suggestions"].([]any) {
		s := raw.(map[string]any)
		if s["ref_id"] == first {
			hint = fmt.Sprint(s["timepoint"], "/", s["status"])
		}
	}
	if hint != "baseline/suggested" {
		t.Fatalf("live suggestion for the attempt = %q, want baseline/suggested (%v)", hint, live)
	}

	detail := e.json(http.MethodGet, "/v1/cycles/"+cycleID, nil, http.StatusOK)
	review1 := detail["reviews"].([]any)[0].(map[string]any)["id"].(string)
	rv := e.json(http.MethodGet, "/v1/weekly-reviews/"+review1, nil, http.StatusOK)
	sugg := rv["evidence"].([]any)[0].(map[string]any)
	if sugg["status"] != "suggested" || sugg["suggested_by"] != "job" || rv["cannot_prove"] == "" {
		t.Fatalf("review 1 = %v", rv)
	}
	// Writeback is refused until something is accepted and scored.
	if body := e.json(http.MethodPost, "/v1/weekly-reviews/"+review1+"/writeback", nil, http.StatusConflict); body["code"] != "not_ready" {
		t.Fatalf("early writeback = %v", body)
	}
	e.json(http.MethodPatch, "/v1/learning/evidence/"+sugg["id"].(string), map[string]any{"status": "accepted"}, http.StatusOK)
	score := map[string]any{"completion": 2, "quality": 1, "retention": 1, "transfer": 0,
		"one_variable_change": "Answer before reading, not after",
		"errors": []any{map[string]any{"evidence": "Could not apply it to a new case", "cause": "Only drilled definitions",
			"confidence": "medium", "next_test": "One applied question a day", "stop_condition": "Two weeks, no change"}}}
	e.json(http.MethodPatch, "/v1/weekly-reviews/"+review1, score, http.StatusOK)
	wb := e.json(http.MethodPost, "/v1/weekly-reviews/"+review1+"/writeback", nil, http.StatusOK)
	if hyps := mapAt(wb, "state")["hypotheses"].([]any); len(hyps) != 2 {
		t.Fatalf("hypotheses after writeback = %v", hyps)
	}

	// A baseline and one review: still shut, and it says how many are done.
	if missing := e.gateMissing(t, cycleID); !strings.Contains(missing, "(1 done so far)") || strings.Contains(missing, "baseline") {
		t.Fatalf("after one review, missing = %s", missing)
	}
	secondWeek(t, e, kbID, cycleID, score)

	moved := e.json(http.MethodPost, "/v1/cycles/"+cycleID+"/advance", nil, http.StatusOK)
	if moved["phase"] != "stack" || len(moved["gate_evidence"].([]any)) != 1 {
		t.Fatalf("after advance = %v", moved)
	}
	if missing := e.gateMissing(t, cycleID); !strings.Contains(missing, "delayed") || !strings.Contains(missing, "transfer") {
		t.Fatalf("stack gate missing = %s", missing)
	}
	fourTimepoints(t, e, kbID, stateID, first)
	if moved := e.json(http.MethodPost, "/v1/cycles/"+cycleID+"/advance", nil, http.StatusOK); moved["phase"] != "deliver" {
		t.Fatalf("after second advance = %v", moved)
	}
	if missing := e.gateMissing(t, cycleID); !strings.Contains(missing, "last phase") {
		t.Fatalf("deliver gate = %s", missing)
	}
}

// secondWeek opens week 2's review by hand, attaches a fresh attempt as its
// evidence, scores it and writes it back.
func secondWeek(t *testing.T, e *e2e, kbID, cycleID string, score map[string]any) {
	t.Helper()
	review := e.json(http.MethodPost, "/v1/cycles/"+cycleID+"/reviews", map[string]any{"week": 2}, http.StatusCreated)["id"].(string)
	e.json(http.MethodPost, "/v1/weekly-reviews/"+review+"/evidence",
		map[string]any{"kind": "question_attempt", "ref_id": e.answerOne(t, kbID)}, http.StatusCreated)
	e.json(http.MethodPatch, "/v1/weekly-reviews/"+review, score, http.StatusOK)
	e.json(http.MethodPost, "/v1/weekly-reviews/"+review+"/writeback", nil, http.StatusOK)
}

// fourTimepoints builds one evidence chain with a real record at each of the
// four timepoints and checks the chain view places them in four columns.
func fourTimepoints(t *testing.T, e *e2e, kbID, stateID, baseline string) {
	t.Helper()
	chain := e.json(http.MethodPost, "/v1/learning/states/"+stateID+"/chains", map[string]any{
		"question": "Can I tell parametric from non-parametric memory?",
		"split":    map[string]string{"fact": "3 of 4 right", "interpretation": "Holding", "hypothesis": "Spacing helps"},
	}, http.StatusCreated)["id"].(string)
	refs := map[string]string{
		"baseline": baseline, "immediate": e.answerOne(t, kbID),
		"delayed": e.answerOne(t, kbID), "transfer": e.answerOne(t, kbID),
	}
	for _, tp := range loop.Timepoints() {
		e.json(http.MethodPost, "/v1/learning/chains/"+chain+"/evidence",
			map[string]any{"kind": "question_attempt", "ref_id": refs[tp], "timepoint": tp}, http.StatusCreated)
	}
	view := e.json(http.MethodGet, "/v1/learning/chains/"+chain, nil, http.StatusOK)
	cols := view["columns"].([]any)
	if view["complete"] != true || len(cols) != 4 || view["cannot_prove"] == "" {
		t.Fatalf("chain view = %v", view)
	}
	for i, tp := range loop.Timepoints() {
		col := cols[i].(map[string]any)
		got := col["refs"].([]any)
		if col["timepoint"] != tp || len(got) != 1 || got[0].(map[string]any)["target"] == nil {
			t.Fatalf("column %s = %v", tp, col)
		}
	}
}

// TestResumeHandoverIsValidatedAgainstTheRevision: a resume chat is linked to
// the state, and a paste-back is accepted only with the state's current
// revision — once.
func TestResumeHandoverIsValidatedAgainstTheRevision(t *testing.T) {
	e, _, _, _ := newQuizE2E(t)
	started := e.json(http.MethodPost, "/v1/learning/states", map[string]string{
		"goal": "g", "real_scenario": "s", "outcome_12w": "o", "first_task": "t",
	}, http.StatusCreated)
	stateID := mapAt(started, "state")["id"].(string)

	resumed := e.json(http.MethodPost, "/v1/learning/states/"+stateID+"/resume", nil, http.StatusCreated)
	if got := e.scalar(`SELECT count(*) FROM chat_sessions WHERE id = $1 AND learning_state_id = $2`,
		resumed["session_id"], stateID); got != 1 {
		t.Fatal("the resume session is not linked to the state")
	}

	rev := e.json(http.MethodGet, "/v1/learning/states/"+stateID, nil, http.StatusOK)["revision"].(string)
	block := func(r string) string {
		return "```" + loop.PasteBackFence + "\n" + fmt.Sprintf(`{"revision":%q,"restated":["Goal: g"],`+
			`"exercise":{"prompt":"Say it back","outcome":"Mostly right"},"unknowns":[],`+
			`"next_task":"Two questions a day","handover_md":"Recall is fine; application is weak."}`, r) + "\n```"
	}
	bad := e.json(http.MethodPost, "/v1/learning/states/"+stateID+"/handover",
		map[string]any{"text": block("invented"), "accept": true}, http.StatusOK)
	if bad["valid"] != false || bad["accepted"] != false {
		t.Fatalf("invented revision = %v", bad)
	}
	good := e.json(http.MethodPost, "/v1/learning/states/"+stateID+"/handover",
		map[string]any{"text": block(rev), "accept": true, "accept_next_task": true}, http.StatusOK)
	st := mapAt(good, "state")
	if good["accepted"] != true || st["handover_md"] != "Recall is fine; application is weak." || st["next_task"] != "Two questions a day" {
		t.Fatalf("accepted handover = %v", good)
	}
	again := e.json(http.MethodPost, "/v1/learning/states/"+stateID+"/handover",
		map[string]any{"text": block(rev), "accept": true}, http.StatusOK)
	if again["valid"] != false {
		t.Fatalf("the same block was accepted twice: %v", again)
	}
}
