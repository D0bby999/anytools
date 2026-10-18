package drive

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func testOAuth(rec *recorder) OAuthConfig {
	return OAuthConfig{
		ClientID:     "111222333444-fakeclient.apps.googleusercontent.com",
		ClientSecret: "GOCSPX-fake-secret-value",
		RedirectURI:  "http://localhost:3000/auth/drive/callback",
		TokenURL:     rec.URL() + "/token",
		RevokeURL:    rec.URL() + "/revoke",
	}
}

// The consent URL must ask for drive.file only, and must ask in the way that
// actually yields a refresh token every time.
func TestAuthCodeURL_RequestsOfflineDriveFileConsent(t *testing.T) {
	c := OAuthConfig{
		ClientID:    "111222333444-fakeclient.apps.googleusercontent.com",
		RedirectURI: "http://localhost:3000/auth/drive/callback",
	}
	u, err := url.Parse(c.AuthCodeURL("state-123"))
	if err != nil {
		t.Fatalf("AuthCodeURL is not a URL: %v", err)
	}
	if u.Host != "accounts.google.com" || u.Path != "/o/oauth2/v2/auth" {
		t.Errorf("endpoint = %s%s, want accounts.google.com/o/oauth2/v2/auth", u.Host, u.Path)
	}
	q := u.Query()
	for k, want := range map[string]string{
		"scope":         ScopeDriveFile,
		"access_type":   "offline",
		"prompt":        "consent",
		"response_type": "code",
		"redirect_uri":  "http://localhost:3000/auth/drive/callback",
		"state":         "state-123",
	} {
		if got := q.Get(k); got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}
	// Anything broader than drive.file drags the app into restricted-scope
	// (CASA) review — months, not days.
	if strings.Contains(q.Get("scope"), "drive.readonly") ||
		q.Get("scope") == "https://www.googleapis.com/auth/drive" {
		t.Error("the connector must never request a restricted Drive scope")
	}
}

func TestExchange_PostsTheAuthorizationCodeGrant(t *testing.T) {
	rec := newRecorder(t, step{
		name: "token exchange", wantPath: "/token", file: "token_response.json",
		check: func(t *testing.T, r *http.Request) {
			if r.Method != http.MethodPost {
				t.Errorf("method = %s, want POST", r.Method)
			}
			if ct := r.Header.Get("Content-Type"); ct != "application/x-www-form-urlencoded" {
				t.Errorf("Content-Type = %q", ct)
			}
			f := formOf(t, r)
			if f.Get("grant_type") != "authorization_code" || f.Get("code") != "4/0AfakeAuthCode" {
				t.Errorf("unexpected grant: %v", f.Get("grant_type"))
			}
			// A web client must present its secret; a mis-typed client type
			// (Desktop/PKCE) is one of the ways this connector can be blocked.
			if f.Get("client_id") == "" || f.Get("client_secret") == "" {
				t.Error("the web-client exchange must carry client_id and client_secret")
			}
		},
	})
	defer rec.done()

	tok, err := testOAuth(rec).Exchange(context.Background(), "4/0AfakeAuthCode")
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if tok.RefreshToken == "" {
		t.Fatal("no refresh token: the connector cannot sync after the access token expires")
	}
	if tok.Scope != ScopeDriveFile {
		t.Errorf("granted scope = %q", tok.Scope)
	}
	if tok.Expiry.IsZero() {
		t.Error("Expiry must be derived from expires_in")
	}
}

// Refresh must NOT send a redirect_uri, and must send the refresh grant.
func TestRefresh_SendsTheRefreshGrantOnly(t *testing.T) {
	rec := newRecorder(t, step{
		name: "token refresh", wantPath: "/token", file: "token_response.json",
		check: func(t *testing.T, r *http.Request) {
			f := formOf(t, r)
			if f.Get("grant_type") != "refresh_token" {
				t.Errorf("grant_type = %q", f.Get("grant_type"))
			}
			if f.Get("refresh_token") != "1//0g-stored-refresh" {
				t.Errorf("refresh_token not forwarded: %q", f.Get("refresh_token"))
			}
			if f.Get("redirect_uri") != "" {
				t.Error("a refresh must not carry redirect_uri")
			}
		},
	})
	defer rec.done()

	if _, err := testOAuth(rec).Refresh(context.Background(), "1//0g-stored-refresh"); err != nil {
		t.Fatalf("Refresh: %v", err)
	}
}

