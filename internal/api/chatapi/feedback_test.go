package chatapi_test

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Like / Dislike on an answer (plan 261021-1100 phase 1, after postclaw's
// per-answer ratings).

func ratings(t *testing.T, h *harness, p *process, sessionID string) []map[string]any {
	t.Helper()
	out := decode[map[string]any](t,
		h.do(t, p, http.MethodGet, "/v1/chat/sessions/"+sessionID+"/feedback", nil), http.StatusOK)
	var list []map[string]any
	for _, f := range out["feedback"].([]any) {
		list = append(list, f.(map[string]any))
	}
	return list
}

func TestARatingNamesTheModelThatAnswered(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("an answer"))
	sessionID := h.createSession(t, p)
	h.createTurn(t, p, sessionID, "Question")
	p.await(t)
	answerID := transcript(t, h, p, sessionID)[1]["id"].(string)

	// A model in the body is refused outright: attribution is the server's.
	forged := h.do(t, p, http.MethodPut, "/v1/chat/messages/"+answerID+"/feedback",
		map[string]any{"rating": "good", "model": "forged"})
	forged.Body.Close()
	if forged.StatusCode != http.StatusBadRequest {
		t.Fatalf("a body naming the model: %d, want 400", forged.StatusCode)
	}
	got := decode[map[string]any](t, h.do(t, p, http.MethodPut, "/v1/chat/messages/"+answerID+"/feedback",
		map[string]any{"rating": "good"}), http.StatusOK)
	if got["rating"] != "good" || got["provider"] != "scripted" || got["model"] != "scripted-1" {
		t.Fatalf("rating = %+v", got)
	}

	// Rating again overwrites; a Dislike carries its reason.
	decode[map[string]any](t, h.do(t, p, http.MethodPut, "/v1/chat/messages/"+answerID+"/feedback",
		map[string]any{"rating": "bad", "category": "unclear", "comment": "  too vague  "}), http.StatusOK)
	list := ratings(t, h, p, sessionID)
	if len(list) != 1 || list[0]["rating"] != "bad" || list[0]["category"] != "unclear" || list[0]["comment"] != "too vague" {
		t.Fatalf("ratings = %+v", list)
	}

	// Retracting deletes, and retracting twice is fine.
	for range 2 {
		res := h.do(t, p, http.MethodDelete, "/v1/chat/messages/"+answerID+"/feedback", nil)
		res.Body.Close()
		if res.StatusCode != http.StatusNoContent {
			t.Fatalf("delete: %d", res.StatusCode)
		}
	}
	if list := ratings(t, h, p, sessionID); len(list) != 0 {
		t.Fatalf("ratings after retracting = %+v", list)
	}
}

func TestOnlyAnAnswerCanBeRatedAndOnlyWithAKnownReason(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("an answer"))
	sessionID := h.createSession(t, p)
	h.createTurn(t, p, sessionID, "Question")
	p.await(t)
	msgs := transcript(t, h, p, sessionID)
	question, answer := msgs[0]["id"].(string), msgs[1]["id"].(string)

	for name, tc := range map[string]struct {
		id   string
		body map[string]any
		want int
	}{
		"a question":             {question, map[string]any{"rating": "good"}, http.StatusNotFound},
		"no such message":        {uuid.NewString(), map[string]any{"rating": "good"}, http.StatusNotFound},
		"not an id":              {"nope", map[string]any{"rating": "good"}, http.StatusNotFound},
		"an unknown rating":      {answer, map[string]any{"rating": "meh"}, http.StatusBadRequest},
		"a Like with a reason":   {answer, map[string]any{"rating": "good", "category": "unclear"}, http.StatusBadRequest},
		"an unknown reason":      {answer, map[string]any{"rating": "bad", "category": "rude"}, http.StatusBadRequest},
		"a comment too long":     {answer, map[string]any{"rating": "bad", "comment": strings.Repeat("é", 2001)}, http.StatusBadRequest},
		"a comment at the limit": {answer, map[string]any{"rating": "bad", "comment": strings.Repeat("é", 2000)}, http.StatusOK},
	} {
		res := h.do(t, p, http.MethodPut, "/v1/chat/messages/"+tc.id+"/feedback", tc.body)
		res.Body.Close()
		if res.StatusCode != tc.want {
			t.Errorf("%s: %d, want %d", name, res.StatusCode, tc.want)
		}
	}
}

func TestASecondUserCannotRateOrReadAnotherUsersAnswers(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("an answer"))
	sessionID := h.createSession(t, p)
	h.createTurn(t, p, sessionID, "Question")
	p.await(t)
	answerID := transcript(t, h, p, sessionID)[1]["id"].(string)
	decode[map[string]any](t, h.do(t, p, http.MethodPut, "/v1/chat/messages/"+answerID+"/feedback",
		map[string]any{"rating": "good"}), http.StatusOK)

	second := newHarness(t)
	second.pool = h.pool
	p2 := second.start(t, answerOnly())
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/v1/chat/sessions/" + sessionID + "/feedback"},
		{http.MethodPut, "/v1/chat/messages/" + answerID + "/feedback"},
	} {
		res := second.do(t, p2, tc.method, tc.path, map[string]any{"rating": "bad"})
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Errorf("%s %s: %d %s", tc.method, tc.path, res.StatusCode, body)
		}
	}
	// A second user's delete is a 404 and removes nothing of the owner's.
	res := second.do(t, p2, http.MethodDelete, "/v1/chat/messages/"+answerID+"/feedback", nil)
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("a stranger's delete: %d, want 404", res.StatusCode)
	}
	if list := ratings(t, h, p, sessionID); len(list) != 1 || list[0]["rating"] != "good" {
		t.Fatalf("the owner's rating after a stranger's attempts = %+v", list)
	}
}

func TestAskingAgainDropsTheOldAnswersRating(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("first", "second"))
	sessionID := h.createSession(t, p)
	h.createTurn(t, p, sessionID, "Question")
	p.await(t)
	msgs := transcript(t, h, p, sessionID)
	decode[map[string]any](t, h.do(t, p, http.MethodPut, "/v1/chat/messages/"+msgs[1]["id"].(string)+"/feedback",
		map[string]any{"rating": "bad"}), http.StatusOK)

	decode[map[string]any](t, h.do(t, p, http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
		map[string]any{"rewind_to_id": msgs[0]["id"]}), http.StatusAccepted)
	p.await(t)
	if list := ratings(t, h, p, sessionID); len(list) != 0 {
		t.Fatalf("the regenerated answer kept the old rating: %+v", list)
	}
}

func TestTheListMarksAConversationWithATurnInFlight(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("an answer"))
	running := h.createSession(t, p)
	idle := h.createSession(t, p)
	h.createTurn(t, p, idle, "Question")
	p.await(t)

	// A turn that has not ended, written as the orchestrator leaves one
	// waiting on the learner.
	if _, err := h.pool.Exec(t.Context(),
		`INSERT INTO turns (user_id, session_id, status) VALUES ($1, $2, 'waiting_user')`,
		h.userID, running); err != nil {
		t.Fatal(err)
	}
	out := decode[map[string]any](t, h.do(t, p, http.MethodGet, "/v1/chat/sessions", nil), http.StatusOK)
	seen := map[string]any{}
	for _, s := range out["sessions"].([]any) {
		m := s.(map[string]any)
		seen[m["id"].(string)] = m["running"]
	}
	if seen[running] != true || seen[idle] != nil {
		t.Fatalf("running flags = %+v", seen)
	}
}
