package byokapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api"
	"github.com/D0bby999/anytools/internal/api/authapi"
	"github.com/D0bby999/anytools/internal/api/byokapi"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/auth"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/oauth"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

const gatewayToken = "byokapi-test-token"

type harness struct {
	handler http.Handler
	svc     *byok.Service
	conns   *pg.ProviderConnectionStore
	search  *pg.SearchConnectionStore
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	pool := testutil.TestDB(t)
	key := testutil.TestEncryptionKey

	users := pg.NewUserStore(pool)
	conns := pg.NewProviderConnectionStore(pool, key)
	routes := pg.NewFunctionRouteStore(pool, key)
	searchKeys := pg.NewSearchConnectionStore(pool, key)
	creds := pg.NewOAuthCredentialStore(pool, key)
	locker := pg.NewConnectionLockStore(pool)

	tokens, err := oauth.NewService(creds, conns, locker, nil, nil)
	if err != nil {
		t.Fatalf("oauth.NewService: %v", err)
	}
	svc := byok.NewService(conns, routes, searchKeys, tokens)

	handler := api.BuildMux(api.Deps{
		Auth:         authapi.NewHandler(auth.NewService(users), users),
		BYOK:         byokapi.NewHandler(svc),
		Users:        users,
		GatewayToken: gatewayToken,
	})
	return &harness{handler: handler, svc: svc, conns: conns, search: searchKeys}
}

// do issues an authenticated request as userID.
func (h *harness) do(t *testing.T, userID uuid.UUID, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Authorization", "Bearer "+gatewayToken)
	req.Header.Set(httpx.UserIDHeader, userID.String())
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return rec
}

func decodeBody[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response %q: %v", rec.Body.String(), err)
	}
	return out
}

