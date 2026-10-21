package chatapi_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Documents a question points at (`@`, plan 261021-1100 phase 2).

// realDocument writes a knowledge base row (the harness's KB is otherwise only
// known to the fake authorizer) and a document in it, both owned by owner.
func realDocument(t *testing.T, h *harness, owner, kbID uuid.UUID, title string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	if _, err := h.pool.Exec(ctx,
		`INSERT INTO knowledge_bases (id, user_id, name) VALUES ($1, $2, 'Refs') ON CONFLICT (id) DO NOTHING`,
		kbID, owner); err != nil {
		t.Fatal(err)
	}
	var id uuid.UUID
	if err := h.pool.QueryRow(ctx, `
		INSERT INTO documents (user_id, kb_id, source_kind, title, mime, bytes, sha256)
		VALUES ($1, $2, 'upload', $3, 'text/plain', 1, encode(sha256($4::bytea), 'hex')) RETURNING id`,
		owner, kbID, title, uuid.NewString()).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestAQuestionCanPointAtDocumentsInItsConversation(t *testing.T) {
	h := newHarness(t)
	provider := answerOnly("an answer")
	p := h.start(t, provider)
	sessionID := h.createSession(t, p)
	doc := realDocument(t, h, h.userID, h.kbID, "Cell biology notes")

	res := h.do(t, p, http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
		map[string]any{"message": "What is ATP?", "references": []string{doc.String(), doc.String()}})
	decode[map[string]any](t, res, http.StatusAccepted)
	p.await(t)

	sent := provider.sentRequests()
	if len(sent) == 0 {
		t.Fatal("no request reached the provider")
	}
	var prompt strings.Builder
	for _, m := range sent[0].Messages {
		prompt.WriteString(m.Content)
	}
	if !strings.Contains(prompt.String(), `"Cell biology notes" (document id `+doc.String()+`)`) {
		t.Fatalf("the model was not told which document the learner pointed at:\n%s", prompt.String())
	}
}

func TestPointingAtADocumentOutsideTheConversationIsNotFound(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answerOnly("an answer"))
	sessionID := h.createSession(t, p)
	realDocument(t, h, h.userID, h.kbID, "Attached")
	elsewhere := realDocument(t, h, h.userID, uuid.New(), "In another knowledge base")

	var stranger uuid.UUID
	if err := h.pool.QueryRow(context.Background(),
		`INSERT INTO users (email) VALUES ($1) RETURNING id`, "refs-"+uuid.NewString()+"@example.test").Scan(&stranger); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = h.pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, stranger) })
	theirs := realDocument(t, h, stranger, uuid.New(), "Theirs")

	many := make([]string, 9)
	for i := range many {
		many[i] = uuid.NewString()
	}
	for name, tc := range map[string]struct {
		refs []string
		want int
	}{
		"a document in a knowledge base the conversation does not read": {[]string{elsewhere.String()}, http.StatusNotFound},
		"another user's document": {[]string{theirs.String()}, http.StatusNotFound},
		"no such document":        {[]string{uuid.NewString()}, http.StatusNotFound},
		"not an id":               {[]string{"nope"}, http.StatusNotFound},
		"more than eight":         {many, http.StatusBadRequest},
	} {
		res := h.do(t, p, http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
			map[string]any{"message": "Question", "references": tc.refs})
		res.Body.Close()
		if res.StatusCode != tc.want {
			t.Errorf("%s: %d, want %d", name, res.StatusCode, tc.want)
		}
	}
	// Refused before anything was stored.
	if msgs := transcript(t, h, p, sessionID); len(msgs) != 0 {
		t.Fatalf("a refused question was stored: %+v", msgs)
	}
}
