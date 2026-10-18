package pg_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// newStore gives each test a store over the shared pool and a cleanup that
// removes only the rows that test created — the suite runs against one
// database and must not truncate another test's fixtures.
func newStore(t *testing.T) (*pg.UserStore, *pgxpool.Pool, context.Context) {
	t.Helper()
	pool := testutil.TestDB(t)
	return pg.NewUserStore(pool), pool, context.Background()
}

func cleanupUser(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) {
	t.Helper()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
}

func claims(provider, subject, email string) store.IdentityClaims {
	return store.IdentityClaims{
		Provider:      provider,
		Subject:       subject,
		Email:         email,
		EmailVerified: true,
		DisplayName:   "Test User",
	}
}

// Case 5 of the policy: an unknown identity with an unclaimed address creates
// an account.
func TestUpsertIdentityCreatesNewUser(t *testing.T) {
	s, pool, ctx := newStore(t)
	email := uniqueEmail(t)

	user, err := s.UpsertIdentity(ctx, claims("google", uniqueSubject(t), email), uuid.Nil)
	if err != nil {
		t.Fatalf("UpsertIdentity: %v", err)
	}
	cleanupUser(t, pool, user.ID)

	if user.ID == uuid.Nil {
		t.Fatal("new user has a nil id")
	}
	if user.Email != email {
		t.Fatalf("email = %q, want %q", user.Email, email)
	}
	if user.EmailVerifiedAt == nil {
		t.Fatal("email_verified_at not set for a verified provider email")
	}

	var identityCount int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM user_identities WHERE user_id = $1`, user.ID).Scan(&identityCount); err != nil {
		t.Fatalf("count identities: %v", err)
	}
	if identityCount != 1 {
		t.Fatalf("identity rows = %d, want 1", identityCount)
	}
}

// Case 2: the same (provider, subject) is the same person, not a second
// account — and the match is on the subject, so an address change at the
// provider does not fork the account.
func TestUpsertIdentitySameProviderReturnsSameUser(t *testing.T) {
	s, pool, ctx := newStore(t)
	subject := uniqueSubject(t)
	email := uniqueEmail(t)

	first, err := s.UpsertIdentity(ctx, claims("google", subject, email), uuid.Nil)
	if err != nil {
		t.Fatalf("first sign in: %v", err)
	}
	cleanupUser(t, pool, first.ID)

	second, err := s.UpsertIdentity(ctx, claims("google", subject, email), uuid.Nil)
	if err != nil {
		t.Fatalf("second sign in: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("second sign in created a new user: %s != %s", second.ID, first.ID)
	}

	changed := claims("google", subject, uniqueEmail(t))
	third, err := s.UpsertIdentity(ctx, changed, uuid.Nil)
	if err != nil {
		t.Fatalf("sign in after provider email change: %v", err)
	}
	if third.ID != first.ID {
		t.Fatalf("changed provider email forked the account: %s != %s", third.ID, first.ID)
	}
}

// Case 3: linking a second provider is allowed only because the browser already
// proved it controls the target account.
func TestUpsertIdentityLinksSecondProviderWhenSignedIn(t *testing.T) {
	s, pool, ctx := newStore(t)
	email := uniqueEmail(t)

	user, err := s.UpsertIdentity(ctx, claims("google", uniqueSubject(t), email), uuid.Nil)
	if err != nil {
		t.Fatalf("google sign in: %v", err)
	}
	cleanupUser(t, pool, user.ID)

	linked, err := s.UpsertIdentity(ctx, claims("github", uniqueSubject(t), email), user.ID)
	if err != nil {
		t.Fatalf("linking github while signed in: %v", err)
	}
	if linked.ID != user.ID {
		t.Fatalf("linking created a new user: %s != %s", linked.ID, user.ID)
	}

	var providers []string
	rows, err := pool.Query(ctx,
		`SELECT provider FROM user_identities WHERE user_id = $1 ORDER BY provider`, user.ID)
	if err != nil {
		t.Fatalf("list identities: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			t.Fatalf("scan: %v", err)
		}
		providers = append(providers, p)
	}
	if len(providers) != 2 || providers[0] != "github" || providers[1] != "google" {
		t.Fatalf("identities = %v, want [github google]", providers)
	}
}

// Case 4 — the account-takeover guard. Anyone can register a victim's address
// at a provider AnyTools trusts; auto-linking on an unauthenticated callback
// would hand them the victim's documents and BYOK credentials.
func TestUpsertIdentityRefusesTakeoverWhenSignedOut(t *testing.T) {
	s, pool, ctx := newStore(t)
	email := uniqueEmail(t)

	victim, err := s.UpsertIdentity(ctx, claims("google", uniqueSubject(t), email), uuid.Nil)
	if err != nil {
		t.Fatalf("victim sign up: %v", err)
	}
	cleanupUser(t, pool, victim.ID)

	_, err = s.UpsertIdentity(ctx, claims("github", uniqueSubject(t), email), uuid.Nil)
	if !errors.Is(err, store.ErrEmailBelongsToAnotherUser) {
		t.Fatalf("want ErrEmailBelongsToAnotherUser, got %v", err)
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM user_identities WHERE user_id = $1`, victim.ID).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("refused attempt still wrote an identity: %d rows", count)
	}
}

