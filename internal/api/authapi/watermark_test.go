package authapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/authapi"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/auth"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Security audit F-4: signing out moves the account's watermark, which the
// BFF compares every cookie's mint time against — so a copied cookie stops
// working with the one the user closed. Only the caller's own watermark moves.
func TestSigningOutMovesOnlyTheCallersWatermark(t *testing.T) {
	pool := testutil.TestDB(t)
	users := pg.NewUserStore(pool)
	mux := http.NewServeMux()
	authapi.NewHandler(auth.NewService(users), users).WithSessionRevocation(users).RegisterRoutes(mux)
	alice, bob := testutil.NewUser(t, pool), testutil.NewUser(t, pool)

	call := func(method string, user uuid.UUID) map[string]any {
		t.Helper()
		req := httptest.NewRequest(method, "/v1/auth/session-watermark", nil)
		req = req.WithContext(httpx.WithUserID(req.Context(), user))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", method, rec.Code, rec.Body.String())
		}
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}

	if got := call(http.MethodGet, alice)["sessions_valid_after"]; got != nil {
		t.Fatalf("a fresh account already has a watermark: %v", got)
	}
	moved := call(http.MethodPost, alice)["sessions_valid_after"]
	if moved == nil || call(http.MethodGet, alice)["sessions_valid_after"] != moved {
		t.Fatalf("the watermark did not move and stay: %v", moved)
	}
	if got := call(http.MethodGet, bob)["sessions_valid_after"]; got != nil {
		t.Fatalf("alice signing out moved bob's watermark: %v", got)
	}
}
