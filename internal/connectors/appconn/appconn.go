// Package appconn is a learner's OAuth connection to a learning tool outside
// Google (learning-tool-connections phases 8 and 9): Canva and Notion. Both
// are an authorization-code grant with a client secret this server holds, a
// refresh token that rotates, and a revoke; one store and one service serve
// both, each provider described by a Provider value.
//
// The consent is split as Drive's is: the BFF owns the state cookie and the
// PKCE verifier, asks the API for the authorize URL, and posts the code and
// verifier back; the exchange happens here, so the secret never leaves the
// API. Tokens are encrypted at rest by the store.
package appconn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Errors a caller can name.
var (
	ErrUnknownProvider = errors.New("appconn: no such app")
	ErrNotConfigured   = errors.New("appconn: this app is not configured on this deployment")
	ErrNotConnected    = errors.New("appconn: this app is not connected")
	ErrNeedsReconnect  = errors.New("appconn: this app needs to be reconnected")
)

// Provider describes one app's OAuth.
type Provider struct {
	ID           string
	AuthURL      string
	TokenURL     string
	RevokeURL    string
	ClientID     string
	ClientSecret string
	Scopes       []string
	// PKCE sends code_challenge (S256) and code_verifier.
	PKCE bool
	// JSONBody posts the token request as JSON (Notion) rather than a form.
	JSONBody bool
	// AuthParams are extra authorize parameters (Notion's owner=user).
	AuthParams url.Values
	// Label names the connected account from the token response, or with a
	// call made with the new token; "" is fine.
	Label func(ctx context.Context, token map[string]any, access string) string
}

// Configured reports whether the client id and secret are set.
func (p Provider) Configured() bool { return p.ClientID != "" && p.ClientSecret != "" }

// Connection is one learner's grant to one app.
type Connection struct {
	UserID         uuid.UUID
	Provider       string
	RefreshToken   string
	AccessToken    string
	ExpiresAt      *time.Time
	Scope          string
	AccountLabel   string
	NeedsReconnect bool
	LastError      string
	ConnectedAt    time.Time
}

// Store persists connections.
type Store interface {
	Get(ctx context.Context, userID uuid.UUID, provider string) (*Connection, error)
	Save(ctx context.Context, c Connection) error
	SaveTokens(ctx context.Context, userID uuid.UUID, provider, access, refresh string, expiresAt *time.Time) error
	MarkNeedsReconnect(ctx context.Context, userID uuid.UUID, provider, reason string) error
	Delete(ctx context.Context, userID uuid.UUID, provider string) error
}

// Service runs the connections.
type Service struct {
	providers map[string]Provider
	store     Store
	http      *http.Client
	now       func() time.Time
	mu        sync.Map // user/provider -> *sync.Mutex
}

// NewService returns a Service over the given providers.
func NewService(store Store, providers ...Provider) *Service {
	m := map[string]Provider{}
	for _, p := range providers {
		m[p.ID] = p
	}
	return &Service{providers: m, store: store, http: &http.Client{Timeout: 30 * time.Second}, now: time.Now}
}

// SetHTTP and SetClock are for tests.
func (s *Service) SetHTTP(c *http.Client)        { s.http = c }
func (s *Service) SetClock(now func() time.Time) { s.now = now }

func (s *Service) provider(id string) (Provider, error) {
	p, ok := s.providers[id]
	if !ok {
		return Provider{}, ErrUnknownProvider
	}
	if !p.Configured() {
		return p, ErrNotConfigured
	}
	return p, nil
}

// AuthorizeURL is the consent URL the BFF redirects to.
func (s *Service) AuthorizeURL(id, state, challenge, redirectURI string) (string, error) {
	p, err := s.provider(id)
	if err != nil {
		return "", err
	}
	q := url.Values{
		"client_id":     {p.ClientID},
		"response_type": {"code"},
		"redirect_uri":  {redirectURI},
		"state":         {state},
	}
	if len(p.Scopes) > 0 {
		q.Set("scope", strings.Join(p.Scopes, " "))
	}
	if p.PKCE {
		q.Set("code_challenge", challenge)
		q.Set("code_challenge_method", "S256")
	}
	for k, v := range p.AuthParams {
		q[k] = v
	}
	return p.AuthURL + "?" + q.Encode(), nil
}

