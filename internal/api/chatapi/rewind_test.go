package chatapi_test

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/runtime"
)

// Asking again (plan 261019-1015): regenerate and edit both rewind to a
// question and send from there.

func answerOnly(texts ...string) *scriptedProvider {
	p := &scriptedProvider{}
	for _, t := range texts {
		p.responses = append(p.responses, &runtime.ChatResponse{Content: t, FinishReason: "stop"})
	}
	return p
}

func transcript(t *testing.T, h *harness, p *process, sessionID string) []map[string]any {
	t.Helper()
	out := decode[map[string]any](t,
		h.do(t, p, http.MethodGet, "/v1/chat/sessions/"+sessionID+"/messages", nil), http.StatusOK)
	var msgs []map[string]any
	for _, m := range out["messages"].([]any) {
		msgs = append(msgs, m.(map[string]any))
	}
	return msgs
}

func untitledSession(t *testing.T, h *harness, p *process) string {
	t.Helper()
	res := h.do(t, p, http.MethodPost, "/v1/chat/sessions", map[string]any{"kb_ids": []string{h.kbID.String()}})
	return decode[map[string]any](t, res, http.StatusCreated)["id"].(string)
}

func TestRegenerateReplacesTheLastAnswer(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("first answer", "second answer"))
	sessionID := h.createSession(t, p)

	h.createTurn(t, p, sessionID, "What is a cell?")
	p.await(t)
	question := transcript(t, h, p, sessionID)[0]["id"].(string)

	res := h.do(t, p, http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
		map[string]any{"rewind_to_id": question})
	decode[map[string]any](t, res, http.StatusAccepted)
	p.await(t)

	msgs := transcript(t, h, p, sessionID)
	if len(msgs) != 2 || msgs[0]["content"] != "What is a cell?" || msgs[1]["content"] != "second answer" {
		t.Fatalf("transcript = %+v", msgs)
	}
}

func TestEditingTheLastQuestionAsksTheNewOne(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("one", "two"))
	sessionID := h.createSession(t, p)

	h.createTurn(t, p, sessionID, "What is a cel?")
	p.await(t)
	question := transcript(t, h, p, sessionID)[0]["id"].(string)

	res := h.do(t, p, http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
		map[string]any{"rewind_to_id": question, "message": "What is a cell?"})
	decode[map[string]any](t, res, http.StatusAccepted)
	p.await(t)

	msgs := transcript(t, h, p, sessionID)
	if len(msgs) != 2 || msgs[0]["content"] != "What is a cell?" {
		t.Fatalf("transcript = %+v", msgs)
	}
	// The model saw the new question once and not the old one at all.
	last := p.provider.sentRequests()[1].Messages
	for _, m := range last {
		if m.Content == "What is a cel?" {
			t.Fatal("the replaced question was still sent")
		}
	}
}

// Another user's message, an answer, or a message from another conversation
// is not something to rewind to, and nothing is deleted on the way.
func TestRewindingToSomethingElseIsNotFoundAndChangesNothing(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("answer"))
	sessionID := h.createSession(t, p)
	other := h.createSession(t, p)

	h.createTurn(t, p, sessionID, "Question")
	p.await(t)
	msgs := transcript(t, h, p, sessionID)
	answerID := msgs[1]["id"].(string)

	for name, target := range map[string]struct{ session, id string }{
		"an answer":            {sessionID, answerID},
		"a question elsewhere": {other, msgs[0]["id"].(string)},
		"no such message":      {sessionID, uuid.NewString()},
		"not an id":            {sessionID, "nope"},
	} {
		res := h.do(t, p, http.MethodPost, "/v1/chat/sessions/"+target.session+"/turns",
			map[string]any{"rewind_to_id": target.id})
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Errorf("%s: %d, want 404", name, res.StatusCode)
		}
	}
	if got := len(transcript(t, h, p, sessionID)); got != 2 {
		t.Fatalf("the transcript has %d messages after refused rewinds", got)
	}
}