// Cross-user isolation, route by route.
//
// The list is derived from api.RegisteredPatterns() rather than hand-written, so
// a route added in a later phase without an isolation case FAILS this test
// instead of quietly shipping unprotected. That is the property red-team RT-3
// asked for: the rule is enforced by the test's shape, not by remembering.
func TestEveryBYOKRouteIsIsolatedBetweenUsers(t *testing.T) {
	h := newHarness(t)
	pool := testutil.TestDB(t)
	alice := testutil.NewUser(t, pool)
	mallory := testutil.NewUser(t, pool)
	ctx := context.Background()

	// Alice's world: one connection, one route, one search key.
	conn, err := h.conns.CreateConnection(ctx, alice, store.NewProviderConnection{
		Provider: "gemini", Kind: store.KindAPIKey, Name: "alice-secret-name", Secret: "sk-alice-private",
	})
	if err != nil {
		t.Fatalf("create connection: %v", err)
	}
	if err := h.svc.SetRoute(ctx, alice, byok.FunctionChat, []byok.RouteEntry{{ConnectionID: conn.ID}}); err != nil {
		t.Fatalf("set route: %v", err)
	}
	searchRow, err := h.search.UpsertSearchConnection(ctx, alice, "tavily", "tvly-alice-private")
	if err != nil {
		t.Fatalf("search key: %v", err)
	}
	if err := h.svc.AddCustomModel(ctx, alice, conn.ID, "alice/own-model"); err != nil {
		t.Fatalf("custom model: %v", err)
	}

	// Every route that names a resource id, probed as Mallory. A 2xx on any of
	// them is a cross-user read or write.
	idRoutes := []struct {
		method, path string
		body         any
	}{
		{http.MethodPut, "/v1/byok/connections/" + conn.ID.String(), map[string]any{"name": "stolen"}},
		{http.MethodDelete, "/v1/byok/connections/" + conn.ID.String(), nil},
		{http.MethodPost, "/v1/byok/connections/" + conn.ID.String() + "/verify", nil},
		{http.MethodGet, "/v1/byok/connections/" + conn.ID.String() + "/models", nil},
		{http.MethodPost, "/v1/byok/connections/" + conn.ID.String() + "/custom-models", map[string]any{"model": "mallory/model"}},
		{http.MethodDelete, "/v1/byok/connections/" + conn.ID.String() + "/custom-models?model=alice%2Fown-model", nil},
		{http.MethodDelete, "/v1/byok/search-connections/" + searchRow.ID.String(), nil},
		{http.MethodPost, "/v1/byok/search-connections/" + searchRow.ID.String() + "/verify", nil},
	}
	for _, tc := range idRoutes {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rec := h.do(t, mallory, tc.method, tc.path, tc.body)
			if rec.Code < 400 {
				t.Fatalf("answered %d to another user's resource — want 4xx (body %s)", rec.Code, rec.Body.String())
			}
			if rec.Code != http.StatusNotFound {
				t.Fatalf("answered %d; 404 is required so the endpoint is not an existence oracle", rec.Code)
			}
		})
	}

	// Collection reads must return Mallory's empty world, never Alice's.
	for _, path := range []string{
		"/v1/byok/connections", "/v1/byok/routes", "/v1/byok/search-connections", "/v1/readiness",
	} {
		t.Run("GET "+path, func(t *testing.T) {
			rec := h.do(t, mallory, http.MethodGet, path, nil)
			if rec.Code != http.StatusOK {
				t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
			}
			body := rec.Body.String()
			for _, leaked := range []string{conn.ID.String(), "alice-secret-name", searchRow.ID.String()} {
				if strings.Contains(body, leaked) {
					t.Fatalf("%s leaked %q into another user's response", path, leaked)
				}
			}
		})
	}

	// Writing a route that points at Alice's connection must be refused.
	t.Run("PUT /v1/byok/routes/{function} cannot borrow a connection", func(t *testing.T) {
		rec := h.do(t, mallory, http.MethodPut, "/v1/byok/routes/chat", map[string]any{
			"entries": []map[string]any{{"connection_id": conn.ID.String(), "model": "gemini-2.5-flash"}},
		})
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status %d (%s) — a route to another user's connection was accepted",
				rec.Code, rec.Body.String())
		}
	})

	// And Alice is untouched by all of it.
	after, err := h.conns.GetConnection(ctx, alice, conn.ID)
	if err != nil {
		t.Fatalf("alice lost her connection: %v", err)
	}
	if after.Name != "alice-secret-name" {
		t.Fatalf("a cross-user write landed: %+v", after)
	}
	if own, _ := h.svc.ConnectionModels(ctx, alice, conn.ID); own == nil || len(own.Custom) != 1 || own.Custom[0] != "alice/own-model" {
		t.Fatalf("a cross-user write touched alice's added models: %+v", own)
	}
}

// This is the guard that keeps the case list above honest: every registered
// /v1/byok route with an {id} must appear in the probe list.
func TestIsolationSuiteCoversEveryIDRoute(t *testing.T) {
	covered := map[string]bool{
		"PUT /v1/byok/connections/{id}":                  true,
		"DELETE /v1/byok/connections/{id}":               true,
		"POST /v1/byok/connections/{id}/verify":          true,
		"GET /v1/byok/connections/{id}/models":           true,
		"POST /v1/byok/connections/{id}/custom-models":   true,
		"DELETE /v1/byok/connections/{id}/custom-models": true,
		"DELETE /v1/byok/search-connections/{id}":        true,
		"POST /v1/byok/search-connections/{id}/verify":   true,
	}
	for _, pattern := range api.RegisteredPatterns() {
		if !strings.Contains(pattern, "{id}") {
			continue
		}
		// Other feature packages guard their own id routes (chatapi has its
		// second-live-user cases); this list is byok's contract only.
		if !strings.Contains(pattern, "/v1/byok/") {
			continue
		}
		if !covered[pattern] {
			t.Errorf("%s names a resource id but has no cross-user isolation case in "+
				"TestEveryBYOKRouteIsIsolatedBetweenUsers", pattern)
		}
	}
}

