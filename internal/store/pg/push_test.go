package pg_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/push"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
	"github.com/google/uuid"
)

const pushTestKey = testutil.TestEncryptionKey

func pushSub(t *testing.T) push.Subscription {
	return push.Subscription{
		Endpoint: "https://fcm.googleapis.com/fcm/send/" + uuid.NewString(),
		P256dh:   strings.Repeat("B", 87),
		Auth:     strings.Repeat("a", 22),
	}
}

// The reminder goes out once per local day, only inside the learner's window,
// and only to a learner with a subscribed browser; the zone is theirs.
func TestClaimReminderOncePerLocalDayInTheLearnersHour(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	store := pg.NewPushStore(pool, pushTestKey)
	user := testutil.NewUser(t, pool)
	if _, err := pool.Exec(ctx, `UPDATE users SET timezone = 'Asia/Ho_Chi_Minh', language = 'vi' WHERE id = $1`, user); err != nil {
		t.Fatal(err)
	}
	if err := store.SetHour(ctx, user, 7); err != nil {
		t.Fatal(err)
	}
	// 07:30 in Saigon is 00:30 UTC.
	at := func(day, hour, minute int) time.Time { return time.Date(2026, 10, day, hour, minute, 0, 0, time.UTC) }

	if _, _, ok, err := store.ClaimReminder(ctx, user, at(20, 0, 30), 3); err != nil || ok {
		t.Fatalf("no subscription yet: ok=%v err=%v", ok, err)
	}
	sub := pushSub(t)
	if err := store.Subscribe(ctx, user, sub); err != nil {
		t.Fatal(err)
	}
	if _, _, ok, _ := store.ClaimReminder(ctx, user, at(19, 23, 30), 3); ok {
		t.Fatal("claimed at 06:30 local, before the learner's hour")
	}
	subs, language, ok, err := store.ClaimReminder(ctx, user, at(20, 0, 30), 3)
	if err != nil || !ok || len(subs) != 1 || subs[0] != sub || language != "vi" {
		t.Fatalf("07:30 local: subs=%v language=%q ok=%v err=%v", subs, language, ok, err)
	}
	if _, _, ok, _ := store.ClaimReminder(ctx, user, at(20, 1, 30), 3); ok {
		t.Fatal("claimed a second time on the same local day")
	}
	if _, _, ok, _ := store.ClaimReminder(ctx, user, at(21, 3, 30), 3); ok {
		t.Fatal("claimed at 10:30 local, after the window")
	}
	if _, _, ok, _ := store.ClaimReminder(ctx, user, at(21, 2, 0), 3); !ok {
		t.Fatal("09:00 local the next day is inside the window and was not claimed")
	}
}

func TestSubscriptionMovesWithTheBrowserAndUnsubscribeIsScoped(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	store := pg.NewPushStore(pool, pushTestKey)
	a, b := testutil.NewUser(t, pool), testutil.NewUser(t, pool)
	sub := pushSub(t)

	if err := store.Subscribe(ctx, a, sub); err != nil {
		t.Fatal(err)
	}
	if err := store.Unsubscribe(ctx, b, sub.Endpoint); err != nil {
		t.Fatal(err)
	}
	if subs, _ := store.Subscriptions(ctx, a); len(subs) != 1 {
		t.Fatal("another learner's unsubscribe removed this learner's browser")
	}
	if err := store.Subscribe(ctx, b, sub); err != nil {
		t.Fatal(err)
	}
	subsA, _ := store.Subscriptions(ctx, a)
	subsB, _ := store.Subscriptions(ctx, b)
	if len(subsA) != 0 || len(subsB) != 1 {
		t.Fatalf("after the browser signed in as b: a=%d b=%d", len(subsA), len(subsB))
	}
	if err := store.Forget(ctx, sub.Endpoint); err != nil {
		t.Fatal(err)
	}
	if subsB, _ = store.Subscriptions(ctx, b); len(subsB) != 0 {
		t.Fatal("a forgotten endpoint is still subscribed")
	}
}

func TestVAPIDPrivateKeyIsStoredEncrypted(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `DELETE FROM push_vapid`); err != nil {
		t.Fatal(err)
	}
	store := pg.NewPushStore(pool, pushTestKey)
	first, err := store.SaveVAPIDKeys(ctx, push.Keys{Public: "pub-1", Private: "secret-1"})
	if err != nil || first.Private != "secret-1" {
		t.Fatalf("first = %+v, %v", first, err)
	}
	second, _ := store.SaveVAPIDKeys(ctx, push.Keys{Public: "pub-2", Private: "secret-2"})
	if second != first {
		t.Fatalf("a second save replaced the pair: %+v", second)
	}
	var raw string
	_ = pool.QueryRow(ctx, `SELECT private_key_enc FROM push_vapid`).Scan(&raw)
	if raw == "" || strings.Contains(raw, "secret-1") {
		t.Fatalf("private key stored as %q", raw)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM push_vapid`); err != nil {
		t.Fatal(err)
	}
}

// The language a learner picks is kept; the automatic report fills only an
// unset one, and the column refuses a language the app is not written in.
func TestSetLanguageKeepsAChosenOne(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	users := pg.NewUserStore(pool)
	user := testutil.NewUser(t, pool)

	if changed, err := users.SetLanguage(ctx, user, "vi", true); err != nil || !changed {
		t.Fatalf("first report: changed=%v err=%v", changed, err)
	}
	if changed, _ := users.SetLanguage(ctx, user, "es", true); changed {
		t.Fatal("an automatic report overwrote a language already set")
	}
	if changed, err := users.SetLanguage(ctx, user, "pt", false); err != nil || !changed {
		t.Fatalf("a choice: changed=%v err=%v", changed, err)
	}
	if _, err := users.SetLanguage(ctx, user, "fr", false); err == nil {
		t.Fatal("the column accepted a language the app is not written in")
	}
	u, err := users.GetUser(ctx, user)
	if err != nil || u.Language != "pt" || u.LanguageSetAt == nil {
		t.Fatalf("user = %+v, %v", u, err)
	}
}
