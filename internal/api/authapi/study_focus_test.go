package authapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/authapi"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/auth"
	"github.com/D0bby999/anytools/internal/store"
)

type focusRecorder struct {
	user  uuid.UUID
	focus []string
	calls int
}

func (f *focusRecorder) SetStudyFocus(_ context.Context, id uuid.UUID, focus []string) error {
	f.user, f.focus = id, focus
	f.calls++
	return nil
}

// PUT /v1/me/study-focus (the private design notes, phase 7) stores
// the context user's answers, "[]" for Skip, and refuses anything else.
func TestPutStudyFocus(t *testing.T) {
	me := uuid.New()
	rec := &focusRecorder{}
	mux := http.NewServeMux()
	authapi.NewHandler(auth.NewService(stubStore{}), stubStore{}).WithStudyFocus(rec).RegisterRoutes(mux)
	put := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPut, "/v1/me/study-focus", strings.NewReader(body))
		req = req.WithContext(httpx.WithUserID(req.Context(), me))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		return w
	}
	if w := put(`{"focus":["languages","documents"]}`); w.Code != http.StatusOK || rec.user != me || !slices.Equal(rec.focus, []string{"languages", "documents"}) {
		t.Fatalf("focus: %d %+v", w.Code, rec)
	}
	if w := put(`{"focus":[]}`); w.Code != http.StatusOK || len(rec.focus) != 0 {
		t.Fatalf("skip: %d %+v", w.Code, rec)
	}
	for _, bad := range []string{`{}`, `{"focus":["cooking"]}`, `{"focus":["body","body"]}`, `not json`} {
		if w := put(bad); w.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", bad, w.Code)
		}
	}
	if rec.calls != 2 {
		t.Fatalf("a refused body reached the store: %d calls", rec.calls)
	}

	st := stubStore{get: func(id uuid.UUID) (*store.User, error) {
		return &store.User{ID: id, Email: "a@example.test", Timezone: "UTC", StudyFocus: []string{"languages"}}, nil
	}}
	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	req = req.WithContext(httpx.WithUserID(req.Context(), me))
	w := httptest.NewRecorder()
	newHandler(st).ServeHTTP(w, req)
	var out struct {
		StudyFocus []string `json:"study_focus"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || !slices.Equal(out.StudyFocus, []string{"languages"}) {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}
