package oauth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

// claude.go — the Claude Pro/Max lane: a PKCE authorisation with a pasted
// code.
//
// The user opens the authorise URL, approves on claude.ai, and Anthropic's
// own callback page shows a code ("code#state") to copy back into Settings.
// The redirect is Anthropic's page, not this deployment, so nothing has to be
// registered. Exchange, refresh and serving all run server-side
// (api.anthropic.com does not block datacenter addresses).
//
// The client id is Claude Code's public one, and serving is shaped as the
// Claude Code CLI (providers.WithAnthropicOAuth). Anthropic's terms do not
// license a subscription for use through another app; the Settings card says
// so. The scopes are exactly the ones postclaw measured being billed to the
// plan — widening them got the traffic billed as a third-party app (postclaw
// internal/oauth/paste_code_flow.go, 2026-09-03). Do not add scopes.

// FlowClaudeSub is the Claude subscription lane.
const FlowClaudeSub Flow = "claude_sub"

// ClaudeClientID is Claude Code's public OAuth client id.
const ClaudeClientID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"

const (
	claudeAuthorizeURL = "https://claude.ai/oauth/authorize"
	claudeRedirectURI  = "https://platform.claude.com/oauth/code/callback"
	claudeScopes       = "org:create_api_key user:profile user:inference"
	// claudePendingTTL is how long a started sign-in waits for its code.
	claudePendingTTL = 15 * time.Minute
)

// Endpoints, variables so tests can point them at a local server.
var (
	claudeTokenURL     = "https://api.anthropic.com/v1/oauth/token"
	claudeBootstrapURL = "https://api.anthropic.com/api/claude_cli/bootstrap"
)

// ClaudeStart is the URL to approve at, and the handle to finish with.
type ClaudeStart struct {
	SessionID    string `json:"session_id"`
	AuthorizeURL string `json:"authorize_url"`
}

// ClaudeResult is a completed Claude sign-in.
type ClaudeResult struct {
	TokenResult
	// DeviceID is this connection's stable client identity, reused on every
	// request and across refreshes.
	DeviceID string
	// AccountUUID and Email come from Anthropic's bootstrap call; either may
	// be empty.
	AccountUUID string
	Email       string
}

// StartClaude creates the PKCE pair and the authorise URL.
func StartClaude(userID uuid.UUID) *ClaudeStart {
	verifier := randomToken(32)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	state := randomToken(32)

	// Parameter order follows Claude Code's own URL; `code=true` first is
	// what makes the callback page display the code instead of redirecting.
	q := []string{
		"code=true",
		"client_id=" + url.QueryEscape(ClaudeClientID),
		"response_type=code",
		"redirect_uri=" + url.QueryEscape(claudeRedirectURI),
		"scope=" + url.QueryEscape(claudeScopes),
		"code_challenge=" + challenge,
		"code_challenge_method=S256",
		"state=" + state,
	}
	id := sessions.put(pending{userID: userID, flow: FlowClaudeSub, verifier: verifier, state: state}, claudePendingTTL)
	return &ClaudeStart{SessionID: id, AuthorizeURL: claudeAuthorizeURL + "?" + strings.Join(q, "&")}
}

// FinishClaude exchanges the pasted code. It accepts the "code#state" text
// the callback page shows, or the whole callback URL.
func FinishClaude(ctx context.Context, userID uuid.UUID, sessionID, pasted string) (*ClaudeResult, error) {
	p, err := sessions.get(sessionID, userID, FlowClaudeSub)
	if err != nil {
		return nil, err
	}
	code, state := splitPastedCode(strings.TrimSpace(pasted))
	if code == "" {
		return nil, userErr("Paste the code Claude showed after you approved.")
	}
	if state != "" && state != p.state {
		// The code belongs to a different sign-in (an older tab, say).
		return nil, userErr("That code is from a different sign-in. Start again and paste the new code.")
	}
	body, _ := json.Marshal(map[string]string{
		"code":          code,
		"state":         p.state,
		"grant_type":    "authorization_code",
		"client_id":     ClaudeClientID,
		"redirect_uri":  claudeRedirectURI,
		"code_verifier": p.verifier,
	})
	raw, err := postToken(ctx, claudeTokenURL, "application/json", strings.NewReader(string(body)), nil)
	// Single use either way: a failed exchange has consumed the code.
	sessions.drop(sessionID)
	if IsPermanentGrantFailure(err) {
		return nil, userErr("Claude refused that code. Codes work once and expire within minutes; start again.")
	}
	if err != nil {
		return nil, err
	}
	tok, err := decodeTokenResponse(raw, "")
	if err != nil {
		return nil, err
	}
	res := &ClaudeResult{TokenResult: *tok, DeviceID: newDeviceID()}
	res.Email, res.AccountUUID = claudeBootstrap(ctx, tok.AccessToken)
	return res, nil
}

// refreshClaude renews a Claude subscription token.
func refreshClaude(ctx context.Context, refreshToken string) (*TokenResult, error) {
	body, _ := json.Marshal(map[string]string{
		"grant_type":    "refresh_token",
		"refresh_token": refreshToken,
		"client_id":     ClaudeClientID,
	})
	raw, err := postToken(ctx, claudeTokenURL, "application/json", strings.NewReader(string(body)),
		map[string]string{"anthropic-beta": "oauth-2025-04-20"})
	if err != nil {
		return nil, err
	}
	return decodeTokenResponse(raw, refreshToken)
}

// splitPastedCode takes "code#state" or a callback URL carrying both.
func splitPastedCode(s string) (code, state string) {
	if u, err := url.Parse(s); err == nil && u.Scheme != "" && u.Query().Get("code") != "" {
		return u.Query().Get("code"), u.Query().Get("state")
	}
	if i := strings.Index(s, "#"); i >= 0 {
		return s[:i], s[i+1:]
	}
	return s, ""
}

// newDeviceID is a 64-hex client identity, the shape Claude Code sends.
func newDeviceID() string {
	sum := sha256.Sum256([]byte(uuid.NewString()))
	return fmt.Sprintf("%x", sum[:])
}

// claudeBootstrap names the account. Best-effort, like githubLogin.
func claudeBootstrap(ctx context.Context, token string) (email, accountUUID string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, claudeBootstrapURL, nil)
	if err != nil {
		return "", ""
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("anthropic-beta", "oauth-2025-04-20")
	resp, err := safeDo(req)
	if err != nil {
		return "", ""
	}
	defer resp.Body.Close()
	var out struct {
		OAuthAccount struct {
			AccountUUID  string `json:"account_uuid"`
			AccountEmail string `json:"account_email"`
		} `json:"oauth_account"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&out) != nil {
		return "", ""
	}
	return out.OAuthAccount.AccountEmail, out.OAuthAccount.AccountUUID
}
