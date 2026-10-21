package byokapi_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Plan 261021-1100 phase 4: the catalog, a connection's live models, models
// added by hand, and a verify that needs no model.

func TestCatalogListsTheProviders(t *testing.T) {
	h := newHarness(t)
	user := testutil.NewUser(t, testutil.TestDB(t))
	rec := h.do(t, user, http.MethodGet, "/v1/byok/catalog", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var body struct {
		Providers []byok.CatalogEntry `json:"providers"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Providers) < 45 {
		t.Fatalf("%d providers", len(body.Providers))
	}
	for _, e := range body.Providers {
		if e.Type == "cerebras" && (!e.NeedsModel || e.APIBase != "https://api.cerebras.ai/v1") {
			t.Fatalf("cerebras: %+v", e)
		}
	}
}

// fakeProvider answers /v1/models as an OpenAI-shaped provider does, with
// the given status, and only to the right key.
func fakeProvider(t *testing.T, status int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer sk-own" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, `{"data":[{"id":"zeta-8b"},{"id":"alpha-70b"},{"id":"alpha-70b"}]}`)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func connectCerebras(t *testing.T, h *harness, base string) (store.ProviderConnection, func(method, path string, body any) *httptest.ResponseRecorder) {
	t.Helper()
	user := testutil.NewUser(t, testutil.TestDB(t))
	conn, err := h.svc.CreateConnection(context.Background(), user, byok.NewConnection{
		Provider: "cerebras", Name: "Cerebras", APIBase: base, Secret: "sk-own",
	})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	return *conn, func(method, path string, body any) *httptest.ResponseRecorder {
		return h.do(t, user, method, path, body)
	}
}

func TestAConnectionListsItsModelsAndKeepsAddedOnes(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	h := newHarness(t)
	conn, do := connectCerebras(t, h, fakeProvider(t, http.StatusOK).URL+"/v1")
	models := "/v1/byok/connections/" + conn.ID.String() + "/models"
	custom := "/v1/byok/connections/" + conn.ID.String() + "/custom-models"

	read := func() byok.ModelList {
		t.Helper()
		rec := do(http.MethodGet, models, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("models: %d %s", rec.Code, rec.Body.String())
		}
		var out byok.ModelList
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}
	if got := read(); strings.Join(got.Listed, ",") != "alpha-70b,zeta-8b" || len(got.Custom) != 0 || got.ListError != "" {
		t.Fatalf("listed: %+v", got)
	}

	if rec := do(http.MethodPost, custom, map[string]any{"model": "  org/fine-tune-1 "}); rec.Code != http.StatusNoContent {
		t.Fatalf("add: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(http.MethodPost, custom, map[string]any{"model": "org/fine-tune-1"}); rec.Code != http.StatusNoContent {
		t.Fatalf("adding twice: %d", rec.Code)
	}
	for _, bad := range []string{"", "two words", strings.Repeat("x", 201)} {
		if rec := do(http.MethodPost, custom, map[string]any{"model": bad}); rec.Code != http.StatusBadRequest {
			t.Fatalf("%q: %d", bad, rec.Code)
		}
	}
	if got := read(); strings.Join(got.Custom, ",") != "org/fine-tune-1" {
		t.Fatalf("custom: %+v", got)
	}
	if rec := do(http.MethodDelete, custom+"?model=org%2Ffine-tune-1", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	if rec := do(http.MethodDelete, custom+"?model=org%2Ffine-tune-1", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("delete again: %d", rec.Code)
	}
}

// With no model routed and none by default, Verify proves the key by reading
// the model list, and says what went wrong in a sentence when it cannot.
func TestVerifyWithoutAModelReadsTheList(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	h := newHarness(t)
	for _, tc := range []struct {
		name, base, wantMessage string
		ok                      bool
	}{
		{"a good key", fakeProvider(t, http.StatusOK).URL + "/v1", "", true},
		{"a refused key", fakeProvider(t, http.StatusUnauthorized).URL + "/v1", "The provider rejected this key.", false},
		{"no list", fakeProvider(t, http.StatusNotFound).URL + "/v1", "publishes no model list", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			conn, do := connectCerebras(t, h, tc.base)
			rec := do(http.MethodPost, "/v1/byok/connections/"+conn.ID.String()+"/verify", nil)
			if rec.Code != http.StatusOK {
				t.Fatalf("verify: %d %s", rec.Code, rec.Body.String())
			}
			var got struct {
				OK      bool   `json:"ok"`
				Message string `json:"message"`
			}
			_ = json.Unmarshal(rec.Body.Bytes(), &got)
			if got.OK != tc.ok || !strings.Contains(got.Message, tc.wantMessage) {
				t.Fatalf("got %+v", got)
			}
			if strings.Contains(got.Message, "data") || strings.Contains(got.Message, "sk-own") {
				t.Fatalf("a provider body reached the message: %q", got.Message)
			}
		})
	}
}
