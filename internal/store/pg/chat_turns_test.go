package pg

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/testutil"
)

// These tests run against a real Postgres because the guards they check live in
// SQL. The in-memory twin in internal/runtime/fakes_test.go enforces the same
// rules; if the two ever disagree, this file is the one that is right.

func chatFixture(t *testing.T) (*pgxpool.Pool, *ChatStore, *TurnStore, uuid.UUID, runtime.Session) {
	t.Helper()
	pool := testutil.TestDB(t)
	chat := NewChatStore(pool)
	turns := NewTurnStore(pool)

	userID := seedUser(t, pool)
	sess, err := chat.CreateSession(context.Background(), runtime.Session{
		UserID: userID, Title: "Test session", KBIDs: []uuid.UUID{uuid.New()},
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	t.Cleanup(func() {
		_ = chat.DeleteSession(context.Background(), userID, sess.ID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
	})
	return pool, chat, turns, userID, *sess
}

func seedUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, display_name, email_verified_at)
		 VALUES ($1, 'Chat Test', now()) RETURNING id`,
		"chat-"+uuid.NewString()+"@example.test").Scan(&id)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return id
}

func newTurn(t *testing.T, turns *TurnStore, userID, sessionID uuid.UUID) runtime.Turn {
	t.Helper()
	turn, err := turns.CreateTurn(context.Background(), runtime.Turn{
		UserID: userID, SessionID: sessionID, Capability: "chat",
	})
	if err != nil {
		t.Fatalf("CreateTurn: %v", err)
	}
	return *turn
}

// The full lifecycle, including waiting_user, against the real constraint.
func TestTurnLifecycleThroughWaitingUser(t *testing.T) {
	_, _, turns, userID, sess := chatFixture(t)
	ctx := context.Background()

	turn := newTurn(t, turns, userID, sess.ID)
	if turn.Status != runtime.StatusQueued || turn.Attempt != 0 {
		t.Fatalf("fresh turn = %+v", turn)
	}

	claimed, err := turns.ClaimTurn(ctx, turn.ID, time.Minute)
	if err != nil {
		t.Fatalf("ClaimTurn: %v", err)
	}
	if claimed.Status != runtime.StatusRunning || claimed.Attempt != 1 || claimed.LeaseExpires == nil {
		t.Fatalf("claimed = %+v", claimed)
	}

	// A second claim must lose: two workers on one turn interleave two answers
	// into one stream.
	if _, err := turns.ClaimTurn(ctx, turn.ID, time.Minute); !errors.Is(err, runtime.ErrTurnNotFound) {
		t.Fatalf("second claim = %v, want ErrTurnNotFound", err)
	}

	parked, err := turns.SetStatus(ctx, turn.ID,
		[]string{runtime.StatusRunning}, runtime.StatusWaitingUser, runtime.TurnUpdate{})
	if err != nil || parked == nil {
		t.Fatalf("park on waiting_user: %v / %+v", err, parked)
	}
	if parked.LeaseExpires == nil {
		t.Fatal("parking cleared the lease; a parked turn with no lease is invisible to the sweeper")
	}

	// The heartbeat must keep working while parked: a person may take minutes.
	if err := turns.Heartbeat(ctx, turn.ID, time.Minute); err != nil {
		t.Fatalf("heartbeat while waiting_user: %v", err)
	}

	resumed, err := turns.SetStatus(ctx, turn.ID,
		[]string{runtime.StatusWaitingUser}, runtime.StatusRunning, runtime.TurnUpdate{})
	if err != nil || resumed == nil {
		t.Fatalf("resume: %v / %+v", err, resumed)
	}

	done, err := turns.SetStatus(ctx, turn.ID,
		[]string{runtime.StatusRunning}, runtime.StatusDone, runtime.TurnUpdate{
			Provider: "gemini", Model: "gemini-3.1-flash",
			Usage:      &runtime.Usage{PromptTokens: 1200, CompletionTokens: 300},
			ClearLease: true, Finished: true,
		})
	if err != nil || done == nil {
		t.Fatalf("finish: %v / %+v", err, done)
	}
	if done.Provider != "gemini" || done.Usage.PromptTokens != 1200 {
		t.Fatalf("finished turn lost provider/usage: %+v", done)
	}
	if done.LeaseExpires != nil || done.FinishedAt == nil {
		t.Fatalf("finished turn = %+v", done)
	}

	// Nothing leaves a terminal status, and a heartbeat cannot resurrect one.
	lost, err := turns.SetStatus(ctx, turn.ID,
		[]string{runtime.StatusRunning}, runtime.StatusCancelled, runtime.TurnUpdate{})
	if err != nil {
		t.Fatalf("a losing guarded update should be a no-op, not an error: %v", err)
	}
	if lost != nil {
		t.Fatalf("a done turn was cancelled: %+v", lost)
	}
	if err := turns.Heartbeat(ctx, turn.ID, time.Minute); !errors.Is(err, runtime.ErrTurnNotFound) {
		t.Fatalf("heartbeat on a finished turn = %v, want ErrTurnNotFound", err)
	}
}

// An illegal transition is a programming error and is refused before it reaches
// the database.
func TestSetStatusRefusesIllegalTransitions(t *testing.T) {
	_, _, turns, userID, sess := chatFixture(t)
	turn := newTurn(t, turns, userID, sess.ID)

	_, err := turns.SetStatus(context.Background(), turn.ID,
		[]string{runtime.StatusDone}, runtime.StatusRunning, runtime.TurnUpdate{})
	if !errors.Is(err, runtime.ErrInvalidTransition) {
		t.Fatalf("done -> running = %v, want ErrInvalidTransition", err)
	}
}

// THE recovery criterion, against the real query: an expired lease is found and
// the turn ends as failed(WORKER_LOST) with a terminal event appended.
func TestExpiredLeaseIsSweptToWorkerLost(t *testing.T) {
	pool, _, turns, userID, sess := chatFixture(t)
	ctx := context.Background()

	turn := newTurn(t, turns, userID, sess.ID)
	if _, err := turns.ClaimTurn(ctx, turn.ID, time.Minute); err != nil {
		t.Fatalf("ClaimTurn: %v", err)
	}
	// Some progress before the process "died".
	if err := turns.AppendEvents(ctx, turn.ID, userID, []runtime.Event{
		{Type: runtime.EvSession, Seq: 1},
		{Type: runtime.EvContent, Seq: 2, Content: "partial answ"},
	}); err != nil {
		t.Fatalf("AppendEvents: %v", err)
	}
	// Kill it: the lease stops being refreshed.
	if _, err := pool.Exec(ctx,
		`UPDATE turns SET lease_expires_at = now() - interval '1 minute' WHERE id = $1`, turn.ID); err != nil {
		t.Fatalf("expire lease: %v", err)
	}

	expired, err := turns.ExpiredTurns(ctx, 100)
	if err != nil {
		t.Fatalf("ExpiredTurns: %v", err)
	}
	if !containsTurn(expired, turn.ID) {
		t.Fatal("the expired turn was not found by the sweeper's query")
	}

	recovery := runtime.NewRecovery(turns, turns, runtime.NewBusRegistry())
	if _, err := recovery.Sweep(ctx); err != nil {
		t.Fatalf("Sweep: %v", err)
	}

	final, err := turns.GetTurn(ctx, userID, turn.ID)
	if err != nil {
		t.Fatalf("GetTurn: %v", err)
	}
	if final.Status != runtime.StatusFailed || final.FailureCode != runtime.FailureWorkerLost || !final.Retryable {
		t.Fatalf("recovered turn = %+v", final)
	}

	events, err := turns.EventsAfter(ctx, userID, turn.ID, 0, 100)
	if err != nil {
		t.Fatalf("EventsAfter: %v", err)
	}
	last := events[len(events)-1]
	if last.Type != runtime.EvError || last.Seq != 3 {
		t.Fatalf("terminal event = %+v, want an error at seq 3", last)
	}
	if last.Metadata["failure_code"] != runtime.FailureWorkerLost {
		t.Fatalf("terminal event metadata = %+v", last.Metadata)
	}
}

// Replaying a batch must be harmless: a flush whose write timed out is retried,
// and a duplicate-key abort there would lose every event after the collision.
func TestAppendEventsIsIdempotent(t *testing.T) {
	_, _, turns, userID, sess := chatFixture(t)
	ctx := context.Background()
	turn := newTurn(t, turns, userID, sess.ID)

	batch := []runtime.Event{
		{Type: runtime.EvContent, Seq: 1, Content: "a"},
		{Type: runtime.EvContent, Seq: 2, Content: "b"},
	}
	if err := turns.AppendEvents(ctx, turn.ID, userID, batch); err != nil {
		t.Fatalf("first append: %v", err)
	}
	if err := turns.AppendEvents(ctx, turn.ID, userID, batch); err != nil {
		t.Fatalf("replayed append: %v", err)
	}

	events, _ := turns.EventsAfter(ctx, userID, turn.ID, 0, 100)
	if len(events) != 2 {
		t.Fatalf("got %d rows after a replayed batch, want 2", len(events))
	}
}

func TestEventsAfterHonoursTheCursorAndTheOwner(t *testing.T) {
	pool, _, turns, userID, sess := chatFixture(t)
	ctx := context.Background()
	turn := newTurn(t, turns, userID, sess.ID)

	var batch []runtime.Event
	for i := 1; i <= 10; i++ {
		batch = append(batch, runtime.Event{Type: runtime.EvContent, Seq: int64(i)})
	}
	if err := turns.AppendEvents(ctx, turn.ID, userID, batch); err != nil {
		t.Fatalf("AppendEvents: %v", err)
	}

	after, err := turns.EventsAfter(ctx, userID, turn.ID, 6, 100)
	if err != nil {
		t.Fatalf("EventsAfter: %v", err)
	}
	if len(after) != 4 || after[0].Seq != 7 {
		t.Fatalf("cursor 6 returned %d events starting at %d, want 4 starting at 7", len(after), after[0].Seq)
	}

	// Another user reading the same turn id gets nothing — the query filters on
	// user_id, not only turn_id.
	stranger := seedUser(t, pool)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, stranger) })

	foreign, err := turns.EventsAfter(ctx, stranger, turn.ID, 0, 100)
	if err != nil {
		t.Fatalf("EventsAfter as a stranger: %v", err)
	}
	if len(foreign) != 0 {
		t.Fatalf("a stranger read %d events of someone else's turn", len(foreign))
	}
	if _, err := turns.GetTurn(ctx, stranger, turn.ID); !errors.Is(err, runtime.ErrTurnNotFound) {
		t.Fatalf("a stranger read the turn row: %v", err)
	}
}

func TestMaxSeqIsZeroForAnEmptyLog(t *testing.T) {
	_, _, turns, userID, sess := chatFixture(t)
	turn := newTurn(t, turns, userID, sess.ID)

	seq, err := turns.MaxSeq(context.Background(), turn.ID)
	if err != nil {
		t.Fatalf("MaxSeq: %v", err)
	}
	if seq != 0 {
		t.Fatalf("MaxSeq on an empty log = %d, want 0", seq)
	}
}

// Sessions and messages: history is oldest-first and capped from the NEWEST
// end, so a long conversation drops its oldest turns rather than the question
// currently being answered.
func TestHistoryKeepsTheMostRecentMessagesInOrder(t *testing.T) {
	_, chat, _, userID, sess := chatFixture(t)
	ctx := context.Background()

	for i := 0; i < 6; i++ {
		if _, err := chat.AppendMessage(ctx, runtime.ChatMessage{
			UserID: userID, SessionID: sess.ID, Role: runtime.RoleUser,
			Content: string(rune('a' + i)), Capability: "chat",
		}); err != nil {
			t.Fatalf("AppendMessage: %v", err)
		}
	}

	all, err := chat.History(ctx, userID, sess.ID, 100)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(all) != 6 || all[0].Content != "a" || all[5].Content != "f" {
		t.Fatalf("history = %v", contents(all))
	}

	capped, err := chat.History(ctx, userID, sess.ID, 3)
	if err != nil {
		t.Fatalf("History capped: %v", err)
	}
	if len(capped) != 3 || capped[0].Content != "d" || capped[2].Content != "f" {
		t.Fatalf("capped history = %v, want the last three in order", contents(capped))
	}
}

func TestSessionsAreScopedToTheirOwner(t *testing.T) {
	pool, chat, _, userID, sess := chatFixture(t)
	ctx := context.Background()

	stranger := seedUser(t, pool)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, stranger) })

	if _, err := chat.GetSession(ctx, stranger, sess.ID); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("a stranger read the session: %v", err)
	}
	if _, err := chat.UpdateSession(ctx, stranger, sess.ID,
		SessionPatch{Title: ptrTo("stolen")}); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("a stranger renamed the session: %v", err)
	}
	if err := chat.DeleteSession(ctx, stranger, sess.ID); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("a stranger deleted the session: %v", err)
	}

	sessions, err := chat.ListSessions(ctx, stranger, 50, "")
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	for _, s := range sessions {
		if s.ID == sess.ID {
			t.Fatal("a stranger's list contained someone else's session")
		}
	}
	// The owner still sees it, so the test above is not passing by accident.
	if _, err := chat.GetSession(ctx, userID, sess.ID); err != nil {
		t.Fatalf("the owner lost access: %v", err)
	}
}

// A patch leaves unset fields alone; that is what lets one PATCH serve rename,
// retarget and the allow-web toggle.
func TestSessionPatchOnlyTouchesWhatItNames(t *testing.T) {
	_, chat, _, userID, sess := chatFixture(t)
	ctx := context.Background()

	renamed, err := chat.UpdateSession(ctx, userID, sess.ID, SessionPatch{Title: ptrTo("New title")})
	if err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}
	if renamed.Title != "New title" {
		t.Fatalf("title = %q", renamed.Title)
	}
	if len(renamed.KBIDs) != len(sess.KBIDs) {
		t.Fatalf("a rename changed kb_ids: %v -> %v", sess.KBIDs, renamed.KBIDs)
	}
	if renamed.AllowWeb {
		t.Fatal("a rename turned on allow_web")
	}

	web := true
	toggled, err := chat.UpdateSession(ctx, userID, sess.ID, SessionPatch{AllowWeb: &web})
	if err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}
	if !toggled.AllowWeb || toggled.Title != "New title" {
		t.Fatalf("toggle lost the title or the flag: %+v", toggled)
	}
}

// Deleting a session takes its transcript, turns and events with it. A chat the
// user deleted must not leave its content in turn_events.
func TestDeletingASessionCascades(t *testing.T) {
	pool, chat, turns, userID, sess := chatFixture(t)
	ctx := context.Background()

	turn := newTurn(t, turns, userID, sess.ID)
	if err := turns.AppendEvents(ctx, turn.ID, userID,
		[]runtime.Event{{Type: runtime.EvContent, Seq: 1, Content: "secret"}}); err != nil {
		t.Fatalf("AppendEvents: %v", err)
	}
	if _, err := chat.AppendMessage(ctx, runtime.ChatMessage{
		UserID: userID, SessionID: sess.ID, Role: runtime.RoleUser, Content: "secret",
	}); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}

	if err := chat.DeleteSession(ctx, userID, sess.ID); err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}

	for _, table := range []string{"chat_messages", "turns", "turn_events"} {
		var n int
		q := `SELECT count(*) FROM ` + table + ` WHERE session_id = $1`
		if table == "turn_events" {
			q = `SELECT count(*) FROM turn_events WHERE turn_id = $1`
		}
		arg := any(sess.ID)
		if table == "turn_events" {
			arg = turn.ID
		}
		if err := pool.QueryRow(ctx, q, arg).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if n != 0 {
			t.Errorf("%s still holds %d rows after the session was deleted", table, n)
		}
	}
}

func containsTurn(turns []runtime.Turn, id uuid.UUID) bool {
	for _, t := range turns {
		if t.ID == id {
			return true
		}
	}
	return false
}

func contents(msgs []runtime.ChatMessage) []string {
	out := make([]string, len(msgs))
	for i, m := range msgs {
		out[i] = m.Content
	}
	return out
}

func ptrTo[T any](v T) *T { return &v }
