package appconn

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

type mem struct{ c map[string]*Connection }

func (m *mem) Get(_ context.Context, u uuid.UUID, p string) (*Connection, error) {
	if c, ok := m.c[u.String()+p]; ok {
		cp := *c
		return &cp, nil
	}
	return nil, ErrNotConnected
}
func (m *mem) Save(_ context.Context, c Connection) error {
	m.c[c.UserID.String()+c.Provider] = &c
	return nil
}
func (m *mem) SaveTokens(_ context.Context, u uuid.UUID, p, a, r string, e *time.Time) error {
	c := m.c[u.String()+p]
	c.AccessToken, c.RefreshToken, c.ExpiresAt = a, r, e
	return nil
}
func (m *mem) MarkNeedsReconnect(_ context.Context, u uuid.UUID, p, _ string) error {
	m.c[u.String()+p].NeedsReconnect = true
	return nil
}
func (m *mem) Delete(_ context.Context, u uuid.UUID, p string) error {
	delete(m.c, u.String()+p)
	return nil
}

func TestFormProviderWithPKCE(t *testing.T) {
	var refreshes int
	revoked := ""
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, secret, ok := r.BasicAuth()
		if !ok || id != "cid" || secret != "sec" {
			t.Errorf("basic auth: %q %q", id, secret)
		}
		_ = r.ParseForm()
		switch {
		case r.URL.Path == "/revoke":
			revoked = r.Form.Get("token")
		case r.Form.Get("grant_type") == "authorization_code":
			if r.Form.Get("code_verifier") != "ver" || r.Form.Get("code") != "c1" {
				t.Errorf("exchange form: %v", r.Form)
			}
			_, _ = io.WriteString(w, `{"access_token":"a1","refresh_token":"r1","expires_in":3600,"scope":"design:meta:read"}`)
		case r.Form.Get("grant_type") == "refresh_token":
			refreshes++
			if r.Form.Get("refresh_token") == "dead" {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, `{"error":"invalid_grant"}`)
				return
			}
			n := string(rune('1' + refreshes))
			_, _ = io.WriteString(w, `{"access_token":"a`+n+`","refresh_token":"r`+n+`","expires_in":3600}`)
		}
	}))
	defer srv.Close()
	p := Provider{ID: "canva", AuthURL: "https://www.canva.com/api/oauth/authorize", TokenURL: srv.URL + "/token", RevokeURL: srv.URL + "/revoke",
		ClientID: "cid", ClientSecret: "sec", Scopes: []string{"design:meta:read", "profile:read"}, PKCE: true,
		Label: func(context.Context, map[string]any, string) string { return "Lan" }}
	store := &mem{c: map[string]*Connection{}}
	svc := NewService(store, p, Provider{ID: "notion"})
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	svc.SetClock(func() time.Time { return now })
	ctx, user := context.Background(), uuid.New()

	u, err := svc.AuthorizeURL("canva", "st", "ch", "https://anytools.world/auth/app/canva/callback")
	q, _ := url.Parse(u)
	if err != nil || q.Query().Get("code_challenge") != "ch" || q.Query().Get("scope") != "design:meta:read profile:read" {
		t.Fatalf("%s %v", u, err)
	}
	if _, err := svc.AuthorizeURL("notion", "", "", ""); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("unconfigured: %v", err)
	}
	if err := svc.Connect(ctx, user, "canva", "c1", "ver", "https://x/cb"); err != nil {
		t.Fatal(err)
	}
	if st, _ := svc.Status(ctx, user, "canva"); !st.Connected || st.Account != "Lan" {
		t.Fatalf("status: %+v", st)
	}
	if tok, _ := svc.Token(ctx, user, "canva"); tok != "a1" || refreshes != 0 {
		t.Fatalf("fresh token: %s", tok)
	}
	now = now.Add(2 * time.Hour)
	if tok, _ := svc.Token(ctx, user, "canva"); tok != "a2" || refreshes != 1 || store.c[user.String()+"canva"].RefreshToken != "r2" {
		t.Fatalf("refresh rotates: %s", tok)
	}

	// A 401 refreshes once and retries.
	calls := 0
	resp, err := svc.Do(ctx, user, "canva", func(tok string) (*http.Response, error) {
		calls++
		if tok == "a2" {
			return &http.Response{StatusCode: 401, Body: io.NopCloser(strings.NewReader(""))}, nil
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(""))}, nil
	})
	if err != nil || resp.StatusCode != 200 || calls != 2 {
		t.Fatalf("retry: %v %d", err, calls)
	}

	store.c[user.String()+"canva"].RefreshToken = "dead"
	now = now.Add(2 * time.Hour)
	if _, err := svc.Token(ctx, user, "canva"); !errors.Is(err, ErrNeedsReconnect) {
		t.Fatalf("a refused refresh: %v", err)
	}
	if err := svc.Disconnect(ctx, user, "canva"); err != nil || revoked != "dead" {
		t.Fatalf("disconnect: %v %q", err, revoked)
	}
	if _, err := store.Get(ctx, user, "canva"); !errors.Is(err, ErrNotConnected) {
		t.Fatal("forgotten")
	}
}

func TestJSONProvider(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if r.Header.Get("Content-Type") != "application/json" || body["code_verifier"] != "" || body["grant_type"] != "authorization_code" {
			t.Errorf("json body: %v", body)
		}
		_, _ = io.WriteString(w, `{"access_token":"n1","refresh_token":"nr1","workspace_name":"Study"}`)
	}))
	defer srv.Close()
	p := Provider{ID: "notion", TokenURL: srv.URL, ClientID: "c", ClientSecret: "s", JSONBody: true,
		Label: func(_ context.Context, tok map[string]any, _ string) string { return str(tok, "workspace_name") }}
	store := &mem{c: map[string]*Connection{}}
	svc := NewService(store, p)
	user := uuid.New()
	if err := svc.Connect(context.Background(), user, "notion", "code", "v", "r"); err != nil {
		t.Fatal(err)
	}
	if c := store.c[user.String()+"notion"]; c.AccountLabel != "Study" || c.ExpiresAt != nil {
		t.Fatalf("%+v", c)
	}
	if tok, _ := svc.Token(context.Background(), user, "notion"); tok != "n1" {
		t.Fatal("a token with no expiry is used as is")
	}
}