// tokenError is an OAuth error answer.
type tokenError struct {
	Status int
	Code   string
}

func (e *tokenError) Error() string {
	return fmt.Sprintf("appconn: token endpoint %d %s", e.Status, e.Code)
}

func (s *Service) token(ctx context.Context, p Provider, fields map[string]string) (map[string]any, error) {
	var body io.Reader
	contentType := "application/x-www-form-urlencoded"
	if p.JSONBody {
		b, _ := json.Marshal(fields)
		body, contentType = strings.NewReader(string(b)), "application/json"
	} else {
		form := url.Values{}
		for k, v := range fields {
			form.Set(k, v)
		}
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.TokenURL, body)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(p.ClientID, p.ClientSecret)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Accept", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var out map[string]any
	_ = json.Unmarshal(data, &out)
	if resp.StatusCode/100 != 2 {
		code, _ := out["error"].(string)
		if code == "" {
			code, _ = out["code"].(string)
		}
		return nil, &tokenError{Status: resp.StatusCode, Code: code}
	}
	if str(out, "access_token") == "" {
		return nil, errors.New("appconn: the token endpoint returned no access_token")
	}
	return out, nil
}

func str(m map[string]any, k string) string {
	v, _ := m[k].(string)
	return v
}

func (s *Service) expiry(m map[string]any) *time.Time {
	secs, ok := m["expires_in"].(float64)
	if !ok || secs <= 0 {
		return nil
	}
	t := s.now().Add(time.Duration(secs) * time.Second)
	return &t
}

// Connect exchanges a code and stores the grant.
func (s *Service) Connect(ctx context.Context, userID uuid.UUID, id, code, verifier, redirectURI string) error {
	p, err := s.provider(id)
	if err != nil {
		return err
	}
	fields := map[string]string{"grant_type": "authorization_code", "code": code, "redirect_uri": redirectURI}
	if p.PKCE {
		fields["code_verifier"] = verifier
	}
	tok, err := s.token(ctx, p, fields)
	if err != nil {
		return err
	}
	label := ""
	if p.Label != nil {
		label = p.Label(ctx, tok, str(tok, "access_token"))
	}
	return s.store.Save(ctx, Connection{
		UserID: userID, Provider: id,
		AccessToken: str(tok, "access_token"), RefreshToken: str(tok, "refresh_token"),
		ExpiresAt: s.expiry(tok), Scope: str(tok, "scope"), AccountLabel: label,
		ConnectedAt: s.now(),
	})
}

