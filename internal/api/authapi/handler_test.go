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

type stubStore struct {
	upsert func(store.IdentityClaims, uuid.UUID) (*store.User, error)
	get    func(uuid.UUID) (*store.User, error)
}

func (s stubStore) UpsertIdentity(_ context.Context, c store.IdentityClaims, linkTo uuid.UUID) (*store.User, error) {
	return s.upsert(c, linkTo)
}
func (s stubStore) GetUser(_ context.Context, id uuid.UUID) (*store.User, error) { return s.get(id) }
func (s stubStore) UserExists(context.Context, uuid.UUID) (bool, error)          { return true, nil }

func newHandler(st store.UserStore) http.Handler {
	mux := http.NewServeMux()
	authapi.NewHandler(auth.NewService(st), st).RegisterRoutes(mux)
	return mux
}

func postIdentity(t *testing.T, h http.Handler, body string, ctxUser uuid.UUID) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/identity", strings.NewReader(body))
	if ctxUser != uuid.Nil {
		req = req.WithContext(httpx.WithUserID(req.Context(), ctxUser))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decodeCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body httpx.ErrorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body %q: %v", rec.Body.String(), err)
	}
	return body.Code
}

func TestPostIdentityCreatesUser(t *testing.T) {
	want := &store.User{ID: uuid.New(), Email: "chau@example.test", DisplayName: "Chau"}
	h := newHandler(stubStore{
		upsert: func(c store.IdentityClaims, linkTo uuid.UUID) (*store.User, error) {
			if linkTo != uuid.Nil {
				t.Fatalf("linkTo = %s, want nil for a signed-out sign in", linkTo)
			}
			return want, nil
		},
	})

	rec := postIdentity(t, h, `{"provider":"google","subject":"sub-1","email":"chau@example.test","email_verified":true,"display_name":"Chau"}`, uuid.Nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}

	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["id"] != want.ID.String() {
		t.Fatalf("id = %v, want %s", got["id"], want.ID)
	}
}

// Linking must be impossible unless the middleware already proved the caller
// owns the target account. A body-only user id would let anything reaching this
// endpoint graft an identity onto any account.
func TestPostIdentityRefusesLinkToUnprovenUser(t *testing.T) {
	h := newHandler(stubStore{
		upsert: func(store.IdentityClaims, uuid.UUID) (*store.User, error) {
			t.Fatal("store must not be reached when the link target is unproven")
			return nil, nil
		},
	})
	victim := uuid.New()

	t.Run("no session at all", func(t *testing.T) {
		rec := postIdentity(t, h,
			`{"provider":"github","subject":"s","email":"a@b.test","email_verified":true,"link_to_user_id":"`+victim.String()+`"}`,
			uuid.Nil)
		if rec.Code != http.StatusForbidden || decodeCode(t, rec) != "link_mismatch" {
			t.Fatalf("status=%d code=%q, want 403/link_mismatch", rec.Code, decodeCode(t, rec))
		}
	})

	t.Run("session names a different user", func(t *testing.T) {
		rec := postIdentity(t, h,
			`{"provider":"github","subject":"s","email":"a@b.test","email_verified":true,"link_to_user_id":"`+victim.String()+`"}`,
			uuid.New())
		if rec.Code != http.StatusForbidden || decodeCode(t, rec) != "link_mismatch" {
			t.Fatalf("status=%d code=%q, want 403/link_mismatch", rec.Code, decodeCode(t, rec))
		}
	})
}

func TestPostIdentityAllowsLinkToProvenUser(t *testing.T) {
	signedIn := uuid.New()
	h := newHandler(stubStore{
		upsert: func(_ store.IdentityClaims, linkTo uuid.UUID) (*store.User, error) {
			if linkTo != signedIn {
				t.Fatalf("linkTo = %s, want %s", linkTo, signedIn)
			}
			return &store.User{ID: signedIn, Email: "a@b.test"}, nil
		},
	})

	rec := postIdentity(t, h,
		`{"provider":"github","subject":"s","email":"a@b.test","email_verified":true,"link_to_user_id":"`+signedIn.String()+`"}`,
		signedIn)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
}