// Case 1: an unverified address is refused before anything is written. A
// provider that will not assert the address is a provider that lets anyone
// claim it.
func TestUpsertIdentityRefusesUnverifiedEmail(t *testing.T) {
	s, _, ctx := newStore(t)

	c := claims("google", uniqueSubject(t), uniqueEmail(t))
	c.EmailVerified = false

	if _, err := s.UpsertIdentity(ctx, c, uuid.Nil); !errors.Is(err, store.ErrUnverifiedEmail) {
		t.Fatalf("want ErrUnverifiedEmail, got %v", err)
	}
}

// Emails must match case-insensitively at the DB layer, not just in Go —
// postclaw keyed accounts by a raw string and "Chau@Gmail.com" silently became
// a second workspace.
func TestEmailMatchingIsCaseInsensitive(t *testing.T) {
	s, pool, ctx := newStore(t)
	email := uniqueEmail(t)

	user, err := s.UpsertIdentity(ctx, claims("google", uniqueSubject(t), email), uuid.Nil)
	if err != nil {
		t.Fatalf("sign up: %v", err)
	}
	cleanupUser(t, pool, user.ID)

	upper := claims("github", uniqueSubject(t), upperCase(email))
	if _, err := s.UpsertIdentity(ctx, upper, uuid.Nil); !errors.Is(err, store.ErrEmailBelongsToAnotherUser) {
		t.Fatalf("a case variant created a second account instead of colliding: %v", err)
	}
}

// A session naming a user that no longer exists must fail loudly rather than
// silently stranding the person in a brand-new empty workspace.
func TestUpsertIdentityWithStaleSessionUserFails(t *testing.T) {
	s, _, ctx := newStore(t)

	_, err := s.UpsertIdentity(ctx, claims("github", uniqueSubject(t), uniqueEmail(t)), uuid.New())
	if !errors.Is(err, store.ErrUserNotFound) {
		t.Fatalf("want ErrUserNotFound, got %v", err)
	}
}

func TestGetUserAndUserExists(t *testing.T) {
	s, pool, ctx := newStore(t)

	user, err := s.UpsertIdentity(ctx, claims("google", uniqueSubject(t), uniqueEmail(t)), uuid.Nil)
	if err != nil {
		t.Fatalf("sign up: %v", err)
	}
	cleanupUser(t, pool, user.ID)

	got, err := s.GetUser(ctx, user.ID)
	if err != nil || got.ID != user.ID {
		t.Fatalf("GetUser = (%v, %v)", got, err)
	}
	if ok, err := s.UserExists(ctx, user.ID); err != nil || !ok {
		t.Fatalf("UserExists = (%v, %v), want (true, nil)", ok, err)
	}
	if ok, err := s.UserExists(ctx, uuid.New()); err != nil || ok {
		t.Fatalf("UserExists(unknown) = (%v, %v), want (false, nil)", ok, err)
	}
}

// A soft-deleted account's still-valid session cookie must stop working: the
// middleware's existence check is what enforces that, so the store has to
// report a deleted user as absent.
func TestSoftDeletedUserIsInvisible(t *testing.T) {
	s, pool, ctx := newStore(t)

	user, err := s.UpsertIdentity(ctx, claims("google", uniqueSubject(t), uniqueEmail(t)), uuid.Nil)
	if err != nil {
		t.Fatalf("sign up: %v", err)
	}
	cleanupUser(t, pool, user.ID)

	if _, err := pool.Exec(ctx, `UPDATE users SET deleted_at = now() WHERE id = $1`, user.ID); err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	if ok, err := s.UserExists(ctx, user.ID); err != nil || ok {
		t.Fatalf("deleted user still exists: (%v, %v)", ok, err)
	}
	if _, err := s.GetUser(ctx, user.ID); !errors.Is(err, store.ErrUserNotFound) {
		t.Fatalf("GetUser on deleted user = %v, want ErrUserNotFound", err)
	}
}

