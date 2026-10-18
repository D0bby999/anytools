package byok_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/oauth"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// chain_test.go — the fallback chain, against a real database.
//
// These use Postgres rather than an in-memory double on purpose: the property
// under test is that a cooldown is PERSISTED, and an in-memory store cannot
// distinguish "remembered" from "written down". The restart test below rebuilds
// every store from a fresh pool for exactly that reason.

func newService(t *testing.T) (*byok.Service, *pg.ProviderConnectionStore, *pg.FunctionRouteStore) {
	t.Helper()
	pool := testutil.TestDB(t)
	key := testutil.TestEncryptionKey

	conns := pg.NewProviderConnectionStore(pool, key)
	routes := pg.NewFunctionRouteStore(pool, key)
	searchKeys := pg.NewSearchConnectionStore(pool, key)
	creds := pg.NewOAuthCredentialStore(pool, key)
	locker := pg.NewConnectionLockStore(pool)

	tokens, err := oauth.NewService(creds, conns, locker, nil, nil)
	if err != nil {
		t.Fatalf("oauth.NewService: %v", err)
	}
	return byok.NewService(conns, routes, searchKeys, tokens), conns, routes
}

// routeTwoGeminiKeys sets up a two-entry chat chain and returns the connection
// ids in chain order.
func routeTwoGeminiKeys(t *testing.T, conns *pg.ProviderConnectionStore, routes *pg.FunctionRouteStore, user uuid.UUID) (first, second uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	a, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
		Provider: "gemini", Kind: store.KindAPIKey, Name: "primary", Secret: "key-a",
	})
	if err != nil {
		t.Fatalf("create primary: %v", err)
	}
	b, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
		Provider: "gemini", Kind: store.KindAPIKey, Name: "backup", Secret: "key-b",
	})
	if err != nil {
		t.Fatalf("create backup: %v", err)
	}
	if err := routes.ReplaceRoute(ctx, user, "chat", []store.RouteEntryInput{
		{ConnectionID: a.ID, Model: "gemini-2.5-flash"},
		{ConnectionID: b.ID, Model: "gemini-2.5-flash"},
	}); err != nil {
		t.Fatalf("route: %v", err)
	}
	return a.ID, b.ID
}

