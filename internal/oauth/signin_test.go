package oauth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
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

// fakeProvider stands in for GitHub or Anthropic. The handler sees each
// request; the test swaps the package's endpoints and client to reach it.
func fakeProvider(t *testing.T, h http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	prevClient := newClient
	newClient = func(timeout time.Duration) *http.Client { return &http.Client{Timeout: timeout} }
	t.Cleanup(func() { newClient = prevClient })
	return srv
}

func swap(t *testing.T, target *string, value string) {
	t.Helper()
	prev := *target
	*target = value
	t.Cleanup(func() { *target = prev })
}

func TestCopilotSignInWaitsForApprovalThenReturnsTheGitHubToken(t *testing.T) {
	approved := false
	srv := fakeProvider(t, func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		switch r.URL.Path {
		case "/device":
			if r.Form.Get("client_id") != CopilotClientID {
				t.Errorf("device code asked with client %q", r.Form.Get("client_id"))
			}
			_, _ = io.WriteString(w, `{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}`)
		case "/token":
			if r.Form.Get("device_code") != "dc" {
				t.Errorf("polled with device code %q", r.Form.Get("device_code"))
			}
			if !approved {
				_, _ = io.WriteString(w, `{"error":"authorization_pending"}`)
				return
			}
			_, _ = io.WriteString(w, `{"access_token":"gho_x","scope":"read:user"}`)
		case "/user":
			_, _ = io.WriteString(w, `{"login":"octo"}`)
		}
	})
	swap(t, &copilotDeviceCodeURL, srv.URL+"/device")
	swap(t, &copilotTokenURL, srv.URL+"/token")
	swap(t, &githubUserURL, srv.URL+"/user")

	owner, other := uuid.New(), uuid.New()
	start, err := StartCopilot(context.Background(), owner)
	if err != nil {
		t.Fatal(err)
	}
	if start.UserCode != "ABCD-1234" || start.SessionID == "" {
		t.Fatalf("start = %+v", start)
	}

	if _, err := FinishCopilot(context.Background(), owner, start.SessionID); !errors.Is(err, ErrStillPending) {
		t.Fatalf("before approval: err = %v, want ErrStillPending", err)
	}
	// Another user holding the handle learns nothing, not even that it exists.
	if _, err := FinishCopilot(context.Background(), other, start.SessionID); !errors.Is(err, ErrPendingNotFound) {
		t.Fatalf("foreign finish: err = %v, want ErrPendingNotFound", err)
	}

	approved = true
	res, err := FinishCopilot(context.Background(), owner, start.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if res.AccessToken != "gho_x" || res.AccountID != "octo" || !res.ExpiresAt.IsZero() {
		t.Fatalf("result = %+v", res)
	}
	// The handle is spent.
	if _, err := FinishCopilot(context.Background(), owner, start.SessionID); !errors.Is(err, ErrPendingNotFound) {
		t.Fatalf("second finish: err = %v", err)
	}
}

func TestCopilotSignInThatWasDeclinedSaysSo(t *testing.T) {
	srv := fakeProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/device" {
			_, _ = io.WriteString(w, `{"device_code":"dc","user_code":"U","verification_uri":"v"}`)
			return
		}
		_, _ = io.WriteString(w, `{"error":"access_denied"}`)
	})
	swap(t, &copilotDeviceCodeURL, srv.URL+"/device")
	swap(t, &copilotTokenURL, srv.URL+"/token")
	user := uuid.New()
	start, err := StartCopilot(context.Background(), user)
	if err != nil {
		t.Fatal(err)
	}
	var ue *UserError
	if _, err := FinishCopilot(context.Background(), user, start.SessionID); !errors.As(err, &ue) {
		t.Fatalf("declined: err = %v, want a UserError", err)
	}
}

func TestClaudeSignInExchangesThePastedCodeWithItsOwnVerifier(t *testing.T) {
	var gotBody map[string]string
	srv := fakeProvider(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &gotBody)
			_, _ = io.WriteString(w, `{"access_token":"at","refresh_token":"rt","expires_in":28800}`)
		case "/bootstrap":
			_, _ = io.WriteString(w, `{"oauth_account":{"account_uuid":"acct-1","account_email":"me@example.com"}}`)
		}
	})
	swap(t, &claudeTokenURL, srv.URL+"/token")
	swap(t, &claudeBootstrapURL, srv.URL+"/bootstrap")

	user := uuid.New()
	start := StartClaude(user)
	u, err := url.Parse(start.AuthorizeURL)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if q.Get("client_id") != ClaudeClientID || q.Get("scope") != claudeScopes || q.Get("code") != "true" {
		t.Fatalf("authorize URL = %s", start.AuthorizeURL)
	}
	state := q.Get("state")

	// A code from some other sign-in is refused before it is spent.
	var ue *UserError
	if _, err := FinishClaude(context.Background(), user, start.SessionID, "c#not-"+state); !errors.As(err, &ue) {
		t.Fatalf("mismatched state: err = %v", err)
	}

	res, err := FinishClaude(context.Background(), user, start.SessionID, "the-code#"+state)
	if err != nil {
		t.Fatal(err)
	}
	if gotBody["code"] != "the-code" || gotBody["grant_type"] != "authorization_code" {
		t.Fatalf("exchange body = %v", gotBody)
	}
	sum := sha256.Sum256([]byte(gotBody["code_verifier"]))
	if base64.RawURLEncoding.EncodeToString(sum[:]) != q.Get("code_challenge") {
		t.Fatal("the verifier sent does not match the challenge in the authorize URL")
	}
	if res.AccessToken != "at" || res.RefreshToken != "rt" || res.AccountUUID != "acct-1" || len(res.DeviceID) != 64 {
		t.Fatalf("result = %+v", res)
	}
	if time.Until(res.ExpiresAt) < 7*time.Hour {
		t.Fatalf("expiry not taken from expires_in: %v", res.ExpiresAt)
	}
}

func TestClaudeRefreshCarriesTheOAuthBeta(t *testing.T) {
	srv := fakeProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("anthropic-beta"), "oauth-2025-04-20") {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_, _ = io.WriteString(w, `{"access_token":"new","expires_in":3600}`)
	})
	swap(t, &claudeTokenURL, srv.URL)
	res, err := DefaultRefresh(context.Background(), FlowClaudeSub, "old-rt")
	if err != nil {
		t.Fatal(err)
	}
	// Anthropic may omit a rotated refresh token; the old one is kept.
	if res.AccessToken != "new" || res.RefreshToken != "old-rt" {
		t.Fatalf("refresh = %+v", res)
	}
}

func TestPendingSignInsAreBoundedPerUser(t *testing.T) {
	user := uuid.New()
	var ids []string
	for i := 0; i < maxPendingPerUser+2; i++ {
		ids = append(ids, StartClaude(user).SessionID)
		time.Sleep(time.Millisecond)
	}
	if _, err := sessions.get(ids[0], user, FlowClaudeSub); !errors.Is(err, ErrPendingNotFound) {
		t.Fatal("the oldest pending sign-in survived past the per-user bound")
	}
	if _, err := sessions.get(ids[len(ids)-1], user, FlowClaudeSub); err != nil {
		t.Fatalf("the newest pending sign-in was dropped: %v", err)
	}
}
