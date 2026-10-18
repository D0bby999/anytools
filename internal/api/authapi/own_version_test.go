package authapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/authapi"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/auth"
	"github.com/D0bby999/anytools/internal/store"
)

type ownVersionRecorder struct {
	user  uuid.UUID
	on    bool
	calls int
}

func (o *ownVersionRecorder) SetOwnVersionFirst(_ context.Context, id uuid.UUID, on bool) error {
	o.user, o.on = id, on
	o.calls++
	return nil
}

// PUT /v1/me/own-version-first (up-methods phase 11) stores the switch for
// the context user only, and refuses a body without a boolean.
func TestPutOwnVersionFirst(t *testing.T) {
	me := uuid.New()
	rec := &ownVersionRecorder{}
	mux := http.NewServeMux()
	authapi.NewHandler(auth.NewService(stubStore{}), stubStore{}).WithOwnVersionFirst(rec).RegisterRoutes(mux)
	put := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPut, "/v1/me/own-version-first", strings.NewReader(body))
		req = req.WithContext(httpx.WithUserID(req.Context(), me))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		return w
	}

	if w := put(`{"enabled":true}`); w.Code != http.StatusOK || rec.user != me || !rec.on {
		t.Fatalf("on: %d %+v %s", w.Code, rec, w.Body.String())
	}
	if w := put(`{"enabled":false}`); w.Code != http.StatusOK || rec.on {
		t.Fatalf("off: %d %+v", w.Code, rec)
	}
	for _, bad := range []string{`{}`, `{"enabled":"yes"}`, `not json`} {
		if w := put(bad); w.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", bad, w.Code)
		}
	}
	if rec.calls != 2 {
		t.Fatalf("a refused body reached the store: %d calls", rec.calls)
	}
}

// GET /v1/me reports the switch, which is how the composers know to ask.
func TestGetMeReportsOwnVersionFirst(t *testing.T) {
	me := uuid.New()
	st := stubStore{get: func(id uuid.UUID) (*store.User, error) {
		return &store.User{ID: id, Email: "a@example.test", Timezone: "UTC", OwnVersionFirst: true}, nil
	}}
	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	req = req.WithContext(httpx.WithUserID(req.Context(), me))
	w := httptest.NewRecorder()
	newHandler(st).ServeHTTP(w, req)
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || out["own_version_first"] != true {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}
