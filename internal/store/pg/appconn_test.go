package pg_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/connectors/appconn"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// An app grant is stored encrypted, its rotated tokens replace the old, and
// a reconnect clears the mark.
func TestAppConnStore(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	store := pg.NewAppConnStore(pool, testutil.TestEncryptionKey)
	user := testutil.NewUser(t, pool)

	if _, err := store.Get(ctx, user, "canva"); !errors.Is(err, appconn.ErrNotConnected) {
		t.Fatalf("none: %v", err)
	}
	exp := time.Now().Add(time.Hour)
	if err := store.Save(ctx, appconn.Connection{UserID: user, Provider: "canva", AccessToken: "a1", RefreshToken: "r1", ExpiresAt: &exp, AccountLabel: "Lan"}); err != nil {
		t.Fatal(err)
	}
	var raw string
	_ = pool.QueryRow(ctx, `SELECT access_enc FROM app_connections WHERE user_id = $1`, user).Scan(&raw)
	if raw == "a1" || raw == "" {
		t.Fatal("tokens are encrypted")
	}
	if err := store.SaveTokens(ctx, user, "canva", "a2", "r2", nil); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkNeedsReconnect(ctx, user, "canva", "revoked"); err != nil {
		t.Fatal(err)
	}
	c, err := store.Get(ctx, user, "canva")
	if err != nil || c.AccessToken != "a2" || c.RefreshToken != "r2" || !c.NeedsReconnect || c.AccountLabel != "Lan" {
		t.Fatalf("%+v %v", c, err)
	}
	_ = store.Save(ctx, appconn.Connection{UserID: user, Provider: "canva", AccessToken: "a3"})
	if c, _ := store.Get(ctx, user, "canva"); c.NeedsReconnect {
		t.Fatal("a fresh consent clears the mark")
	}
	if err := store.Delete(ctx, user, "canva"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(ctx, user, "canva"); !errors.Is(err, appconn.ErrNotConnected) {
		t.Fatal("deleted")
	}
}
