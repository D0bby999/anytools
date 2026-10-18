package oauth_test

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/oauth"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// refresh_concurrency_test.go — the test the spike's measurements exist to
// justify.
//
// Spike A2 measured postclaw's shape on a local stub (reports/spike-providers.md):
//
//	no lock, simultaneous : 1 refresh accepted, 4 invalid_grant, 5/5 callers
//	                        left holding a dead token
//	no lock, 120 ms apart : 5 accepted, 5 distinct refresh tokens minted
//	advisory lock         : 1 accepted, 0 rejected
//	lock + 120 ms apart   : 5 accepted — the lock SERIALISES but does not
//	                        DEDUPLICATE, because postclaw never re-reads the
//	                        connection inside the lock
//	nil locker            : identical to no lock, with zero warnings logged
//
// AnyTools' answer to the last two is the in-lock re-read plus a locker that is
// a required constructor argument. This file pins both.

// countingRefresh is a token endpoint that mints single-use refresh tokens, the
// way both real lanes do.
type countingRefresh struct {
	mu        sync.Mutex
	calls     atomic.Int64
	rejected  atomic.Int64
	liveToken string
	minted    int
}

func (c *countingRefresh) fn(_ context.Context, _ oauth.Flow, refreshToken string) (*oauth.TokenResult, error) {
	c.calls.Add(1)
	c.mu.Lock()
	defer c.mu.Unlock()
	if refreshToken != c.liveToken {
		// This is what a rotating provider answers to a token that has already
		// been spent — and what postclaw turns into markNeedsReconnect.
		c.rejected.Add(1)
		return nil, errors.New("invalid_grant")
	}
	c.minted++
	c.liveToken = "refresh-" + uuid.NewString()
	return &oauth.TokenResult{
		AccessToken:  "access-" + uuid.NewString(),
		RefreshToken: c.liveToken,
		ExpiresAt:    time.Now().Add(time.Hour),
	}, nil
}

func setupExpiringConnection(t *testing.T) (svc *oauth.Service, refresher *countingRefresh, userID, connID uuid.UUID) {
	t.Helper()
	pool := testutil.TestDB(t)
	key := testutil.TestEncryptionKey
	ctx := context.Background()

	conns := pg.NewProviderConnectionStore(pool, key)
	creds := pg.NewOAuthCredentialStore(pool, key)
	locker := pg.NewConnectionLockStore(pool)

	userID = testutil.NewUser(t, pool)
	conn, err := conns.CreateConnection(ctx, userID, store.NewProviderConnection{
		Provider: "chatgpt_relay",
		Kind:     store.KindOAuthRelay,
		Name:     "relay",
		Settings: store.ConnectionSettings{OAuth: &store.OAuthMeta{Flow: string(oauth.FlowChatGPTRelay)}},
	})
	if err != nil {
		t.Fatalf("create connection: %v", err)
	}

	refresher = &countingRefresh{liveToken: "refresh-initial"}
	// One minute out: inside ServeRefreshLead, so every caller sees a token that
	// needs refreshing.
	expires := time.Now().Add(time.Minute)
	if err := creds.SaveOAuthCredential(ctx, userID, conn.ID, "access-stale", refresher.liveToken, &expires); err != nil {
		t.Fatalf("save credential: %v", err)
	}

	svc, err = oauth.NewService(creds, conns, locker, refresher.fn, nil)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc, refresher, userID, conn.ID
}

// N=5 concurrent callers on one OAuth connection → exactly ONE call to the
// token endpoint.
func TestFiveConcurrentCallersCauseExactlyOneRefresh(t *testing.T) {
	svc, refresher, userID, connID := setupExpiringConnection(t)

	const n = 5
	var wg sync.WaitGroup
	start := make(chan struct{})
	tokens := make([]string, n)
	errs := make([]error, n)

	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start // release all five at once
			tokens[i], errs[i] = svc.AccessToken(context.Background(), userID, connID)
		}()
	}
	close(start)
	wg.Wait()

	if got := refresher.calls.Load(); got != 1 {
		t.Fatalf("token endpoint was called %d times, want exactly 1", got)
	}
	if got := refresher.rejected.Load(); got != 0 {
		t.Fatalf("%d refreshes were rejected as invalid_grant — an unsynchronised refresh "+
			"burns the connection", got)
	}
	for i := range n {
		if errs[i] != nil {
			t.Fatalf("caller %d failed: %v", i, errs[i])
		}
		if tokens[i] == "" {
			t.Fatalf("caller %d got an empty token", i)
		}
	}
}

// The spike's finding (d): a lock alone does not deduplicate. Callers arriving
// 120 ms apart each take the lock in turn, and without an in-lock re-read each
// one refreshes a token the previous holder already replaced — five refreshes,
// five rotations, four of them pointless and every one of them a chance to lose
// the live credential.
func TestStaggeredCallersStillCauseExactlyOneRefresh(t *testing.T) {
	svc, refresher, userID, connID := setupExpiringConnection(t)

	const n = 5
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			time.Sleep(time.Duration(i) * 120 * time.Millisecond)
			if _, err := svc.AccessToken(context.Background(), userID, connID); err != nil {
				t.Errorf("caller %d: %v", i, err)
			}
		}()
	}
	wg.Wait()

	if got := refresher.calls.Load(); got != 1 {
		t.Fatalf("token endpoint was called %d times with a 120 ms stagger, want exactly 1 — "+
			"the lock serialised but did not deduplicate, which means the in-lock re-read is missing", got)
	}
}