// Rewinding past the message a summary ends on clears the summary: it would
// describe messages that are gone.
func TestRewindingPastTheSummaryClearsIt(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("a1"))
	sessionID := h.createSession(t, p)
	h.createTurn(t, p, sessionID, "q1")
	p.await(t)

	msgs := transcript(t, h, p, sessionID)
	q, a := uuid.MustParse(msgs[0]["id"].(string)), uuid.MustParse(msgs[1]["id"].(string))
	sid := uuid.MustParse(sessionID)
	ctx := context.Background()
	if err := p.chat.SetSummary(ctx, h.userID, sid, "old summary", a); err != nil {
		t.Fatal(err)
	}
	if _, err := p.chat.RewindTo(ctx, h.userID, sid, q); err != nil {
		t.Fatal(err)
	}
	sess, err := p.chat.GetSession(ctx, h.userID, sid)
	if err != nil {
		t.Fatal(err)
	}
	if sess.Summary != "" || sess.SummaryThroughID != nil {
		t.Fatalf("summary survived: %q %v", sess.Summary, sess.SummaryThroughID)
	}
}

func TestAnUntitledConversationIsNamedAfterItsFirstQuestion(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("a", "b"))
	sessionID := untitledSession(t, h, p)

	h.createTurn(t, p, sessionID, "  Ty thể có chức năng gì,\nvà vì sao?")
	p.await(t)
	h.createTurn(t, p, sessionID, "A second question")
	p.await(t)

	got := decode[map[string]any](t, h.do(t, p, http.MethodGet, "/v1/chat/sessions/"+sessionID, nil), http.StatusOK)
	if got["title"] != "Ty thể có chức năng gì," {
		t.Fatalf("title = %q", got["title"])
	}

	// A title the learner chose is kept.
	named := h.createSession(t, p)
	h.createTurn(t, p, named, "Anything")
	p.await(t)
	got = decode[map[string]any](t, h.do(t, p, http.MethodGet, "/v1/chat/sessions/"+named, nil), http.StatusOK)
	if got["title"] != "Test" {
		t.Fatalf("a chosen title became %q", got["title"])
	}
}

func TestSessionsCanBeSearchedByTitle(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("a"))
	for _, title := range []string{"Cell biology", "Organic chemistry", "100% done_ok"} {
		res := h.do(t, p, http.MethodPost, "/v1/chat/sessions", map[string]any{"title": title})
		res.Body.Close()
	}
	for query, want := range map[string]int{"cell": 1, "CHEM": 1, "%": 1, "_": 1, "": 3, "physics": 0} {
		out := decode[map[string]any](t,
			h.do(t, p, http.MethodGet, "/v1/chat/sessions?q="+urlQuery(query), nil), http.StatusOK)
		if got := len(out["sessions"].([]any)); got != want {
			t.Errorf("q=%q: %d sessions, want %d", query, got, want)
		}
	}
}

func urlQuery(s string) string {
	r := ""
	for _, b := range []byte(s) {
		switch {
		case b >= 'a' && b <= 'z', b >= 'A' && b <= 'Z', b >= '0' && b <= '9':
			r += string(b)
		default:
			r += "%" + string("0123456789ABCDEF"[b>>4]) + string("0123456789ABCDEF"[b&15])
		}
	}
	return r
}

// A conversation can be pinned to a connection on the caller's chat route,
// and to nothing else; "" unpins it.
func TestAConversationIsPinnedOnlyToTheCallersChatConnections(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("a"))
	sessionID := h.createSession(t, p)
	ctx := context.Background()

	var onRoute, offRoute uuid.UUID
	for i, dst := range []*uuid.UUID{&onRoute, &offRoute} {
		if err := h.pool.QueryRow(ctx, `INSERT INTO provider_connections (user_id, provider, name)
			VALUES ($1, 'openai', $2) RETURNING id`, h.userID, fmt.Sprint("key ", i)).Scan(dst); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.pool.Exec(ctx, `INSERT INTO function_routes (user_id, "function", position, connection_id, model)
		VALUES ($1, 'chat', 0, $2, 'gpt-4o')`, h.userID, onRoute); err != nil {
		t.Fatal(err)
	}

	patch := func(id string) *http.Response {
		return h.do(t, p, http.MethodPatch, "/v1/chat/sessions/"+sessionID, map[string]any{"connection_id": id})
	}
	for name, id := range map[string]string{"not on the chat route": offRoute.String(), "no such": uuid.NewString(), "not an id": "x"} {
		res := patch(id)
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Errorf("%s: %d", name, res.StatusCode)
		}
	}

	pinned := decode[map[string]any](t, patch(onRoute.String()), http.StatusOK)
	if pinned["connection_id"] != onRoute.String() {
		t.Fatalf("pin = %+v", pinned)
	}
	cleared := decode[map[string]any](t, patch(""), http.StatusOK)
	if _, ok := cleared["connection_id"]; ok {
		t.Fatalf("unpin = %+v", cleared)
	}
}
