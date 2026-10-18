package chatapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning/ownversion"
	"github.com/D0bby999/anytools/internal/runtime"
)

// "Write your own version first" (up-methods phase 11) over HTTP: the server
// enforces the switch, the lines reach the model under their heading on this
// turn and every later one, and a retell lands only under an answer whose
// question carried them.

var threeLines = map[string]any{
	"understanding": "UNDERSTAND-MARK", "uncertain": "UNSURE-MARK", "proof": "PROOF-MARK",
}

func (h *harness) setOwnVersionFirst(t *testing.T, on bool) {
	t.Helper()
	if _, err := h.pool.Exec(context.Background(),
		`UPDATE users SET own_version_first = $2 WHERE id = $1`, h.userID, on); err != nil {
		t.Fatal(err)
	}
}

func (h *harness) postTurn(t *testing.T, p *process, sessionID string, body map[string]any) (int, map[string]any) {
	t.Helper()
	res := h.do(t, p, http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns", body)
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func answers(n int) *scriptedProvider {
	out := &scriptedProvider{}
	for i := 0; i < n; i++ {
		out.responses = append(out.responses, &runtime.ChatResponse{Content: "An answer.", FinishReason: "stop"})
	}
	return out
}

func TestOwnVersionIsRequiredOnlyWhenSwitchedOn(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answers(4))
	sessionID := h.createSession(t, p)

	// Off: optional either way.
	if code, out := h.postTurn(t, p, sessionID, map[string]any{"message": "q1"}); code != http.StatusAccepted {
		t.Fatalf("off, without: %d %v", code, out)
	}
	p.await(t)
	if code, out := h.postTurn(t, p, sessionID, map[string]any{"message": "q2", "own_version": threeLines}); code != http.StatusAccepted {
		t.Fatalf("off, with: %d %v", code, out)
	}
	p.await(t)

	// On: refused without, accepted with.
	h.setOwnVersionFirst(t, true)
	if code, out := h.postTurn(t, p, sessionID, map[string]any{"message": "q3"}); code != http.StatusBadRequest || out["code"] != "own_version_required" {
		t.Fatalf("on, without: %d %v", code, out)
	}
	partial := map[string]any{"understanding": "only this", "uncertain": " ", "proof": ""}
	if code, out := h.postTurn(t, p, sessionID, map[string]any{"message": "q3", "own_version": partial}); code != http.StatusBadRequest || out["code"] != "own_version_invalid" {
		t.Fatalf("on, partial: %d %v", code, out)
	}
	long := map[string]any{"understanding": strings.Repeat("x", ownversion.MaxLine+1), "uncertain": "u", "proof": "p"}
	if code, out := h.postTurn(t, p, sessionID, map[string]any{"message": "q3", "own_version": long}); code != http.StatusBadRequest {
		t.Fatalf("on, too long: %d %v", code, out)
	}
	if code, out := h.postTurn(t, p, sessionID, map[string]any{"message": "q3", "own_version": threeLines}); code != http.StatusAccepted {
		t.Fatalf("on, with: %d %v", code, out)
	}
	p.await(t)

	// A refused turn stored nothing: the transcript has three questions.
	history, err := p.chat.History(context.Background(), h.userID, uuid.MustParse(sessionID), 50)
	if err != nil {
		t.Fatal(err)
	}
	questions := 0
	for _, m := range history {
		if m.Role == runtime.RoleUser {
			questions++
		}
	}
	if questions != 3 {
		t.Fatalf("stored %d questions, want 3", questions)
	}
}

func TestOwnVersionReachesTheModelOnThisTurnAndLaterOnes(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answers(2))
	h.setOwnVersionFirst(t, true)
	sessionID := h.createSession(t, p)

	if code, out := h.postTurn(t, p, sessionID, map[string]any{"message": "FIRST-QUESTION", "own_version": threeLines}); code != http.StatusAccepted {
		t.Fatalf("turn 1: %d %v", code, out)
	}
	p.await(t)
	second := map[string]any{"understanding": "U2", "uncertain": "N2", "proof": "P2"}
	if code, out := h.postTurn(t, p, sessionID, map[string]any{"message": "SECOND-QUESTION", "own_version": second}); code != http.StatusAccepted {
		t.Fatalf("turn 2: %d %v", code, out)
	}
	p.await(t)

	reqs := p.provider.sentRequests()
	if len(reqs) != 2 {
		t.Fatalf("%d model requests, want 2", len(reqs))
	}

	// Turn 1: the learner's message carries the lines under the heading.
	last := reqs[0].Messages[len(reqs[0].Messages)-1]
	assertLinesUnderHeading(t, "turn 1 input", last, "FIRST-QUESTION", "UNDERSTAND-MARK", "UNSURE-MARK", "PROOF-MARK")

	// Turn 2: the rebuilt history still shows turn 1's lines, and the new
	// input carries its own.
	var firstInHistory *runtime.Message
	for i, m := range reqs[1].Messages {
		if m.Role == runtime.RoleUser && strings.Contains(m.Content, "FIRST-QUESTION") {
			firstInHistory = &reqs[1].Messages[i]
		}
	}
	if firstInHistory == nil {
		t.Fatal("turn 2's request lost the first question")
	}
	assertLinesUnderHeading(t, "turn 2 history", *firstInHistory, "FIRST-QUESTION", "UNDERSTAND-MARK", "UNSURE-MARK", "PROOF-MARK")
	last = reqs[1].Messages[len(reqs[1].Messages)-1]
	assertLinesUnderHeading(t, "turn 2 input", last, "SECOND-QUESTION", "U2", "N2", "P2")

	// The system prompt tells the model what to do with them.
	if !strings.Contains(reqs[0].Messages[0].Content, ownversion.Heading) {
		t.Error("the system prompt does not mention the learner's own attempt")
	}
}

