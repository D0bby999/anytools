package drive

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

	"github.com/D0bby999/anytools/internal/config"
)

// oauth.go — the half of the flow that lives in Go.
//
// Consent itself happens in the BFF, exactly like login (phase 1): the browser
// needs a redirect the user can see, and the BFF already owns the state cookie,
// the PKCE verifier and the app's public origin. The BFF posts the resulting
// refresh token to POST /v1/connectors/drive/credentials, and from that moment
// this package owns it: every API call below refreshes on its own so the
// 15-minute sync job keeps working an hour after the user closed the tab.
//
// golang.org/x/oauth2 would do the refresh too. The stdlib version is kept
// because the whole connector is stdlib (see the package comment) and because
// the refresh is one form POST whose failure modes this file has to name
// precisely anyway — `invalid_grant` is the difference between "retry later"
// and "the user must reconnect", and no library makes that call for us.

// ErrNotConnected reports that this user has no Drive grant.
var ErrNotConnected = errors.New("drive: this account is not connected to Google Drive")

// ErrNeedsReconnect reports a grant Google has stopped honouring. Retrying is
// pointless; only a new consent fixes it.
var ErrNeedsReconnect = errors.New("drive: the Google Drive connection needs to be reconnected")

// ErrNotConfigured reports missing Google client credentials on the API side.
var ErrNotConfigured = errors.New("drive: no Google OAuth client is configured for the API")

// OAuthConfig is the token half of the authorization-code flow.
type OAuthConfig struct {
	ClientID     string
	ClientSecret string
	// RedirectURI must match the one the BFF used for the exchange. Google
	// checks it on the authorization-code grant; it is unused on refresh.
	RedirectURI string
	AuthURL     string
	TokenURL    string
	RevokeURL   string
	HTTP        *http.Client
}

// ConfigFromEnv reads the API's Google client credentials.
//
// Read here rather than in internal/config because this is the only subsystem
// that needs them and because an absent client must degrade to "Drive is not
// configured" rather than stopping the whole process from booting — every other
// feature works without Drive. internal/oauth reads its own lane switch the
// same way.
func ConfigFromEnv() OAuthConfig {
	return OAuthConfig{
		ClientID:     strings.TrimSpace(config.Getenv("ANYTOOLS_GOOGLE_CLIENT_ID")),
		ClientSecret: strings.TrimSpace(config.Getenv("ANYTOOLS_GOOGLE_CLIENT_SECRET")),
		RedirectURI:  strings.TrimSpace(config.Getenv("ANYTOOLS_GOOGLE_DRIVE_REDIRECT_URI")),
	}
}

// Configured reports whether a client id and secret are present.
func (c OAuthConfig) Configured() bool { return c.ClientID != "" && c.ClientSecret != "" }

func (c OAuthConfig) authURL() string {
	if c.AuthURL != "" {
		return c.AuthURL
	}
	return DefaultAuthURL
}

func (c OAuthConfig) tokenURL() string {
	if c.TokenURL != "" {
		return c.TokenURL
	}
	return DefaultTokenURL
}

func (c OAuthConfig) revokeURL() string {
	if c.RevokeURL != "" {
		return c.RevokeURL
	}
	return DefaultRevokeURL
}

func (c OAuthConfig) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 30 * time.Second}
}

// AuthCodeURL builds the consent URL.
//
// access_type=offline AND prompt=consent, both required and neither optional.
// Without them Google returns a refresh token only on a user's very first
// grant, so a user who once connected Drive, disconnected and reconnected would
// get an access token good for an hour and a connector that silently stopped
// syncing after it expired (researcher §5).
func (c OAuthConfig) AuthCodeURL(state string) string {
	q := url.Values{}
	q.Set("client_id", c.ClientID)
	q.Set("redirect_uri", c.RedirectURI)
	q.Set("response_type", "code")
	q.Set("scope", ScopeDriveFile)
	q.Set("access_type", "offline")
	q.Set("prompt", "consent")
	q.Set("include_granted_scopes", "true")
	q.Set("state", state)
	return c.authURL() + "?" + q.Encode()
}

