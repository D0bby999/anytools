package pg_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/calendar"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// The feed's token is found by its hash and shown again decrypted; the
// source reads the learner's zone, the newest cycle of each state (not an
// old one) and the training week, and nothing of another learner.
func TestCalendarStore(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	store := pg.NewCalendarStore(pool, testutil.TestEncryptionKey)
	user := testutil.NewUser(t, pool)
	other := testutil.NewUser(t, pool)

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`UPDATE users SET timezone = 'Asia/Ho_Chi_Minh', language = 'vi', reminder_hour = 21 WHERE id = $1`, user)

	var state uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO learning_states (user_id, goal) VALUES ($1, 'IELTS 7') RETURNING id`, user).Scan(&state); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO cycles (user_id, state_id, started_at) VALUES ($1, $2, now() - interval '200 days')`, user, state)
	var current uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO cycles (user_id, state_id, started_at) VALUES ($1, $2, now() - interval '3 days') RETURNING id`,
		user, state).Scan(&current); err != nil {
		t.Fatal(err)
	}
	var routine uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO body_routines (user_id, name) VALUES ($1, 'Push') RETURNING id`, user).Scan(&routine); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO body_week (user_id, weekday, routine_id) VALUES ($1, 1, $2), ($1, 4, $2)`, user, routine)

	if _, err := store.GetFeed(ctx, user); !errors.Is(err, calendar.ErrNoFeed) {
		t.Fatalf("no feed yet: %v", err)
	}
	feed := calendar.Feed{UserID: user, Token: "tok-" + uuid.NewString(), Include: calendar.Include{Review: true}, CreatedAt: time.Now()}
	if err := store.SaveFeed(ctx, feed, calendar.HashToken(feed.Token)); err != nil {
		t.Fatal(err)
	}
	got, err := store.FeedByHash(ctx, calendar.HashToken(feed.Token))
	if err != nil || got.UserID != user || got.Token != feed.Token || !got.Include.Review || got.Include.Loop {
		t.Fatalf("by hash: %+v %v", got, err)
	}
	if err := store.UpdateFeedOptions(ctx, user, true, calendar.Include{Loop: true}); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.GetFeed(ctx, user); !got.Named || got.Include.Review || !got.Include.Loop {
		t.Fatalf("options: %+v", got)
	}
	var stored string
	if err := pool.QueryRow(ctx, `SELECT token_enc FROM calendar_feeds WHERE user_id = $1`, user).Scan(&stored); err != nil || stored == feed.Token {
		t.Fatal("the token must be stored encrypted")
	}

	src, err := store.Source(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if src.Zone != "Asia/Ho_Chi_Minh" || src.Language != "vi" || src.ReminderHour != 21 || src.Since.IsZero() {
		t.Fatalf("source: %+v", src)
	}
	if len(src.Cycles) != 1 || src.Cycles[0].ID != current || src.Cycles[0].Goal != "IELTS 7" {
		t.Fatalf("cycles: %+v", src.Cycles)
	}
	if len(src.Training) != 2 || src.Training[0].Weekday != 1 || src.Training[0].Routine != "Push" {
		t.Fatalf("training: %+v", src.Training)
	}

	theirs, err := store.Source(ctx, other)
	if err != nil || len(theirs.Cycles) != 0 || len(theirs.Training) != 0 {
		t.Fatalf("another learner's source: %+v %v", theirs, err)
	}
}