// The house rule — a credential value never reaches a log line — has to be
// enforced by a test, not by good intentions.
func TestTokenSummary_NeverCarriesTheSecret(t *testing.T) {
	tok := &Token{
		AccessToken:  "ya29.super-secret-access",
		RefreshToken: "1//0g-super-secret-refresh",
		TokenType:    "Bearer",
		ExpiresIn:    3599,
		Scope:        ScopeDriveFile,
	}
	s := tok.Summary()
	for _, secret := range []string{tok.AccessToken, tok.RefreshToken} {
		if strings.Contains(s, secret) {
			t.Fatalf("Summary() leaked a credential: %q", s)
		}
	}
	for _, want := range []string{"has_access=true", "has_refresh=true", "drive.file"} {
		if !strings.Contains(s, want) {
			t.Errorf("Summary() should report %q, got %q", want, s)
		}
	}
}

func TestExchange_SurfacesGoogleOAuthErrorEnvelope(t *testing.T) {
	rec := newRecorder(t, step{
		name: "token exchange rejected", wantPath: "/token",
		file: "token_error_redirect_mismatch.json", status: http.StatusBadRequest,
	})
	defer rec.done()

	_, err := testOAuth(rec).Exchange(context.Background(), "4/0Abad")
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("error = %v, want *APIError", err)
	}
	// The token endpoint uses {"error": "..."} — a different envelope from the
	// Drive API's {"error":{"errors":[{"reason":"..."}]}}.
	if apiErr.Reason != "redirect_uri_mismatch" {
		t.Errorf("Reason = %q, want redirect_uri_mismatch", apiErr.Reason)
	}
}

// isGrantRejected decides whether a user is told to reconnect. It has to be
// exactly right in BOTH directions: a false positive disconnects a working
// account, a false negative leaves a dead connector reporting green.
func TestIsGrantRejected_OnlyForRealGrantFailures(t *testing.T) {
	rejected := []string{"invalid_grant", "unauthorized_client", "invalid_client"}
	for _, reason := range rejected {
		if !isGrantRejected(&APIError{Status: 400, Reason: reason}) {
			t.Errorf("%s must mark the connection for reconnect", reason)
		}
	}
	survivable := []*APIError{
		{Status: 500, Reason: "Internal Server Error"},
		{Status: 503, Reason: "backendError"},
		{Status: 429, Reason: "rateLimitExceeded"},
	}
	for _, e := range survivable {
		if isGrantRejected(e) {
			t.Errorf("HTTP %d (%s) must NOT tell the user to reconnect — one bad minute at Google "+
				"would disconnect every account", e.Status, e.Reason)
		}
	}
	if isGrantRejected(errors.New("dial tcp: connection refused")) {
		t.Error("a transport failure is not a rejected grant")
	}
}

// Revoke is what stops a disconnect from leaving a live token in the user's
// Google account permissions with nothing on this side able to withdraw it.
func TestRevoke_PostsTheTokenAndToleratesAnAlreadyDeadOne(t *testing.T) {
	rec := newRecorder(t,
		step{
			name: "revoke", wantPath: "/revoke", body: "{}",
			check: func(t *testing.T, r *http.Request) {
				if got := formOf(t, r).Get("token"); got != "1//0g-stored-refresh" {
					t.Errorf("revoke posted token %q", got)
				}
			},
		},
		step{
			name: "revoke an already-revoked token", wantPath: "/revoke",
			body: `{"error":"invalid_token"}`, status: http.StatusBadRequest,
		},
	)
	defer rec.done()

	cfg := testOAuth(rec)
	if err := cfg.Revoke(context.Background(), "1//0g-stored-refresh"); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	// Google already forgot it — which is the state we were asking for. Calling
	// that a failure would leave the user unable to disconnect a dead grant.
	if err := cfg.Revoke(context.Background(), "1//0g-already-gone"); err != nil {
		t.Errorf("an already-revoked token must not fail the disconnect: %v", err)
	}
}

func TestPostRefusesWithoutAConfiguredClient(t *testing.T) {
	var cfg OAuthConfig
	if _, err := cfg.Refresh(context.Background(), "x"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("error = %v, want ErrNotConfigured", err)
	}
}
