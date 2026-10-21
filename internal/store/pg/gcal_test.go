package pg_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/connectors/gcal"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// A link keeps its event ids; only learners whose Google grant still works
// are listed for the hourly sync.
func TestGCalStore(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	store := pg.NewGCalStore(pool)
	user := testutil.NewUser(t, pool)

	if _, err := store.GetLink(ctx, user); !errors.Is(err, gcal.ErrNotEnabled) {
		t.Fatalf("none yet: %v", err)
	}
	now := time.Now()
	if err := store.SaveLink(ctx, gcal.Link{UserID: user, CalendarID: "cal-1", EventIDs: []string{"a1", "b2"}, SyncedAt: &now, CreatedAt: now}); err != nil {
		t.Fatal(err)
	}
	got, err := store.GetLink(ctx, user)
	if err != nil || got.CalendarID != "cal-1" || !slices.Equal(got.EventIDs, []string{"a1", "b2"}) || got.SyncedAt == nil {
		t.Fatalf("%+v %v", got, err)
	}

	listed, _ := store.ListLinkedUsers(ctx)
	if slices.Contains(listed, user) {
		t.Fatal("no Google grant: not listed")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO drive_connections (user_id, refresh_enc) VALUES ($1, 'x')`, user); err != nil {
		t.Fatal(err)
	}
	if listed, _ = store.ListLinkedUsers(ctx); !slices.Contains(listed, user) {
		t.Fatal("a working grant: listed")
	}
	if _, err := pool.Exec(ctx, `UPDATE drive_connections SET needs_reconnect = true WHERE user_id = $1`, user); err != nil {
		t.Fatal(err)
	}
	if listed, _ = store.ListLinkedUsers(ctx); slices.Contains(listed, user) {
		t.Fatal("a grant needing reconnect: not listed")
	}

	if err := store.DeleteLink(ctx, user); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetLink(ctx, user); !errors.Is(err, gcal.ErrNotEnabled) {
		t.Fatal("deleted")
	}
}