// The BFF branches on these codes to pick login-page copy, so they are part of
// the contract, not incidental.
func TestPostIdentityErrorCodes(t *testing.T) {
	cases := []struct {
		name     string
		storeErr error
		body     string
		wantCode int
		wantKey  string
	}{
		{"email already taken", store.ErrEmailBelongsToAnotherUser,
			`{"provider":"github","subject":"s","email":"a@b.test","email_verified":true}`,
			http.StatusConflict, "email_taken"},
		{"stale session user", store.ErrUserNotFound,
			`{"provider":"github","subject":"s","email":"a@b.test","email_verified":true}`,
			http.StatusUnauthorized, "stale_session"},
		{"unverified email", nil,
			`{"provider":"github","subject":"s","email":"a@b.test","email_verified":false}`,
			http.StatusForbidden, "email_unverified"},
		{"unsupported provider", nil,
			`{"provider":"facebook","subject":"s","email":"a@b.test","email_verified":true}`,
			http.StatusBadRequest, "bad_request"},
		{"malformed link id", nil,
			`{"provider":"github","subject":"s","email":"a@b.test","email_verified":true,"link_to_user_id":"not-a-uuid"}`,
			http.StatusBadRequest, "bad_request"},
		{"unknown field", nil, `{"provider":"github","admin":true}`,
			http.StatusBadRequest, "bad_request"},
		{"not json", nil, `nonsense`, http.StatusBadRequest, "bad_request"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHandler(stubStore{
				upsert: func(store.IdentityClaims, uuid.UUID) (*store.User, error) {
					if tc.storeErr != nil {
						return nil, tc.storeErr
					}
					return &store.User{ID: uuid.New()}, nil
				},
			})
			rec := postIdentity(t, h, tc.body, uuid.Nil)
			if rec.Code != tc.wantCode {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, tc.wantCode, rec.Body.String())
			}
			if got := decodeCode(t, rec); got != tc.wantKey {
				t.Fatalf("code = %q, want %q", got, tc.wantKey)
			}
		})
	}
}

// GET /v1/me must answer for the context user and never for a user named in a
// header or query parameter.
func TestGetMeUsesContextUserOnly(t *testing.T) {
	ctxUser := uuid.New()
	other := uuid.New()

	h := newHandler(stubStore{
		get: func(id uuid.UUID) (*store.User, error) {
			if id != ctxUser {
				t.Fatalf("GetUser(%s), want %s — handler read identity from the request", id, ctxUser)
			}
			return &store.User{ID: ctxUser, Email: "me@example.test", DisplayName: "Me"}, nil
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/me?user_id="+other.String(), nil)
	req.Header.Set(httpx.UserIDHeader, other.String())
	req = req.WithContext(httpx.WithUserID(req.Context(), ctxUser))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), ctxUser.String()) {
		t.Fatalf("response is not the context user: %s", rec.Body.String())
	}
}

// If the account is deleted between the middleware check and the handler, the
// answer is 401, not a 500 or an empty user.
func TestGetMeOnVanishedUserIs401(t *testing.T) {
	h := newHandler(stubStore{
		get: func(uuid.UUID) (*store.User, error) { return nil, store.ErrUserNotFound },
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	req = req.WithContext(httpx.WithUserID(req.Context(), uuid.New()))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

type zoneRecorder struct {
	user        uuid.UUID
	zone        string
	onlyIfUnset bool
	calls       int
}

func (z *zoneRecorder) SetTimezone(_ context.Context, id uuid.UUID, zone string, onlyIfUnset bool) (bool, error) {
	z.user, z.zone, z.onlyIfUnset = id, zone, onlyIfUnset
	z.calls++
	return true, nil
}

// PUT /v1/me/timezone stores a zone Go can load, for the context user only,
// and refuses anything else before it reaches the store.
func TestPutTimezoneValidatesTheZone(t *testing.T) {
	me := uuid.New()
	zones := &zoneRecorder{}
	mux := http.NewServeMux()
	authapi.NewHandler(auth.NewService(stubStore{}), stubStore{}).WithTimezones(zones).RegisterRoutes(mux)
	put := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPut, "/v1/me/timezone", strings.NewReader(body))
		req = req.WithContext(httpx.WithUserID(req.Context(), me))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	rec := put(`{"timezone":"Asia/Ho_Chi_Minh","only_if_unset":true}`)
	if rec.Code != http.StatusOK || zones.user != me || zones.zone != "Asia/Ho_Chi_Minh" || !zones.onlyIfUnset {
		t.Fatalf("status %d, stored %+v: %s", rec.Code, zones, rec.Body.String())
	}
	for _, bad := range []string{`{"timezone":"Mars/Olympus"}`, `{"timezone":""}`, `{"timezone":"Local"}`, `{"timezone":"../../etc/passwd"}`} {
		if rec := put(bad); rec.Code != http.StatusBadRequest || decodeCode(t, rec) != "bad_timezone" {
			t.Errorf("%s: status %d %s", bad, rec.Code, rec.Body.String())
		}
	}
	if zones.calls != 1 {
		t.Fatalf("a refused zone reached the store: %d calls", zones.calls)
	}
}
