package byok_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/connectors/zotero/zoterotest"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Up-methods phase 20: a Zotero key and its library's user id are the
// learner's own, stored encrypted as one search key, verified with one call
// to /keys/{key}, and never echoed.
func TestAZoteroKeyIsStoredVerifiedAndNeverEchoed(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()
	user := testutil.NewUser(t, testutil.TestDB(t))
	srv := zoterotest.New(t)
	svc.UseZoteroClient(srv.Client())

	if _, ok, err := svc.ZoteroCredential(ctx, user); err != nil || ok {
		t.Fatalf("no key yet: %v %v", ok, err)
	}
	// A key without its user id, or a user id that is not a number.
	for _, bad := range []string{zoterotest.Key, "learner:" + zoterotest.Key} {
		if _, err := svc.SaveSearchConnection(ctx, user, byok.ProviderZotero, bad); !errors.Is(err, byok.ErrInvalidInput) {
			t.Fatalf("saved %q: %v", bad, err)
		}
	}
	if _, err := byok.ZoteroSecret("475425", "short"); !errors.Is(err, byok.ErrInvalidInput) {
		t.Fatalf("a short key: %v", err)
	}

	const wrong = "WRONGKEY0SECRET000000000"
	secret, err := byok.ZoteroSecret(" "+zoterotest.UserID+" ", wrong)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := svc.SaveSearchConnection(ctx, user, byok.ProviderZotero, secret)
	if err != nil {
		t.Fatal(err)
	}
	res, err := svc.VerifySearchConnection(ctx, user, conn.ID)
	if err != nil || res.OK || res.Message == "" {
		t.Fatalf("an unknown key verified: %+v %v", res, err)
	}
	if strings.Contains(res.Message, "SECRET") || strings.Contains(res.Message, "keys/") {
		t.Fatalf("verify message %q", res.Message)
	}
	rows, _ := svc.ListSearchConnections(ctx, user)
	for _, r := range rows {
		if strings.Contains(r.LastError, "SECRET") {
			t.Fatalf("stored last error carries the key: %q", r.LastError)
		}
	}

	good, _ := byok.ZoteroSecret(zoterotest.UserID, zoterotest.Key)
	if _, err := svc.SaveSearchConnection(ctx, user, byok.ProviderZotero, good); err != nil {
		t.Fatal(err)
	}
	cred, ok, err := svc.ZoteroCredential(ctx, user)
	if err != nil || !ok || cred != zoterotest.Credential() {
		t.Fatalf("credential read back: %v %v", ok, err)
	}
	if res, err := svc.VerifySearchConnection(ctx, user, conn.ID); err != nil || !res.OK {
		t.Fatalf("a good key: %+v %v", res, err)
	}
	// Stored encrypted: the key is nowhere in the row as written.
	var raw string
	if err := testutil.TestDB(t).QueryRow(ctx,
		`SELECT secret_enc FROM search_connections WHERE id = $1`, conn.ID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(raw, zoterotest.Key) || strings.Contains(raw, zoterotest.UserID) {
		t.Fatal("the Zotero secret is stored in clear")
	}
	// Not a web-search key.
	if chain, err := svc.SearchFor(ctx, user); err == nil && chain != nil && chain.Len() > 0 {
		t.Fatalf("the Zotero key joined the web-search chain")
	}
}
