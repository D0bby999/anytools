package pg

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/learning/ownversion"
	"github.com/D0bby999/anytools/internal/runtime"
)

// ownLines is a complete set of the three lines.
var ownLines = ownversion.Lines{Understanding: "U", Uncertain: "N", Proof: "P"}

// appendAt writes a message and pins its created_at, so the exchange order
// SetRetell reads does not depend on two inserts landing in distinct
// microseconds.
func appendAt(t *testing.T, pool *pgxpool.Pool, chat *ChatStore, m runtime.ChatMessage, at time.Time) *runtime.ChatMessage {
	t.Helper()
	stored, err := chat.AppendMessage(context.Background(), m)
	if err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}
	if _, err := pool.Exec(context.Background(),
		`UPDATE chat_messages SET created_at = $2 WHERE id = $1`, stored.ID, at); err != nil {
		t.Fatalf("pin created_at: %v", err)
	}
	return stored
}

func retellBody(text string) []byte {
	raw, _ := json.Marshal(ownversion.Retell{Text: text, WrittenAt: "2026-10-16T00:00:00Z"})
	return raw
}

func readRetell(t *testing.T, chat *ChatStore, userID, id uuid.UUID) (string, map[string]json.RawMessage) {
	t.Helper()
	msg, err := chat.GetMessage(context.Background(), userID, id)
	if err != nil {
		t.Fatalf("GetMessage: %v", err)
	}
	var att map[string]json.RawMessage
	if err := json.Unmarshal(msg.Attachments, &att); err != nil {
		t.Fatalf("attachments are not an object: %s", msg.Attachments)
	}
	var r ownversion.Retell
	_ = json.Unmarshal(att["retell"], &r)
	return r.Text, att
}

func TestUserMessagesReadBackInBothShapes(t *testing.T) {
	pool, chat, _, userID, sess := chatFixture(t)
	t0 := time.Now().Add(-time.Hour)

	plain := appendAt(t, pool, chat, runtime.ChatMessage{UserID: userID, SessionID: sess.ID,
		Role: runtime.RoleUser, Content: "q1", Capability: "chat"}, t0)
	withLines := appendAt(t, pool, chat, runtime.ChatMessage{UserID: userID, SessionID: sess.ID,
		Role: runtime.RoleUser, Content: "q2", Capability: "chat", Attachments: ownversion.Attachments(ownLines)}, t0.Add(time.Second))

	history, err := chat.History(context.Background(), userID, sess.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 2 || history[0].ID != plain.ID || history[1].ID != withLines.ID {
		t.Fatalf("history: %+v", history)
	}
	if string(history[0].Attachments) != "[]" || ownversion.FromAttachments(history[0].Attachments) != nil {
		t.Errorf("default message: %s", history[0].Attachments)
	}
	if got := ownversion.FromAttachments(history[1].Attachments); got == nil || *got != ownLines {
		t.Errorf("own-version message: %s", history[1].Attachments)
	}
}

func TestSetRetell(t *testing.T) {
	pool, chat, _, userID, sess := chatFixture(t)
	ctx := context.Background()
	t0 := time.Now().Add(-time.Hour)
	at := func(i int) time.Time { return t0.Add(time.Duration(i) * time.Second) }
	msg := func(role, content string, att []byte, i int) *runtime.ChatMessage {
		return appendAt(t, pool, chat, runtime.ChatMessage{UserID: userID, SessionID: sess.ID,
			Role: role, Content: content, Capability: "chat", Attachments: att}, at(i))
	}

	// Exchange 1: a question with the lines, an ask_user reply, then the
	// answer — stored with the default array.
	question := msg(runtime.RoleUser, "q", ownversion.Attachments(ownLines), 0)
	msg(runtime.RoleUser, "the reply to ask_user", nil, 1)
	answer := msg(runtime.RoleAssistant, "a", nil, 2)
	// Exchange 2: a question without the lines.
	msg(runtime.RoleUser, "q2", nil, 3)
	answer2 := msg(runtime.RoleAssistant, "a2", nil, 4)

	t.Run("an array-shaped answer gets the retell as an object", func(t *testing.T) {
		if err := chat.SetRetell(ctx, userID, answer.ID, retellBody("first")); err != nil {
			t.Fatalf("SetRetell: %v", err)
		}
		if text, _ := readRetell(t, chat, userID, answer.ID); text != "first" {
			t.Fatalf("retell = %q", text)
		}
	})

	t.Run("saving again replaces", func(t *testing.T) {
		if err := chat.SetRetell(ctx, userID, answer.ID, retellBody("second")); err != nil {
			t.Fatal(err)
		}
		if text, _ := readRetell(t, chat, userID, answer.ID); text != "second" {
			t.Fatalf("retell = %q", text)
		}
	})

	t.Run("only under an answer whose question carried the lines", func(t *testing.T) {
		if err := chat.SetRetell(ctx, userID, answer2.ID, retellBody("x")); !errors.Is(err, ErrNoOwnVersion) {
			t.Fatalf("answer without lines: %v", err)
		}
		if err := chat.SetRetell(ctx, userID, question.ID, retellBody("x")); !errors.Is(err, ErrNoOwnVersion) {
			t.Fatalf("a user message: %v", err)
		}
	})

	t.Run("another user cannot write it", func(t *testing.T) {
		other := seedUser(t, pool)
		t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, other) })
		if err := chat.SetRetell(ctx, other, answer.ID, retellBody("theirs")); !errors.Is(err, ErrNoOwnVersion) {
			t.Fatalf("foreign write: %v", err)
		}
		if text, _ := readRetell(t, chat, userID, answer.ID); text != "second" {
			t.Fatalf("retell changed to %q", text)
		}
	})
}