func (s *Service) lock(userID uuid.UUID, id string) func() {
	m, _ := s.mu.LoadOrStore(userID.String()+"/"+id, &sync.Mutex{})
	mu := m.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

// Token returns a usable access token, refreshing it when it is about to
// expire. A refresh token rotates on use, so the new one is stored at once.
func (s *Service) Token(ctx context.Context, userID uuid.UUID, id string) (string, error) {
	return s.tokenFor(ctx, userID, id, "")
}

func (s *Service) tokenFor(ctx context.Context, userID uuid.UUID, id, rejected string) (string, error) {
	p, err := s.provider(id)
	if err != nil {
		return "", err
	}
	defer s.lock(userID, id)()
	c, err := s.store.Get(ctx, userID, id)
	if err != nil {
		return "", err
	}
	if c.NeedsReconnect {
		return "", ErrNeedsReconnect
	}
	fresh := c.ExpiresAt == nil || c.ExpiresAt.After(s.now().Add(time.Minute))
	if c.AccessToken != "" && c.AccessToken != rejected && (fresh || c.RefreshToken == "") {
		return c.AccessToken, nil
	}
	if c.RefreshToken == "" {
		_ = s.store.MarkNeedsReconnect(ctx, userID, id, "the access token stopped working")
		return "", ErrNeedsReconnect
	}
	tok, err := s.token(ctx, p, map[string]string{"grant_type": "refresh_token", "refresh_token": c.RefreshToken})
	var te *tokenError
	if errors.As(err, &te) && te.Status >= 400 && te.Status < 500 {
		_ = s.store.MarkNeedsReconnect(ctx, userID, id, "the app refused the refresh token")
		return "", ErrNeedsReconnect
	}
	if err != nil {
		return "", err
	}
	refresh := str(tok, "refresh_token")
	if refresh == "" {
		refresh = c.RefreshToken
	}
	if err := s.store.SaveTokens(ctx, userID, id, str(tok, "access_token"), refresh, s.expiry(tok)); err != nil {
		return "", err
	}
	return str(tok, "access_token"), nil
}

// Do sends one request with the learner's token; a 401 refreshes once and
// sends again, a second marks the connection for reconnecting.
func (s *Service) Do(ctx context.Context, userID uuid.UUID, id string, send func(tok string) (*http.Response, error)) (*http.Response, error) {
	tok, err := s.Token(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	resp, err := send(tok)
	if err != nil || resp.StatusCode != http.StatusUnauthorized {
		return resp, err
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	resp.Body.Close()
	if tok, err = s.tokenFor(ctx, userID, id, tok); err != nil {
		return nil, err
	}
	resp, err = send(tok)
	if err == nil && resp.StatusCode == http.StatusUnauthorized {
		_ = s.store.MarkNeedsReconnect(ctx, userID, id, "the app refused the access token")
	}
	return resp, err
}

// Disconnect revokes the grant (best effort) and forgets it.
func (s *Service) Disconnect(ctx context.Context, userID uuid.UUID, id string) error {
	p, perr := s.provider(id)
	c, err := s.store.Get(ctx, userID, id)
	if errors.Is(err, ErrNotConnected) {
		return nil
	}
	if err != nil {
		return err
	}
	if perr == nil && p.RevokeURL != "" {
		token := c.RefreshToken
		if token == "" {
			token = c.AccessToken
		}
		if err := s.revoke(ctx, p, token); err != nil {
			slog.Warn("appconn: revoke failed; forgetting the grant anyway", "app", id, "error", err)
		}
	}
	return s.store.Delete(ctx, userID, id)
}

func (s *Service) revoke(ctx context.Context, p Provider, token string) error {
	var body io.Reader
	contentType := "application/x-www-form-urlencoded"
	if p.JSONBody {
		b, _ := json.Marshal(map[string]string{"token": token})
		body, contentType = strings.NewReader(string(b)), "application/json"
	} else {
		body = strings.NewReader(url.Values{"token": {token}}.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.RevokeURL, body)
	if err != nil {
		return err
	}
	req.SetBasicAuth(p.ClientID, p.ClientSecret)
	req.Header.Set("Content-Type", contentType)
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("appconn: revoke answered %d", resp.StatusCode)
	}
	return nil
}

// Status is one app as one learner sees it.
type Status struct {
	ID             string     `json:"id"`
	Configured     bool       `json:"configured"`
	Connected      bool       `json:"connected"`
	Account        string     `json:"account,omitempty"`
	NeedsReconnect bool       `json:"needs_reconnect"`
	ConnectedAt    *time.Time `json:"connected_at,omitempty"`
}

// Status reports one app.
func (s *Service) Status(ctx context.Context, userID uuid.UUID, id string) (*Status, error) {
	p, ok := s.providers[id]
	if !ok {
		return nil, ErrUnknownProvider
	}
	out := &Status{ID: id, Configured: p.Configured()}
	c, err := s.store.Get(ctx, userID, id)
	if errors.Is(err, ErrNotConnected) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	at := c.ConnectedAt
	out.Connected, out.Account, out.NeedsReconnect, out.ConnectedAt = true, c.AccountLabel, c.NeedsReconnect, &at
	return out, nil
}