// Token is the token endpoint's response.
//
// It has no String method and is never logged. Summary is the only safe thing
// to print about one.
type Token struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`

	Expiry time.Time `json:"-"`
}

// Summary describes a token without carrying it.
func (t *Token) Summary() string {
	return fmt.Sprintf("token{type=%s has_access=%t has_refresh=%t scope=%q expires_in=%ds}",
		t.TokenType, t.AccessToken != "", t.RefreshToken != "", t.Scope, t.ExpiresIn)
}

// Exchange trades an authorization code for tokens.
func (c OAuthConfig) Exchange(ctx context.Context, code string) (*Token, error) {
	return c.post(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"client_id":     {c.ClientID},
		"client_secret": {c.ClientSecret},
		"redirect_uri":  {c.RedirectURI},
	})
}

// Refresh renews the access token.
//
// Google does NOT return a new refresh_token here, so the caller keeps the one
// it holds. A store that blanked the refresh token on every refresh would break
// the connector exactly one hour after each successful sync.
func (c OAuthConfig) Refresh(ctx context.Context, refreshToken string) (*Token, error) {
	return c.post(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {c.ClientID},
		"client_secret": {c.ClientSecret},
	})
}

// Revoke tells Google to forget the grant.
//
// Called by DELETE /v1/connectors/drive. Deleting the local row alone would
// leave a live refresh token in Google's account permissions page with nothing
// on this side able to use or withdraw it — the user would have to revoke it by
// hand, from a screen they will never visit.
func (c OAuthConfig) Revoke(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	form := url.Values{"token": {token}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.revokeURL(), strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
	// 200 is success. 400 invalid_token means Google already forgot it, which
	// is the state we were asking for — reporting it as a failure would leave
	// the user unable to disconnect a connection that is already dead.
	if resp.StatusCode == http.StatusOK || alreadyRevoked(resp.StatusCode, body) {
		return nil
	}
	return &APIError{Status: resp.StatusCode, Reason: "revoke_failed", Message: oauthErrorCode(body)}
}

func alreadyRevoked(status int, body []byte) bool {
	return status == http.StatusBadRequest && oauthErrorCode(body) == "invalid_token"
}

func (c OAuthConfig) post(ctx context.Context, form url.Values) (*Token, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL(), strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode/100 != 2 {
		// The token endpoint uses a different envelope from the Drive API:
		// {"error":"invalid_grant","error_description":"..."}.
		var oe struct {
			Error       string `json:"error"`
			Description string `json:"error_description"`
		}
		_ = json.Unmarshal(body, &oe)
		if oe.Error == "" {
			oe.Error = http.StatusText(resp.StatusCode)
		}
		return nil, &APIError{Status: resp.StatusCode, Reason: oe.Error, Message: oe.Description}
	}
	var t Token
	if err := json.Unmarshal(body, &t); err != nil {
		return nil, err
	}
	if t.AccessToken == "" {
		return nil, errors.New("drive: the token endpoint returned no access_token")
	}
	t.Expiry = time.Now().Add(time.Duration(t.ExpiresIn) * time.Second)
	return &t, nil
}

func oauthErrorCode(body []byte) string {
	var oe struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(body, &oe)
	return oe.Error
}

// isGrantRejected reports a refresh Google will never honour again: the user
// revoked access, changed their password, or the grant expired while unused.
//
// Only this turns into needs_reconnect. A 500 or a timed-out request must NOT,
// or one bad minute at Google would tell every user to reconnect an account
// that is working perfectly.
func isGrantRejected(err error) bool {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	switch apiErr.Reason {
	case "invalid_grant", "unauthorized_client", "invalid_client":
		return true
	}
	return false
}
