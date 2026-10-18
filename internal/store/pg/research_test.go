package pg

import (
	"context"
	"errors"
	"testing"

	"github.com/D0bby999/anytools/internal/capabilities/research"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/runtime"
)

func TestResearchReportsAreScopedToTheirOwner(t *testing.T) {
	pool, chat, turns, userID, sess := chatFixture(t)
	store := NewResearchStore(pool)
	ctx := context.Background()

	turn, err := turns.CreateTurn(ctx, runtime.Turn{UserID: userID, SessionID: sess.ID, Capability: "research", Status: runtime.StatusQueued})
	if err != nil {
		t.Fatal(err)
	}
	sessionID, turnID := sess.ID, turn.ID
	r, err := store.InsertReport(ctx, research.Report{
		UserID: userID, SessionID: &sessionID, TurnID: &turnID, Query: "q", Mode: research.ModeQuick,
		ReportMD: "# R [[cite:url:1]]",
		Sources:  []citations.Source{{Kind: citations.KindURL, ID: "1", Title: "A", URL: "https://a.test/"}},
		KBOnly:   false,
	})
	if err != nil {
		t.Fatalf("InsertReport: %v", err)
	}
	got, err := store.GetReport(ctx, userID, r.ID)
	if err != nil || len(got.Sources) != 1 || got.Sources[0].URL != "https://a.test/" {
		t.Fatalf("GetReport = %+v, %v", got, err)
	}

	stranger := seedUser(t, pool)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, stranger) })
	if _, err := store.GetReport(ctx, stranger, r.ID); !errors.Is(err, research.ErrNotFound) {
		t.Fatalf("a stranger read the report: %v", err)
	}
	if list, _ := store.ListReports(ctx, stranger, 10); len(list) != 0 {
		t.Fatalf("a stranger lists %d reports", len(list))
	}
	if err := store.SetReportNote(ctx, stranger, r.ID, "n"); !errors.Is(err, research.ErrNotFound) {
		t.Fatalf("a stranger set the note: %v", err)
	}
	// A stranger cannot attach a report to someone else's session either: the
	// composite foreign key makes that row unrepresentable.
	if _, err := store.InsertReport(ctx, research.Report{
		UserID: stranger, SessionID: &sessionID, Query: "q", Mode: research.ModeQuick,
	}); err == nil {
		t.Fatal("a report was attached to another user's session")
	}

	// Deleting the conversation keeps the report, detached.
	if err := chat.DeleteSession(ctx, userID, sess.ID); err != nil {
		t.Fatal(err)
	}
	got, err = store.GetReport(ctx, userID, r.ID)
	if err != nil || got.SessionID != nil || got.TurnID != nil {
		t.Fatalf("after deleting the session: %+v, %v", got, err)
	}
}

func TestAKBOnlyReportMustSayWhy(t *testing.T) {
	pool, _, _, userID, _ := chatFixture(t)
	store := NewResearchStore(pool)
	ctx := context.Background()
	if _, err := store.InsertReport(ctx, research.Report{UserID: userID, Query: "q", Mode: "quick", KBOnly: true}); err == nil {
		t.Fatal("a KB-only report with no reason was stored")
	}
	if _, err := store.InsertReport(ctx, research.Report{UserID: userID, Query: "q", Mode: "quick",
		KBOnly: true, KBOnlyReason: research.ReasonNoSearchKey}); err != nil {
		t.Fatalf("valid KB-only report: %v", err)
	}
	if _, err := store.InsertReport(ctx, research.Report{UserID: userID, Query: "q", Mode: "slow"}); err == nil {
		t.Fatal("an unknown mode was stored")
	}
}