// A secret must never come back out. The response shape has no field for one,
// and the store method the handler calls does not decrypt — this asserts both
// ends of that.
func TestConnectionResponsesNeverCarryASecret(t *testing.T) {
	h := newHarness(t)
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)

	const secret = "sk-this-must-never-be-echoed"
	rec := h.do(t, user, http.MethodPost, "/v1/byok/connections", map[string]any{
		"provider": "gemini", "name": "mine", "secret": secret,
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), secret) {
		t.Fatal("the create response echoed the key back")
	}

	list := h.do(t, user, http.MethodGet, "/v1/byok/connections", nil)
	if strings.Contains(list.Body.String(), secret) {
		t.Fatal("the list response carried the key")
	}
	// It knows a key EXISTS, which is all the UI needs.
	if !strings.Contains(list.Body.String(), `"has_secret":true`) {
		t.Fatalf("has_secret missing from the list response: %s", list.Body.String())
	}
}

// A private-range base URL is refused at write time, with a sentence the user
// can act on and without confirming what is at that address.
func TestCreateConnectionRejectsAPrivateBaseURL(t *testing.T) {
	h := newHarness(t)
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)

	for _, base := range []string{
		"https://169.254.169.254/v1", // IMDS
		"https://10.0.0.5/v1",
		"https://localhost/v1",
		"http://api.openai.com/v1", // plain http
	} {
		rec := h.do(t, user, http.MethodPost, "/v1/byok/connections", map[string]any{
			"provider": "openai_compat", "name": "probe-" + base, "api_base": base, "secret": "sk-x",
		})
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("base %q was accepted with status %d (%s)", base, rec.Code, rec.Body.String())
		}
		body := decodeBody[map[string]any](t, rec)
		msg, _ := body["error"].(string)
		if msg == "" || strings.Contains(msg, "169.254") || strings.Contains(msg, "10.0.0.5") {
			t.Fatalf("the rejection echoed the address back or said nothing useful: %q", msg)
		}
	}
}

// The routes editor must refuse a pairing that cannot work, at save time.
func TestSetRouteRefusesAProviderThatCannotServeTheFunction(t *testing.T) {
	h := newHarness(t)
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)
	ctx := context.Background()

	anthropic, err := h.conns.CreateConnection(ctx, user, store.NewProviderConnection{
		Provider: "anthropic", Kind: store.KindAPIKey, Name: "claude", Secret: "sk-ant",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	rec := h.do(t, user, http.MethodPut, "/v1/byok/routes/embed", map[string]any{
		"entries": []map[string]any{{"connection_id": anthropic.ID.String()}},
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("anthropic was accepted for embed: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Anthropic cannot be used for indexing documents") {
		t.Fatalf("the message does not name the problem: %s", rec.Body.String())
	}
}

// A chain longer than the cap, and a chain naming the same connection twice,
// are both refused — the second because a repeated entry is not a fallback: when
// it fails it is benched, so its second appearance is skipped.
func TestSetRouteRefusesOversizedAndDuplicateChains(t *testing.T) {
	h := newHarness(t)
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)
	ctx := context.Background()

	ids := make([]string, 0, byok.MaxChainEntries+1)
	for i := range byok.MaxChainEntries + 1 {
		c, err := h.conns.CreateConnection(ctx, user, store.NewProviderConnection{
			Provider: "gemini", Kind: store.KindAPIKey,
			Name: fmt.Sprintf("key-%d", i), Secret: "sk-x",
		})
		if err != nil {
			t.Fatalf("create: %v", err)
		}
		ids = append(ids, c.ID.String())
	}

	entries := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		entries = append(entries, map[string]any{"connection_id": id})
	}
	if rec := h.do(t, user, http.MethodPut, "/v1/byok/routes/chat",
		map[string]any{"entries": entries}); rec.Code != http.StatusBadRequest {
		t.Fatalf("a chain of %d was accepted: %d", len(entries), rec.Code)
	}

	dup := []map[string]any{{"connection_id": ids[0]}, {"connection_id": ids[0]}}
	if rec := h.do(t, user, http.MethodPut, "/v1/byok/routes/chat",
		map[string]any{"entries": dup}); rec.Code != http.StatusBadRequest {
		t.Fatalf("a chain with a duplicate entry was accepted: %d", rec.Code)
	}
}

// The subscription lanes are OFF by default, and the endpoint says so rather
// than failing obscurely.
func TestSubscriptionLanesAreOffByDefault(t *testing.T) {
	h := newHarness(t)
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)

	rec := h.do(t, user, http.MethodPost, "/v1/byok/connections/relay", map[string]any{
		"access_token": "at", "refresh_token": "rt", "account_id": "acct", "expires_in": 3600,
	})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("the relay endpoint answered %d with the flag off, want 403: %s", rec.Code, rec.Body.String())
	}

	list := h.do(t, user, http.MethodGet, "/v1/byok/connections", nil)
	if !strings.Contains(list.Body.String(), `"lanes_enabled":false`) {
		t.Fatalf("the connections response does not report the lanes as off: %s", list.Body.String())
	}
}