// A nil locker must be a construction error, not a silently disabled lock.
func TestNewServiceRefusesANilLocker(t *testing.T) {
	pool := testutil.TestDB(t)
	key := testutil.TestEncryptionKey
	_, err := oauth.NewService(
		pg.NewOAuthCredentialStore(pool, key),
		pg.NewProviderConnectionStore(pool, key),
		nil, nil, nil,
	)
	if !errors.Is(err, oauth.ErrNoLocker) {
		t.Fatalf("NewService with a nil locker = %v, want ErrNoLocker — postclaw's optional "+
			"locker is the configuration that self-destructs a healthy connection", err)
	}
}

// A token that is not near expiry must not be refreshed at all: refreshing
// early rotates a working credential for nothing.
func TestAHealthyTokenIsNotRefreshed(t *testing.T) {
	pool := testutil.TestDB(t)
	key := testutil.TestEncryptionKey
	ctx := context.Background()

	conns := pg.NewProviderConnectionStore(pool, key)
	creds := pg.NewOAuthCredentialStore(pool, key)
	userID := testutil.NewUser(t, pool)

	conn, err := conns.CreateConnection(ctx, userID, store.NewProviderConnection{
		Provider: "chatgpt_relay", Kind: store.KindOAuthRelay, Name: "relay",
		Settings: store.ConnectionSettings{OAuth: &store.OAuthMeta{Flow: string(oauth.FlowChatGPTRelay)}},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	far := time.Now().Add(6 * time.Hour)
	if err := creds.SaveOAuthCredential(ctx, userID, conn.ID, "access-good", "refresh-good", &far); err != nil {
		t.Fatalf("save: %v", err)
	}

	refresher := &countingRefresh{liveToken: "refresh-good"}
	svc, err := oauth.NewService(creds, conns, pg.NewConnectionLockStore(pool), refresher.fn, nil)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}

	tok, err := svc.AccessToken(ctx, userID, conn.ID)
	if err != nil {
		t.Fatalf("AccessToken: %v", err)
	}
	if tok != "access-good" {
		t.Fatalf("got %q, want the stored token", tok)
	}
	if refresher.calls.Load() != 0 {
		t.Fatal("a healthy token was refreshed")
	}
}

// A refresh the provider rejects permanently must flag the connection for
// reconnect — and must NOT lose the caller's request: the stale token is served
// and the provider adjudicates it.
func TestPermanentGrantFailureFlagsReconnect(t *testing.T) {
	pool := testutil.TestDB(t)
	key := testutil.TestEncryptionKey
	ctx := context.Background()

	conns := pg.NewProviderConnectionStore(pool, key)
	creds := pg.NewOAuthCredentialStore(pool, key)
	userID := testutil.NewUser(t, pool)

	conn, err := conns.CreateConnection(ctx, userID, store.NewProviderConnection{
		Provider: "chatgpt_relay", Kind: store.KindOAuthRelay, Name: "relay",
		Settings: store.ConnectionSettings{OAuth: &store.OAuthMeta{Flow: string(oauth.FlowChatGPTRelay)}},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	soon := time.Now().Add(time.Minute)
	if err := creds.SaveOAuthCredential(ctx, userID, conn.ID, "access-stale", "refresh-revoked", &soon); err != nil {
		t.Fatalf("save: %v", err)
	}

	dead := func(context.Context, oauth.Flow, string) (*oauth.TokenResult, error) {
		return nil, oauth.ErrPermanentGrantFailure
	}
	svc, err := oauth.NewService(creds, conns, pg.NewConnectionLockStore(pool), dead,
		oauth.StoreNotifier{Conns: conns})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}

	tok, err := svc.AccessToken(ctx, userID, conn.ID)
	if err != nil {
		t.Fatalf("AccessToken: %v", err)
	}
	if tok != "access-stale" {
		t.Fatalf("got %q — a failed refresh must still serve the token in hand", tok)
	}

	after, err := conns.GetConnection(ctx, userID, conn.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if after.Settings.OAuth == nil || !after.Settings.OAuth.NeedsReconnect {
		t.Fatalf("the connection was not flagged for reconnect: %+v", after.Settings)
	}
	if after.VerifiedAt != nil {
		t.Error("a connection needing reconnect is still marked verified")
	}
	// The flag must not cost the lane its identity. The settings merge is
	// shallow, so writing a bare {"oauth":{"needs_reconnect":true}} would
	// replace the whole object and leave a connection nothing could ever
	// refresh again, because no code would know which flow it belonged to.
	if after.Settings.OAuth.Flow != string(oauth.FlowChatGPTRelay) {
		t.Fatalf("flagging the connection erased its flow: %+v", after.Settings.OAuth)
	}
}