// A soft-deleted account releases its address, so the person can sign up again.
func TestSoftDeletedUserReleasesEmail(t *testing.T) {
	s, pool, ctx := newStore(t)
	email := uniqueEmail(t)

	first, err := s.UpsertIdentity(ctx, claims("google", uniqueSubject(t), email), uuid.Nil)
	if err != nil {
		t.Fatalf("first sign up: %v", err)
	}
	cleanupUser(t, pool, first.ID)

	if _, err := pool.Exec(ctx, `UPDATE users SET deleted_at = now() WHERE id = $1`, first.ID); err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	second, err := s.UpsertIdentity(ctx, claims("google", uniqueSubject(t), email), uuid.Nil)
	if err != nil {
		t.Fatalf("re-signup after deletion: %v", err)
	}
	cleanupUser(t, pool, second.ID)

	if second.ID == first.ID {
		t.Fatal("re-signup reused the deleted account")
	}
}

// Two simultaneous first-sign-ins for the same address both read "no account
// here" and both proceed; one loses at COMMIT on users_email_unique_live.
//
// The index keeps the data correct either way — the point of this test is the
// ERROR the loser gets. Before the constraint was translated, it surfaced as a
// raw SQLSTATE 23505 that the handler mapped to a 500, so a user hitting the
// race saw "the server broke" instead of "this email already has an account,
// sign in with X".
func TestConcurrentFirstSignInsForOneEmailAllResolveCleanly(t *testing.T) {
	s, pool, ctx := newStore(t)
	email := uniqueEmail(t)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, email)
	})

	const racers = 6
	var wg sync.WaitGroup
	results := make([]*store.User, racers)
	errs := make([]error, racers)

	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			results[n], errs[n] = s.UpsertIdentity(ctx, claims("google", uuid.NewString(), email), uuid.Nil)
		}(i)
	}
	wg.Wait()

	created := 0
	for i, err := range errs {
		switch {
		case err == nil:
			created++
			if results[i] == nil {
				t.Errorf("racer %d returned a nil user with a nil error", i)
			}
		case errors.Is(err, store.ErrEmailBelongsToAnotherUser):
			// The correct refusal: a 409 the login page can explain.
		default:
			t.Errorf("racer %d got an untranslated error, which the handler would turn into a 500: %v", i, err)
		}
	}

	if created != 1 {
		t.Fatalf("%d racers created an account; exactly one must win", created)
	}

	var users int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE email = $1`, email).Scan(&users); err != nil {
		t.Fatalf("count users: %v", err)
	}
	if users != 1 {
		t.Fatalf("%d user rows exist for one address — the unique index did not hold", users)
	}
}

// The same person finishing the same flow twice (a double click, two tabs)
// races on user_identities_provider_subject_unique. It is one person, so both
// calls must return their account rather than one of them erroring.
func TestConcurrentSignInsWithTheSameIdentityReturnOneAccount(t *testing.T) {
	s, pool, ctx := newStore(t)
	email := uniqueEmail(t)
	subject := uniqueSubject(t)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, email)
	})

	const racers = 6
	var wg sync.WaitGroup
	results := make([]*store.User, racers)
	errs := make([]error, racers)

	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			results[n], errs[n] = s.UpsertIdentity(ctx, claims("google", subject, email), uuid.Nil)
		}(i)
	}
	wg.Wait()

	var winner uuid.UUID
	for i, err := range errs {
		if err != nil {
			t.Errorf("racer %d failed; the same identity twice is one person, not an error: %v", i, err)
			continue
		}
		if winner == uuid.Nil {
			winner = results[i].ID
		} else if results[i].ID != winner {
			t.Errorf("racer %d got user %s, another got %s — one identity produced two accounts",
				i, results[i].ID, winner)
		}
	}

	var identities int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM user_identities WHERE provider = 'google' AND subject = $1`, subject,
	).Scan(&identities); err != nil {
		t.Fatalf("count identities: %v", err)
	}
	if identities != 1 {
		t.Fatalf("%d identity rows for one (provider, subject)", identities)
	}
}