func assertLinesUnderHeading(t *testing.T, label string, m runtime.Message, question string, lines ...string) {
	t.Helper()
	if m.Role != runtime.RoleUser {
		t.Fatalf("%s: role %q", label, m.Role)
	}
	q := strings.Index(m.Content, question)
	head := strings.Index(m.Content, ownversion.Heading)
	if q < 0 || head < q {
		t.Fatalf("%s: no heading after the question: %q", label, m.Content)
	}
	for _, l := range lines {
		if i := strings.Index(m.Content, l); i < head {
			t.Errorf("%s: %q is not under the heading: %q", label, l, m.Content)
		}
	}
}

func TestRetell(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, answers(2))
	sessionID := h.createSession(t, p)
	ctx := context.Background()

	if code, out := h.postTurn(t, p, sessionID, map[string]any{"message": "with lines", "own_version": threeLines}); code != http.StatusAccepted {
		t.Fatalf("turn 1: %d %v", code, out)
	}
	p.await(t)
	if code, out := h.postTurn(t, p, sessionID, map[string]any{"message": "without lines"}); code != http.StatusAccepted {
		t.Fatalf("turn 2: %d %v", code, out)
	}
	p.await(t)

	history, err := p.chat.History(ctx, h.userID, uuid.MustParse(sessionID), 50)
	if err != nil || len(history) != 4 {
		t.Fatalf("history: %d %v", len(history), err)
	}
	question, answer, plainAnswer := history[0], history[1], history[3]
	if answer.Role != runtime.RoleAssistant || plainAnswer.Role != runtime.RoleAssistant {
		t.Fatalf("unexpected transcript order: %+v", history)
	}

	post := func(id uuid.UUID, text string) (int, map[string]any) {
		res := h.do(t, p, http.MethodPost, "/v1/chat/messages/"+id.String()+"/retell", map[string]any{"text": text})
		defer res.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}

	if code, out := post(answer.ID, "my first retell"); code != http.StatusOK {
		t.Fatalf("retell: %d %v", code, out)
	}
	if code, out := post(answer.ID, "my second retell"); code != http.StatusOK {
		t.Fatalf("retell again: %d %v", code, out)
	}
	stored, err := p.chat.GetMessage(ctx, h.userID, answer.ID)
	if err != nil {
		t.Fatal(err)
	}
	var att struct {
		Retell ownversion.Retell `json:"retell"`
	}
	if err := json.Unmarshal(stored.Attachments, &att); err != nil || att.Retell.Text != "my second retell" {
		t.Fatalf("saving twice did not replace: %s", stored.Attachments)
	}

	// The reloaded session shows the lines and the retell.
	res := h.do(t, p, http.MethodGet, "/v1/chat/sessions/"+sessionID+"/messages", nil)
	listing := decode[struct {
		Messages []struct {
			ID          string          `json:"id"`
			Attachments json.RawMessage `json:"attachments"`
		} `json:"messages"`
	}](t, res, http.StatusOK)
	var sawLines, sawRetell bool
	for _, m := range listing.Messages {
		if m.ID == question.ID.String() && ownversion.FromAttachments(m.Attachments) != nil {
			sawLines = true
		}
		if m.ID == answer.ID.String() && strings.Contains(string(m.Attachments), "my second retell") {
			sawRetell = true
		}
	}
	if !sawLines || !sawRetell {
		t.Fatalf("history listing: lines %v retell %v", sawLines, sawRetell)
	}

	cases := []struct {
		name string
		id   uuid.UUID
		text string
		code int
	}{
		{"an answer without lines", plainAnswer.ID, "x", http.StatusBadRequest},
		{"a user message", question.ID, "x", http.StatusBadRequest},
		{"a nonexistent message", uuid.New(), "x", http.StatusNotFound},
		{"an empty retell", answer.ID, "  ", http.StatusBadRequest},
		{"an over-long retell", answer.ID, strings.Repeat("x", ownversion.MaxRetell+1), http.StatusBadRequest},
	}
	for _, c := range cases {
		if code, out := post(c.id, c.text); code != c.code {
			t.Errorf("%s: %d %v, want %d", c.name, code, out, c.code)
		}
	}

	// Another learner's answer, whose question did carry the lines, answers
	// exactly like a nonexistent one.
	var other uuid.UUID
	if err := h.pool.QueryRow(ctx, `INSERT INTO users (email, display_name, email_verified_at)
		VALUES ($1, 'Other', now()) RETURNING id`, "other-"+uuid.NewString()+"@example.test").Scan(&other); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = h.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, other) })
	sess, err := p.chat.CreateSession(ctx, runtime.Session{UserID: other, Title: "theirs", KBIDs: []uuid.UUID{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.chat.AppendMessage(ctx, runtime.ChatMessage{UserID: other, SessionID: sess.ID, Role: runtime.RoleUser,
		Content: "q", Capability: "chat", Attachments: ownversion.Attachments(ownversion.Lines{Understanding: "a", Uncertain: "b", Proof: "c"})}); err != nil {
		t.Fatal(err)
	}
	theirs, err := p.chat.AppendMessage(ctx, runtime.ChatMessage{UserID: other, SessionID: sess.ID, Role: runtime.RoleAssistant, Content: "a", Capability: "chat"})
	if err != nil {
		t.Fatal(err)
	}
	if code, out := post(theirs.ID, "x"); code != http.StatusNotFound {
		t.Fatalf("another learner's answer: %d %v", code, out)
	}
}