// A 429 on the first entry must fall through to the second — and must leave the
// first benched so the NEXT call skips it without a network round trip.
func TestChainFailsOverOn429AndPersistsTheCooldown(t *testing.T) {
	pool := testutil.TestDB(t)
	svc, conns, routes := newService(t)
	user := testutil.NewUser(t, pool)
	first, second := routeTwoGeminiKeys(t, conns, routes, user)
	ctx := context.Background()

	chain, err := svc.ChatFor(ctx, user, byok.FunctionChat)
	if err != nil {
		t.Fatalf("ChatFor: %v", err)
	}
	if chain.Len() != 2 {
		t.Fatalf("chain length = %d, want 2", chain.Len())
	}

	var served []uuid.UUID
	err = chain.Do(ctx, func(_ context.Context, _ providers.Provider, e byok.Entry[providers.Provider]) error {
		served = append(served, e.ConnectionID)
		if e.ConnectionID == first {
			return &providers.HTTPError{Status: 429, Body: "rate limit exceeded"}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("chain.Do: %v", err)
	}
	if len(served) != 2 || served[0] != first || served[1] != second {
		t.Fatalf("chain did not fail over in order: %v", served)
	}

	benched, err := conns.GetConnection(ctx, user, first)
	if err != nil {
		t.Fatalf("read benched connection: %v", err)
	}
	if !benched.Settings.CoolingDownAt(time.Now()) {
		t.Fatalf("the 429'd connection was not benched: %+v", benched.Settings)
	}
	if benched.Settings.BackoffLevel != 1 {
		t.Errorf("backoff level = %d, want 1", benched.Settings.BackoffLevel)
	}
	if benched.Settings.CooldownReason != "rate_limit" {
		t.Errorf("cooldown reason = %q, want rate_limit", benched.Settings.CooldownReason)
	}

	// The winner is recorded as verified: a connection that just answered IS
	// verified, and not writing that back leaves the UI showing "unverified"
	// for a key doing real work.
	winner, err := conns.GetConnection(ctx, user, second)
	if err != nil {
		t.Fatalf("read winner: %v", err)
	}
	if winner.Settings.VerifyStatus != store.VerifyStatusVerified {
		t.Errorf("the successful connection was not marked verified: %+v", winner.Settings)
	}
}

// The phase's second success criterion, stated as a test: restart the API
// mid-cooldown and the cooled entry is still skipped.
//
// "Restart" is simulated the only way that proves anything — every store and the
// service itself are rebuilt from scratch, so nothing in the second half of the
// test shares memory with the first.
func TestCooldownSurvivesAProcessRestart(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()

	// --- first process ---
	svc, conns, routes := newService(t)
	user := testutil.NewUser(t, pool)
	first, second := routeTwoGeminiKeys(t, conns, routes, user)

	chain, err := svc.ChatFor(ctx, user, byok.FunctionChat)
	if err != nil {
		t.Fatalf("ChatFor: %v", err)
	}
	err = chain.Do(ctx, func(_ context.Context, _ providers.Provider, e byok.Entry[providers.Provider]) error {
		if e.ConnectionID == first {
			return &providers.HTTPError{Status: 429, Body: "quota exceeded"}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("first process chain.Do: %v", err)
	}

	// --- second process: nothing below shares state with anything above ---
	restarted, _, _ := newService(t)
	chain2, err := restarted.ChatFor(ctx, user, byok.FunctionChat)
	if err != nil {
		t.Fatalf("ChatFor after restart: %v", err)
	}

	var served []uuid.UUID
	err = chain2.Do(ctx, func(_ context.Context, _ providers.Provider, e byok.Entry[providers.Provider]) error {
		served = append(served, e.ConnectionID)
		return nil
	})
	if err != nil {
		t.Fatalf("chain.Do after restart: %v", err)
	}
	if len(served) != 1 || served[0] != second {
		t.Fatalf("after a restart the chain tried %v — the benched connection was resurrected, "+
			"which means the cooldown was in memory rather than in the database", served)
	}
}

// Every entry cooling down is not the same failure as no route at all, and the
// two have different remedies, so they are different errors.
func TestChainDistinguishesNoRouteFromEverythingCoolingDown(t *testing.T) {
	pool := testutil.TestDB(t)
	svc, conns, routes := newService(t)
	user := testutil.NewUser(t, pool)
	ctx := context.Background()

	chain, err := svc.ChatFor(ctx, user, byok.FunctionQuiz)
	if err != nil {
		t.Fatalf("ChatFor: %v", err)
	}
	if err := chain.Do(ctx, func(context.Context, providers.Provider, byok.Entry[providers.Provider]) error {
		t.Fatal("an unrouted function called a provider")
		return nil
	}); !errors.Is(err, byok.ErrNoRoute) {
		t.Fatalf("unrouted function = %v, want ErrNoRoute", err)
	}

	first, _ := routeTwoGeminiKeys(t, conns, routes, user)
	_ = first
	// Bench both.
	for _, c := range mustList(t, conns, user) {
		until := time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)
		if err := conns.MergeConnectionSettings(ctx, user, c.ID,
			[]byte(`{"cooldown_until":"`+until+`","cooldown_reason":"rate_limit"}`)); err != nil {
			t.Fatalf("bench: %v", err)
		}
	}

	chain, err = svc.ChatFor(ctx, user, byok.FunctionChat)
	if err != nil {
		t.Fatalf("ChatFor: %v", err)
	}
	err = chain.Do(ctx, func(context.Context, providers.Provider, byok.Entry[providers.Provider]) error {
		t.Fatal("a benched connection was called")
		return nil
	})
	var allFailed *byok.ErrAllEntriesFailed
	if !errors.As(err, &allFailed) {
		t.Fatalf("all-benched = %v, want ErrAllEntriesFailed", err)
	}
	if allFailed.Tried != 0 || allFailed.Skipped != 2 {
		t.Fatalf("expected 0 tried and 2 skipped, got %+v", allFailed)
	}
}

// A 401 is a credentials problem, not a rate limit: it must not advance the
// exponential backoff level, or a wrong key would eventually be benched for five
// minutes at a time and the user's fix would appear not to work.
func TestCredentialFailureDoesNotAdvanceBackoff(t *testing.T) {
	pool := testutil.TestDB(t)
	svc, conns, routes := newService(t)
	user := testutil.NewUser(t, pool)
	first, _ := routeTwoGeminiKeys(t, conns, routes, user)
	ctx := context.Background()

	for range 3 {
		chain, err := svc.ChatFor(ctx, user, byok.FunctionChat)
		if err != nil {
			t.Fatalf("ChatFor: %v", err)
		}
		// Clear the bench so the entry is tried each round.
		if err := conns.MergeConnectionSettings(ctx, user, first, []byte(`{"cooldown_until":null}`)); err != nil {
			t.Fatalf("unbench: %v", err)
		}
		_ = chain.Do(ctx, func(_ context.Context, _ providers.Provider, e byok.Entry[providers.Provider]) error {
			if e.ConnectionID == first {
				return &providers.HTTPError{Status: 401, Body: "invalid api key"}
			}
			return nil
		})
	}

	got, err := conns.GetConnection(ctx, user, first)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Settings.BackoffLevel != 0 {
		t.Fatalf("a 401 advanced the backoff level to %d", got.Settings.BackoffLevel)
	}
	if got.Settings.VerifyStatus != store.VerifyStatusFailed {
		t.Fatalf("a 401 did not mark the connection as failed: %+v", got.Settings)
	}
}

// A gateway blip must not burn a healthy connection: the chain retries the SAME
// entry once before moving on.
func TestTransientBlipRetriesTheSameEntryOnce(t *testing.T) {
	pool := testutil.TestDB(t)
	svc, conns, routes := newService(t)
	user := testutil.NewUser(t, pool)
	first, _ := routeTwoGeminiKeys(t, conns, routes, user)
	ctx := context.Background()

	svc.SetSleepForTest(func(time.Duration) {}) // the grace is real, the pause is not

	calls := map[uuid.UUID]int{}
	chain, err := svc.ChatFor(ctx, user, byok.FunctionChat)
	if err != nil {
		t.Fatalf("ChatFor: %v", err)
	}
	err = chain.Do(ctx, func(_ context.Context, _ providers.Provider, e byok.Entry[providers.Provider]) error {
		calls[e.ConnectionID]++
		if e.ConnectionID == first && calls[first] == 1 {
			return &providers.HTTPError{Status: 503, Body: "upstream restarting"}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("chain.Do: %v", err)
	}
	if calls[first] != 2 {
		t.Fatalf("the first entry was called %d times, want 2 (one blip plus the grace retry)", calls[first])
	}
	if len(calls) != 1 {
		t.Fatalf("the chain moved on despite the retry succeeding: %v", calls)
	}

	got, err := conns.GetConnection(ctx, user, first)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Settings.CoolingDownAt(time.Now()) {
		t.Fatal("a connection that recovered on the grace retry was benched anyway")
	}
}

func mustList(t *testing.T, conns *pg.ProviderConnectionStore, user uuid.UUID) []store.ProviderConnection {
	t.Helper()
	list, err := conns.ListConnections(context.Background(), user)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	return list
}

// ErrStopChain ends the walk without ending the bookkeeping.
//
// The caller that needs this is a streamed chat turn that has already put words
// on the screen: the chain's normal answer to a failure is "try the next
// connection", and the next connection starts its answer from the beginning.
// The entry that failed must still be benched — it did fail — but nothing after
// it may be called.
func TestStopChainBenchesTheEntryAndEndsTheWalk(t *testing.T) {
	pool := testutil.TestDB(t)
	svc, conns, routes := newService(t)
	user := testutil.NewUser(t, pool)
	first, _ := routeTwoGeminiKeys(t, conns, routes, user)
	ctx := context.Background()

	chain, err := svc.ChatFor(ctx, user, byok.FunctionChat)
	if err != nil {
		t.Fatalf("ChatFor: %v", err)
	}

	var tried []uuid.UUID
	err = chain.Do(ctx, func(_ context.Context, _ providers.Provider, e byok.Entry[providers.Provider]) error {
		tried = append(tried, e.ConnectionID)
		// A 503 would normally earn the transient-blip grace AND a second
		// entry; wrapped, it earns neither.
		return fmt.Errorf("%w: %w", byok.ErrStopChain, &providers.HTTPError{Status: 503, Body: "upstream gone"})
	})

	var allFailed *byok.ErrAllEntriesFailed
	if !errors.As(err, &allFailed) {
		t.Fatalf("error = %v, want ErrAllEntriesFailed", err)
	}
	if len(tried) != 1 || tried[0] != first {
		t.Fatalf("connections tried = %v, want only the first", tried)
	}

	// Benched, like any other failure: the next call must skip it.
	after, err := svc.ChatFor(ctx, user, byok.FunctionChat)
	if err != nil {
		t.Fatalf("ChatFor after: %v", err)
	}
	for _, e := range after.Entries() {
		if e.ConnectionID == first && !e.Settings.CoolingDownAt(time.Now()) {
			t.Fatal("a committed failure left the connection un-benched")
		}
	}
}
