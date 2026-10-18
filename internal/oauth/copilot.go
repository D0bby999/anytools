package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

// copilot.go — the GitHub Copilot lane: an RFC 8628 device grant.
//
// Server-completable, unlike ChatGPT: the user opens github.com/login/device,
// types the code shown in Settings, and the server polls for the token. There
// is no redirect, so nothing about this deployment has to be registered
// anywhere.
//
// The client id is the one the VS Code Copilot extension publishes. Using it
// from a server is what postclaw does and what the Settings card warns about:
// GitHub's terms do not license a Copilot seat for proxying. The grant is a
// long-lived GitHub token with read:user; the short-lived Copilot session
// token is exchanged from it at serve time (providers.CopilotProvider).
// Ported from postclaw internal/oauth/device_flow.go (github_copilot).

// FlowGitHubCopilot is the Copilot subscription lane.
const FlowGitHubCopilot Flow = "github_copilot"

// CopilotClientID is the public GitHub Copilot OAuth app id.
const CopilotClientID = "Iv1.b507a08c87ecfe98"

// Endpoints, variables so tests can point them at a local server.
var (
	copilotDeviceCodeURL = "https://github.com/login/device/code"
	copilotTokenURL      = "https://github.com/login/oauth/access_token"
	githubUserURL        = "https://api.github.com/user"
)

// CopilotStart is what Settings shows while the user approves the sign-in.
type CopilotStart struct {
	SessionID       string `json:"session_id"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}

// ErrStillPending means GitHub has not seen the user approve yet.
var ErrStillPending = errors.New("oauth: not approved yet — enter the code on GitHub, then finish again")

// ErrSignInDenied means the user declined, or the code expired.
var ErrSignInDenied error = &UserError{Msg: "The sign-in was declined on GitHub, or its code expired. Start again."}

// StartCopilot asks GitHub for a device code.
func StartCopilot(ctx context.Context, userID uuid.UUID) (*CopilotStart, error) {
	var out struct {
		DeviceCode      string `json:"device_code"`
		UserCode        string `json:"user_code"`
		VerificationURI string `json:"verification_uri"`
		ExpiresIn       int    `json:"expires_in"`
		Interval        int    `json:"interval"`
	}
	form := url.Values{"client_id": {CopilotClientID}, "scope": {"read:user"}}
	if err := postForm(ctx, copilotDeviceCodeURL, form, &out); err != nil {
		return nil, fmt.Errorf("oauth: GitHub device code: %w", err)
	}
	if out.DeviceCode == "" || out.UserCode == "" {
		return nil, fmt.Errorf("oauth: GitHub returned no device code")
	}
	if out.ExpiresIn <= 0 {
		out.ExpiresIn = 900
	}
	if out.Interval <= 0 {
		out.Interval = 5
	}
	id := sessions.put(pending{userID: userID, flow: FlowGitHubCopilot, deviceCode: out.DeviceCode},
		time.Duration(out.ExpiresIn)*time.Second)
	return &CopilotStart{SessionID: id, UserCode: out.UserCode, VerificationURI: out.VerificationURI,
		ExpiresIn: out.ExpiresIn, Interval: out.Interval}, nil
}

// FinishCopilot polls once. It returns ErrStillPending until the user has
// approved, then the GitHub token with the account's login as AccountID.
func FinishCopilot(ctx context.Context, userID uuid.UUID, sessionID string) (*TokenResult, error) {
	p, err := sessions.get(sessionID, userID, FlowGitHubCopilot)
	if err != nil {
		return nil, err
	}
	var out struct {
		AccessToken string `json:"access_token"`
		Scope       string `json:"scope"`
		Error       string `json:"error"`
	}
	form := url.Values{
		"client_id":   {CopilotClientID},
		"device_code": {p.deviceCode},
		"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
	}
	if err := postForm(ctx, copilotTokenURL, form, &out); err != nil {
		return nil, fmt.Errorf("oauth: GitHub token poll: %w", err)
	}
	switch out.Error {
	case "":
	case "authorization_pending", "slow_down":
		return nil, ErrStillPending
	case "access_denied", "expired_token":
		sessions.drop(sessionID)
		return nil, ErrSignInDenied
	default:
		return nil, fmt.Errorf("oauth: GitHub token poll: %s", out.Error)
	}
	if out.AccessToken == "" {
		return nil, ErrStillPending
	}
	sessions.drop(sessionID)
	return &TokenResult{AccessToken: out.AccessToken, Scope: out.Scope,
		AccountID: githubLogin(ctx, out.AccessToken)}, nil
}

// githubLogin names the account, best-effort: a missing label never fails a
// grant that succeeded.
func githubLogin(ctx context.Context, token string) string {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubUserURL, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/json")
	resp, err := safeDo(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var u struct {
		Login string `json:"login"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&u) != nil {
		return ""
	}
	return u.Login
}

// postForm POSTs a form and decodes the JSON answer. GitHub reports device
// grant states as 200 with an "error" field, so only transport failures and
// non-200s are errors here.
func postForm(ctx context.Context, endpoint string, form url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, refreshTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := newClient(refreshTimeout).Do(req)
	if err != nil {
		return fmt.Errorf("unreachable: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		// A 4xx body is still JSON with an "error" field on some servers.
		if json.Unmarshal(raw, out) == nil {
			return nil
		}
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return json.Unmarshal(raw, out)
}

// safeDo sends a best-effort lookup through the SSRF-guarded client.
func safeDo(req *http.Request) (*http.Response, error) {
	return newClient(15 * time.Second).Do(req)
}