func TestDiagramRepairKeepsTheRetell(t *testing.T) {
	pool, chat, _, userID, sess := chatFixture(t)
	ctx := context.Background()
	t0 := time.Now().Add(-time.Hour)

	appendAt(t, pool, chat, runtime.ChatMessage{UserID: userID, SessionID: sess.ID,
		Role: runtime.RoleUser, Content: "draw it", Capability: "chat", Attachments: ownversion.Attachments(ownLines)}, t0)
	diagram := appendAt(t, pool, chat, runtime.ChatMessage{UserID: userID, SessionID: sess.ID,
		Role: runtime.RoleAssistant, Content: "before", Capability: "visualize",
		Attachments: []byte(`{"sources":[],"diagram":{"kind":"mermaid","function":"chat","repaired":false}}`)}, t0.Add(time.Second))

	if err := chat.SetRetell(ctx, userID, diagram.ID, retellBody("mine")); err != nil {
		t.Fatal(err)
	}
	ok, err := chat.ReplaceDiagram(ctx, userID, diagram.ID, "after",
		[]byte(`{"sources":[],"diagram":{"kind":"mermaid","function":"chat","repaired":true}}`))
	if err != nil || !ok {
		t.Fatalf("ReplaceDiagram: %v %v", ok, err)
	}
	text, att := readRetell(t, chat, userID, diagram.ID)
	if text != "mine" {
		t.Errorf("the repair wiped the retell: %v", att)
	}
	if string(att["diagram"]) == "" || !json.Valid(att["diagram"]) {
		t.Fatalf("diagram: %s", att["diagram"])
	}
	var d struct{ Repaired bool }
	_ = json.Unmarshal(att["diagram"], &d)
	if !d.Repaired {
		t.Errorf("diagram not marked repaired: %s", att["diagram"])
	}
}

func TestOwnVersionFirstSetting(t *testing.T) {
	pool, _, _, userID, _ := chatFixture(t)
	ctx := context.Background()
	users := NewUserStore(pool)

	if on, err := users.OwnVersionFirst(ctx, userID); err != nil || on {
		t.Fatalf("default: %v %v", on, err)
	}
	if err := users.SetOwnVersionFirst(ctx, userID, true); err != nil {
		t.Fatal(err)
	}
	u, err := users.GetUser(ctx, userID)
	if err != nil || !u.OwnVersionFirst {
		t.Fatalf("GetUser: %+v %v", u, err)
	}
	if err := users.SetOwnVersionFirst(ctx, userID, false); err != nil {
		t.Fatal(err)
	}
	if on, _ := users.OwnVersionFirst(ctx, userID); on {
		t.Fatal("still on")
	}
}
