package chatapi_test

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// Phase 5 of plan 261021-1100 at the API: a turn can ask another model on
// the route once, a message loses its control characters, and a session
// says where its summary stops.

func TestATurnMayNameAModelOnTheChatRouteOnly(t *testing.T) {
	h := newHarness(t)
	provider := answerOnly("an answer")
	p := h.start(t, provider)
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
	turn := func(id string) *http.Response {
		return h.do(t, p, http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
			map[string]any{"message": "What is ATP?", "connection_id": id, "model": "gpt-4o-mini"})
	}
	for name, id := range map[string]string{"not on the chat route": offRoute.String(), "no such": uuid.NewString(), "not an id": "x"} {
		res := turn(id)
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Errorf("%s: %d", name, res.StatusCode)
		}
	}

	decode[map[string]any](t, turn(onRoute.String()), http.StatusAccepted)
	p.await(t)
	if got := provider.sentRequests()[0].Model; got != "gpt-4o-mini" {
		t.Fatalf("the turn asked %q", got)
	}
	session := decode[map[string]any](t, h.do(t, p, http.MethodGet, "/v1/chat/sessions/"+sessionID, nil), http.StatusOK)
	if _, pinned := session["connection_id"]; pinned {
		t.Fatalf("one turn's pick pinned the conversation: %+v", session)
	}
}

func TestAMessageLosesItsControlCharacters(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("ok"))
	sessionID := h.createSession(t, p)
	decode[map[string]any](t, h.do(t, p, http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
		map[string]any{"message": "AT\x00P\u202e?"}), http.StatusAccepted)
	p.await(t)
	var content string
	if err := h.pool.QueryRow(context.Background(),
		`SELECT content FROM chat_messages WHERE session_id = $1 AND role = 'user'`, sessionID).Scan(&content); err != nil {
		t.Fatal(err)
	}
	if content != "ATP?" {
		t.Fatalf("stored %q", content)
	}
}

func TestASessionSaysWhereItsSummaryStops(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("ok"))
	sessionID := h.createSession(t, p)
	h.createTurn(t, p, sessionID, "first question")
	p.await(t)

	var lastID uuid.UUID
	if err := h.pool.QueryRow(context.Background(),
		`SELECT id FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`, sessionID).Scan(&lastID); err != nil {
		t.Fatal(err)
	}
	if err := p.chat.SetSummary(context.Background(), h.userID, uuid.MustParse(sessionID), "Goal: ATP", lastID); err != nil {
		t.Fatal(err)
	}
	got := decode[map[string]any](t, h.do(t, p, http.MethodGet, "/v1/chat/sessions/"+sessionID, nil), http.StatusOK)
	if got["summary"] != "Goal: ATP" || got["summary_through_id"] != lastID.String() {
		t.Fatalf("session = %+v", got)
	}
	list := decode[map[string]any](t, h.do(t, p, http.MethodGet, "/v1/chat/sessions", nil), http.StatusOK)
	if fmt.Sprint(list) == "" || containsKey(list, "summary") {
		t.Fatal("the list carries summaries")
	}
}

func containsKey(v any, key string) bool {
	switch t := v.(type) {
	case map[string]any:
		if _, ok := t[key]; ok {
			return true
		}
		for _, x := range t {
			if containsKey(x, key) {
				return true
			}
		}
	case []any:
		for _, x := range t {
			if containsKey(x, key) {
				return true
			}
		}
	}
	return false
}