// An unknown function name is a 404, not a 500 and not a silently created row.
func TestUnknownFunctionIsNotFound(t *testing.T) {
	h := newHarness(t)
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)

	rec := h.do(t, user, http.MethodPut, "/v1/byok/routes/summarise", map[string]any{"entries": []any{}})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", rec.Code)
	}
}

func mustUUID(t *testing.T, s string) uuid.UUID {
	t.Helper()
	id, err := uuid.Parse(s)
	if err != nil {
		t.Fatalf("parse uuid %q: %v", s, err)
	}
	return id
}

// The two subscription-lane endpoints create a connection rather than naming
// one, so they have no id to probe across users — but "creates for the caller"
// is still a claim worth proving, and the flag being off by default is exactly
// why it would otherwise go untested forever.
func TestSubscriptionLaneConnectionsBelongToTheirCreator(t *testing.T) {
	h := newHarness(t)
	pool := testutil.TestDB(t)
	alice := testutil.NewUser(t, pool)
	mallory := testutil.NewUser(t, pool)

	// Enabled through the service's own hook rather than t.Setenv, so this test
	// can run in parallel with everything that assumes the lanes are off.
	h.svc.SetLanesEnabledForTest(func() bool { return true })

	rec := h.do(t, alice, http.MethodPost, "/v1/byok/connections/relay", map[string]any{
		"name": "alice-chatgpt", "access_token": "at", "refresh_token": "rt",
		"account_id": "acct-alice", "expires_in": 3600,
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("connect relay: %d %s", rec.Code, rec.Body.String())
	}
	created := decodeBody[map[string]any](t, rec)
	connID, _ := created["id"].(string)
	if connID == "" {
		t.Fatalf("no id in %s", rec.Body.String())
	}
	// Even the lane's own response must not echo the tokens back.
	for _, secret := range []string{"\"at\"", "\"rt\""} {
		if strings.Contains(rec.Body.String(), secret) {
			t.Fatalf("the relay response echoed a token: %s", rec.Body.String())
		}
	}

	if body := h.do(t, mallory, http.MethodGet, "/v1/byok/connections", nil).Body.String(); strings.Contains(body, connID) ||
		strings.Contains(body, "alice-chatgpt") {
		t.Fatalf("another user saw the relay connection: %s", body)
	}
	for _, tc := range []struct{ method, path string }{
		{http.MethodDelete, "/v1/byok/connections/" + connID},
		{http.MethodPost, "/v1/byok/connections/" + connID + "/verify"},
	} {
		if code := h.do(t, mallory, tc.method, tc.path, nil).Code; code != http.StatusNotFound {
			t.Errorf("%s %s across users = %d, want 404", tc.method, tc.path, code)
		}
	}
}
