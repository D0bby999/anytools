package pg_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/crypto"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// byok_store_test.go — what the database guarantees about BYOK rows.
//
// Every test here runs against a real Postgres. A fake store cannot fail the way
// these can: "a route may not point at another user's connection" is a composite
// foreign key, not a Go if-statement, and an in-memory double would happily
// accept the row this file proves the database rejects.

func stores(t *testing.T) (*pg.ProviderConnectionStore, *pg.FunctionRouteStore, *pg.SearchConnectionStore, *pg.OAuthCredentialStore) {
	t.Helper()
	pool := testutil.TestDB(t)
	key := testutil.TestEncryptionKey
	return pg.NewProviderConnectionStore(pool, key),
		pg.NewFunctionRouteStore(pool, key),
		pg.NewSearchConnectionStore(pool, key),
		pg.NewOAuthCredentialStore(pool, key)
}

func newConn(t *testing.T, s *pg.ProviderConnectionStore, userID uuid.UUID, name string) *store.ProviderConnection {
	t.Helper()
	conn, err := s.CreateConnection(context.Background(), userID, store.NewProviderConnection{
		Provider: "gemini", Kind: store.KindAPIKey, Name: name, Secret: "test-key-" + name,
	})
	if err != nil {
		t.Fatalf("create connection: %v", err)
	}
	return conn
}