// The takeover guard must hold on EVERY link attempt, not just the first. An
// account that already has two identities is still an account someone else's
// signed-out callback must not join.
func TestTakeoverGuardHoldsForAThirdProviderToo(t *testing.T) {
	s, pool, ctx := newStore(t)
	email := uniqueEmail(t)

	victim, err := s.UpsertIdentity(ctx, claims("google", uniqueSubject(t), email), uuid.Nil)
	if err != nil {
		t.Fatalf("victim sign up: %v", err)
	}
	cleanupUser(t, pool, victim.ID)

	// Second identity, legitimately linked while signed in.
	if _, err := s.UpsertIdentity(ctx, claims("github", uniqueSubject(t), email), victim.ID); err != nil {
		t.Fatalf("link second provider: %v", err)
	}

	// A third attempt from a signed-out callback must still be refused.
	_, err = s.UpsertIdentity(ctx, claims("github", uniqueSubject(t), email), uuid.Nil)
	if !errors.Is(err, store.ErrEmailBelongsToAnotherUser) {
		t.Fatalf("want ErrEmailBelongsToAnotherUser on the third provider, got %v", err)
	}

	var identities int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM user_identities WHERE user_id = $1`, victim.ID).Scan(&identities); err != nil {
		t.Fatalf("count: %v", err)
	}
	if identities != 2 {
		t.Fatalf("identity rows = %d, want 2 — the refused attempt wrote a row", identities)
	}
}

// A proven session authorizes linking to THAT account — not carrying a third
// party's address into it. Without the guard, account A ends up holding a
// verified identity whose email belongs to live account B, and "one live
// account per verified email" stops being true in user_identities even though
// it still holds in users. Sharing and invites in later phases resolve people
// by email and would inherit the collision.
func TestLinkingRefusesAnEmailOwnedByAnotherLiveUser(t *testing.T) {
	s, pool, ctx := newStore(t)

	alice, err := s.UpsertIdentity(ctx, claims("google", uniqueSubject(t), uniqueEmail(t)), uuid.Nil)
	if err != nil {
		t.Fatalf("alice sign up: %v", err)
	}
	cleanupUser(t, pool, alice.ID)

	bobEmail := uniqueEmail(t)
	bob, err := s.UpsertIdentity(ctx, claims("google", uniqueSubject(t), bobEmail), uuid.Nil)
	if err != nil {
		t.Fatalf("bob sign up: %v", err)
	}
	cleanupUser(t, pool, bob.ID)

	// Alice is signed in and tries to link an identity asserting BOB's address.
	_, err = s.UpsertIdentity(ctx, claims("github", uniqueSubject(t), bobEmail), alice.ID)
	if !errors.Is(err, store.ErrEmailBelongsToAnotherUser) {
		t.Fatalf("want ErrEmailBelongsToAnotherUser, got %v", err)
	}

	var linked int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM user_identities WHERE user_id = $1`, alice.ID).Scan(&linked); err != nil {
		t.Fatalf("count: %v", err)
	}
	if linked != 1 {
		t.Fatalf("alice has %d identities; the refused link wrote a row", linked)
	}
}

// The ordinary case must keep working: linking an identity that asserts the
// account's OWN address is exactly what the linking feature is for.
func TestLinkingAcceptsTheAccountsOwnEmail(t *testing.T) {
	s, pool, ctx := newStore(t)
	email := uniqueEmail(t)

	user, err := s.UpsertIdentity(ctx, claims("google", uniqueSubject(t), email), uuid.Nil)
	if err != nil {
		t.Fatalf("sign up: %v", err)
	}
	cleanupUser(t, pool, user.ID)

	linked, err := s.UpsertIdentity(ctx, claims("github", uniqueSubject(t), email), user.ID)
	if err != nil {
		t.Fatalf("linking the account's own email was refused: %v", err)
	}
	if linked.ID != user.ID {
		t.Fatalf("linked to %s, want %s", linked.ID, user.ID)
	}
}

// The browser's automatic report (onlyIfUnset) sets a zone once and never
// overwrites one the learner chose in Settings.
func TestSetTimezoneKeepsTheLearnersChoice(t *testing.T) {
	s, pool, ctx := newStore(t)
	id := testutil.NewUser(t, pool)

	u, err := s.GetUser(ctx, id)
	if err != nil || u.Timezone != "UTC" || u.TimezoneSetAt != nil {
		t.Fatalf("a new user: %+v, %v; want UTC and not set", u, err)
	}
	if changed, err := s.SetTimezone(ctx, id, "Asia/Ho_Chi_Minh", true); err != nil || !changed {
		t.Fatalf("first automatic report: %v, %v", changed, err)
	}
	if changed, _ := s.SetTimezone(ctx, id, "Europe/Berlin", true); changed {
		t.Fatal("a second automatic report overwrote the zone")
	}
	if changed, _ := s.SetTimezone(ctx, id, "Europe/Berlin", false); !changed {
		t.Fatal("a choice made in Settings was not saved")
	}
	if zone, err := s.Timezone(ctx, id); err != nil || zone != "Europe/Berlin" {
		t.Fatalf("Timezone = %q, %v", zone, err)
	}
	if _, err := s.Timezone(ctx, uuid.New()); !errors.Is(err, store.ErrUserNotFound) {
		t.Fatalf("an unknown user: %v", err)
	}
}