// The secret is encrypted at rest. Read the raw column and prove the plaintext
// is not in it — the encryptOrFail helper exists because postclaw's equivalent
// guard silently SKIPPED encryption when no key was configured.
func TestConnectionSecretIsEncryptedAtRest(t *testing.T) {
	pool := testutil.TestDB(t)
	conns, _, _, _ := stores(t)
	user := testutil.NewUser(t, pool)

	const secret = "sk-this-must-never-appear-in-the-column"
	conn, err := conns.CreateConnection(context.Background(), user, store.NewProviderConnection{
		Provider: "openai", Kind: store.KindAPIKey, Name: "openai", Secret: secret,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	var raw string
	if err := pool.QueryRow(context.Background(),
		`SELECT secret_enc FROM provider_connections WHERE id = $1`, conn.ID).Scan(&raw); err != nil {
		t.Fatalf("read raw column: %v", err)
	}
	if strings.Contains(raw, secret) {
		t.Fatal("the plaintext key is in the database column")
	}
	if !crypto.IsEncrypted(raw) {
		t.Fatalf("the stored value is not recognisably ciphertext")
	}

	// And the round trip works, or the encryption would be a data-loss bug
	// rather than a security control.
	back, err := conns.GetConnectionWithSecret(context.Background(), user, conn.ID)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if back.Secret != secret {
		t.Fatal("decrypted secret does not match what was stored")
	}
}

// The read a handler uses must not carry a secret at all, so a response writer
// has nothing to leak even if someone adds a field to the DTO.
func TestHandlerFacingReadsCarryNoSecret(t *testing.T) {
	pool := testutil.TestDB(t)
	conns, _, _, _ := stores(t)
	user := testutil.NewUser(t, pool)
	conn := newConn(t, conns, user, "gemini")

	got, err := conns.GetConnection(context.Background(), user, conn.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Secret != "" {
		t.Fatal("GetConnection returned a decrypted secret")
	}
	if !got.HasSecret {
		t.Fatal("HasSecret should still be true — the UI needs to know a key exists")
	}

	list, err := conns.ListConnections(context.Background(), user)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, c := range list {
		if c.Secret != "" {
			t.Fatalf("ListConnections returned a decrypted secret for %s", c.Name)
		}
	}
}

// Cross-user isolation, at the store layer, for every read and write.
func TestConnectionsAreInvisibleToOtherUsers(t *testing.T) {
	pool := testutil.TestDB(t)
	conns, _, _, _ := stores(t)
	alice := testutil.NewUser(t, pool)
	mallory := testutil.NewUser(t, pool)
	conn := newConn(t, conns, alice, "alice-gemini")

	ctx := context.Background()

	if _, err := conns.GetConnection(ctx, mallory, conn.ID); !errors.Is(err, store.ErrConnectionNotFound) {
		t.Errorf("GetConnection across users = %v, want ErrConnectionNotFound", err)
	}
	if _, err := conns.GetConnectionWithSecret(ctx, mallory, conn.ID); !errors.Is(err, store.ErrConnectionNotFound) {
		t.Errorf("GetConnectionWithSecret across users = %v, want ErrConnectionNotFound", err)
	}
	newName := "stolen"
	if _, err := conns.UpdateConnection(ctx, mallory, conn.ID, store.ConnectionUpdate{Name: &newName}); !errors.Is(err, store.ErrConnectionNotFound) {
		t.Errorf("UpdateConnection across users = %v, want ErrConnectionNotFound", err)
	}
	if err := conns.DeleteConnection(ctx, mallory, conn.ID); !errors.Is(err, store.ErrConnectionNotFound) {
		t.Errorf("DeleteConnection across users = %v, want ErrConnectionNotFound", err)
	}
	if err := conns.MergeConnectionSettings(ctx, mallory, conn.ID, json.RawMessage(`{"backoff_level":9}`)); !errors.Is(err, store.ErrConnectionNotFound) {
		t.Errorf("MergeConnectionSettings across users = %v, want ErrConnectionNotFound", err)
	}
	if err := conns.SetVerifyResult(ctx, mallory, conn.ID, nil, "tampered"); !errors.Is(err, store.ErrConnectionNotFound) {
		t.Errorf("SetVerifyResult across users = %v, want ErrConnectionNotFound", err)
	}

	// And nothing of Alice's changed.
	after, err := conns.GetConnection(ctx, alice, conn.ID)
	if err != nil {
		t.Fatalf("alice can no longer read her own connection: %v", err)
	}
	if after.Name != "alice-gemini" || after.LastError != "" || after.Settings.BackoffLevel != 0 {
		t.Fatalf("a cross-user write landed anyway: %+v", after)
	}
}

// The composite foreign key is what makes "a route may only point at your own
// connection" a database guarantee rather than a rule every handler remembers.
func TestRouteCannotPointAtAnotherUsersConnection(t *testing.T) {
	pool := testutil.TestDB(t)
	conns, routes, _, _ := stores(t)
	alice := testutil.NewUser(t, pool)
	mallory := testutil.NewUser(t, pool)
	aliceConn := newConn(t, conns, alice, "alice-gemini")

	err := routes.ReplaceRoute(context.Background(), mallory, "chat",
		[]store.RouteEntryInput{{ConnectionID: aliceConn.ID, Model: "gemini-2.5-flash"}})
	if !errors.Is(err, store.ErrConnectionNotFound) {
		t.Fatalf("a route to another user's connection was accepted: %v", err)
	}
}

// Replacing a chain must be atomic and must be able to reorder entries, which a
// naive per-entry update cannot do without transiently violating the
// (user, function, position) unique index.
func TestReplaceRouteReordersWithoutCollision(t *testing.T) {
	pool := testutil.TestDB(t)
	conns, routes, _, _ := stores(t)
	user := testutil.NewUser(t, pool)
	a := newConn(t, conns, user, "a")
	b := newConn(t, conns, user, "b")
	ctx := context.Background()

	if err := routes.ReplaceRoute(ctx, user, "chat", []store.RouteEntryInput{
		{ConnectionID: a.ID, Model: "m1"}, {ConnectionID: b.ID, Model: "m2"},
	}); err != nil {
		t.Fatalf("first write: %v", err)
	}
	// The swap.
	if err := routes.ReplaceRoute(ctx, user, "chat", []store.RouteEntryInput{
		{ConnectionID: b.ID, Model: "m2"}, {ConnectionID: a.ID, Model: "m1"},
	}); err != nil {
		t.Fatalf("reorder: %v", err)
	}

	chain, err := routes.ChainFor(ctx, user, "chat")
	if err != nil {
		t.Fatalf("chain: %v", err)
	}
	if len(chain) != 2 || chain[0].Connection.ID != b.ID || chain[1].Connection.ID != a.ID {
		t.Fatalf("chain is not in the new order: %+v", chain)
	}
	// ChainFor is the one read that decrypts, because the chain has to call the
	// provider with the key.
	if chain[0].Connection.Secret == "" {
		t.Fatal("ChainFor did not decrypt the secret it exists to supply")
	}
}

func TestChainForIsScopedToTheUser(t *testing.T) {
	pool := testutil.TestDB(t)
	conns, routes, _, _ := stores(t)
	alice := testutil.NewUser(t, pool)
	mallory := testutil.NewUser(t, pool)
	conn := newConn(t, conns, alice, "alice-gemini")
	ctx := context.Background()

	if err := routes.ReplaceRoute(ctx, alice, "chat",
		[]store.RouteEntryInput{{ConnectionID: conn.ID, Model: "m"}}); err != nil {
		t.Fatalf("setup: %v", err)
	}
	chain, err := routes.ChainFor(ctx, mallory, "chat")
	if err != nil {
		t.Fatalf("chain: %v", err)
	}
	if len(chain) != 0 {
		t.Fatalf("another user's chain leaked %d entries", len(chain))
	}
	if list, err := routes.ListRoutes(ctx, mallory); err != nil || len(list) != 0 {
		t.Fatalf("ListRoutes across users returned %v (err %v)", list, err)
	}
}

// The merge is shallow (`settings || patch`) so two writers touching different
// keys do not erase each other. A read-modify-write of the whole object would.
func TestMergeConnectionSettingsDoesNotEraseOtherKeys(t *testing.T) {
	pool := testutil.TestDB(t)
	conns, _, _, _ := stores(t)
	user := testutil.NewUser(t, pool)
	conn := newConn(t, conns, user, "gemini")
	ctx := context.Background()

	if err := conns.MergeConnectionSettings(ctx, user, conn.ID, json.RawMessage(`{"verify_status":"verified","dims":3072}`)); err != nil {
		t.Fatalf("first merge: %v", err)
	}
	until := time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)
	if err := conns.MergeConnectionSettings(ctx, user, conn.ID,
		json.RawMessage(`{"cooldown_until":"`+until+`","backoff_level":3}`)); err != nil {
		t.Fatalf("second merge: %v", err)
	}

	got, err := conns.GetConnection(ctx, user, conn.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Settings.VerifyStatus != store.VerifyStatusVerified {
		t.Error("the second merge erased verify_status")
	}
	if got.Settings.Dims != 3072 {
		t.Error("the second merge erased dims")
	}
	if got.Settings.BackoffLevel != 3 || got.Settings.CooldownUntil == nil {
		t.Error("the second merge did not land")
	}
}

// Replacing the key must invalidate what the old key proved. A connection that
// stays green after its key changes is a green light for an untested credential.
func TestReplacingTheKeyClearsVerification(t *testing.T) {
	pool := testutil.TestDB(t)
	conns, _, _, _ := stores(t)
	user := testutil.NewUser(t, pool)
	conn := newConn(t, conns, user, "gemini")
	ctx := context.Background()

	now := time.Now()
	if err := conns.SetVerifyResult(ctx, user, conn.ID, &now, ""); err != nil {
		t.Fatalf("verify: %v", err)
	}
	if err := conns.MergeConnectionSettings(ctx, user, conn.ID,
		json.RawMessage(`{"verify_status":"verified","verified_model":"gemini-2.5-flash"}`)); err != nil {
		t.Fatalf("merge: %v", err)
	}

	newSecret := "sk-a-completely-different-key"
	updated, err := conns.UpdateConnection(ctx, user, conn.ID, store.ConnectionUpdate{Secret: &newSecret})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.VerifiedAt != nil {
		t.Error("verified_at survived a key change")
	}
	if updated.Settings.VerifyStatus != "" || updated.Settings.VerifiedModel != "" {
		t.Errorf("verify settings survived a key change: %+v", updated.Settings)
	}

	// A rename must NOT clear it — only a key change does.
	if err := conns.SetVerifyResult(ctx, user, conn.ID, &now, ""); err != nil {
		t.Fatalf("re-verify: %v", err)
	}
	name := "renamed"
	renamed, err := conns.UpdateConnection(ctx, user, conn.ID, store.ConnectionUpdate{Name: &name})
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if renamed.VerifiedAt == nil {
		t.Error("a rename cleared the verification")
	}
}

func TestSearchConnectionsAreScopedAndEncrypted(t *testing.T) {
	pool := testutil.TestDB(t)
	_, _, searchStore, _ := stores(t)
	alice := testutil.NewUser(t, pool)
	mallory := testutil.NewUser(t, pool)
	ctx := context.Background()

	const secret = "tvly-secret-value"
	row, err := searchStore.UpsertSearchConnection(ctx, alice, "tavily", secret)
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}

	var raw string
	if err := pool.QueryRow(ctx, `SELECT secret_enc FROM search_connections WHERE id = $1`, row.ID).Scan(&raw); err != nil {
		t.Fatalf("raw read: %v", err)
	}
	if strings.Contains(raw, secret) {
		t.Fatal("the plaintext search key is in the column")
	}

	if list, err := searchStore.ListSearchConnections(ctx, mallory); err != nil || len(list) != 0 {
		t.Fatalf("another user saw %d search keys (err %v)", len(list), err)
	}
	if chain, err := searchStore.SearchChain(ctx, mallory); err != nil || len(chain) != 0 {
		t.Fatalf("another user's SearchChain returned %d entries (err %v)", len(chain), err)
	}
	if err := searchStore.DeleteSearchConnection(ctx, mallory, row.ID); !errors.Is(err, store.ErrSearchConnectionNotFound) {
		t.Fatalf("cross-user delete = %v, want ErrSearchConnectionNotFound", err)
	}

	// One key per provider: a second upsert replaces rather than accumulates.
	if _, err := searchStore.UpsertSearchConnection(ctx, alice, "tavily", "tvly-second"); err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	list, err := searchStore.ListSearchConnections(ctx, alice)
	if err != nil || len(list) != 1 {
		t.Fatalf("expected exactly one tavily key, got %d (err %v)", len(list), err)
	}
}

func TestOAuthCredentialsAreScopedAndEncrypted(t *testing.T) {
	pool := testutil.TestDB(t)
	conns, _, _, creds := stores(t)
	alice := testutil.NewUser(t, pool)
	mallory := testutil.NewUser(t, pool)
	ctx := context.Background()

	conn, err := conns.CreateConnection(ctx, alice, store.NewProviderConnection{
		Provider: "chatgpt_relay", Kind: store.KindOAuthRelay, Name: "chatgpt",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	expires := time.Now().Add(time.Hour)
	const refresh = "rt-cloud-platform-grade-credential"
	if err := creds.SaveOAuthCredential(ctx, alice, conn.ID, "at-value", refresh, &expires); err != nil {
		t.Fatalf("save: %v", err)
	}

	var rawAccess, rawRefresh string
	if err := pool.QueryRow(ctx,
		`SELECT access_enc, refresh_enc FROM oauth_credentials WHERE connection_id = $1`, conn.ID).
		Scan(&rawAccess, &rawRefresh); err != nil {
		t.Fatalf("raw read: %v", err)
	}
	if strings.Contains(rawAccess, "at-value") || strings.Contains(rawRefresh, refresh) {
		t.Fatal("an OAuth token is stored in plaintext")
	}

	if _, err := creds.GetOAuthCredential(ctx, mallory, conn.ID); err == nil {
		t.Fatal("another user read the token pair")
	}

	// An empty refresh on a later save means "the provider did not mint a new
	// one" and must keep the live credential rather than blanking it.
	if err := creds.SaveOAuthCredential(ctx, alice, conn.ID, "at-rotated", "", &expires); err != nil {
		t.Fatalf("rotate: %v", err)
	}
	got, err := creds.GetOAuthCredential(ctx, alice, conn.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.AccessToken != "at-rotated" {
		t.Error("the access token did not rotate")
	}
	if got.RefreshToken != refresh {
		t.Error("an empty refresh token blanked the stored one")
	}
}

// Deleting a connection must take its routes and tokens with it — a route
// pointing at a deleted connection is a state nothing in the code checks for,
// because the database refuses to hold it.
func TestDeletingAConnectionCascades(t *testing.T) {
	pool := testutil.TestDB(t)
	conns, routes, _, creds := stores(t)
	user := testutil.NewUser(t, pool)
	ctx := context.Background()

	conn, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
		Provider: "chatgpt_relay", Kind: store.KindOAuthRelay, Name: "relay",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := creds.SaveOAuthCredential(ctx, user, conn.ID, "at", "rt", nil); err != nil {
		t.Fatalf("save token: %v", err)
	}
	if err := routes.ReplaceRoute(ctx, user, "chat",
		[]store.RouteEntryInput{{ConnectionID: conn.ID, Model: "m"}}); err != nil {
		t.Fatalf("route: %v", err)
	}

	if err := conns.DeleteConnection(ctx, user, conn.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if list, err := routes.ListRoutes(ctx, user); err != nil || len(list) != 0 {
		t.Fatalf("routes survived the connection: %v (err %v)", list, err)
	}
	if _, err := creds.GetOAuthCredential(ctx, user, conn.ID); err == nil {
		t.Fatal("the token pair survived the connection")
	}
}

// Two connections may not share a name, because the routes editor identifies
// them by it.
func TestDuplicateConnectionNameIsRefused(t *testing.T) {
	pool := testutil.TestDB(t)
	conns, _, _, _ := stores(t)
	user := testutil.NewUser(t, pool)
	other := testutil.NewUser(t, pool)

	newConn(t, conns, user, "my key")
	if _, err := conns.CreateConnection(context.Background(), user, store.NewProviderConnection{
		Provider: "openai", Kind: store.KindAPIKey, Name: "my key", Secret: "k",
	}); !errors.Is(err, store.ErrDuplicateConnectionName) {
		t.Fatalf("duplicate name = %v, want ErrDuplicateConnectionName", err)
	}
	// The uniqueness is per user, not global.
	if _, err := conns.CreateConnection(context.Background(), other, store.NewProviderConnection{
		Provider: "openai", Kind: store.KindAPIKey, Name: "my key", Secret: "k",
	}); err != nil {
		t.Fatalf("another user could not use the same name: %v", err)
	}
}

// Storing a secret with no encryption key configured must FAIL, not silently
// write plaintext. This is the incident encryptOrFail was extracted for.
func TestStoringASecretWithoutAKeyFails(t *testing.T) {
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)
	keyless := pg.NewProviderConnectionStore(pool, "")

	_, err := keyless.CreateConnection(context.Background(), user, store.NewProviderConnection{
		Provider: "openai", Kind: store.KindAPIKey, Name: "keyless", Secret: "sk-plaintext",
	})
	if err == nil {
		t.Fatal("a secret was stored with no encryption key configured")
	}
	if !errors.Is(err, crypto.ErrNoEncryptionKey) {
		t.Fatalf("wrong error: %v", err)
	}
}
