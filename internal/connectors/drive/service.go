package drive

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Service is the Drive connector's application logic.
type Service struct {
	store    Store
	importer Importer
	authz    Authorizer
	oauth    OAuthConfig
	// storage is the learner's Drive as file storage, nil until UseStorage.
	storage *Storage
	// lostAccess runs when AnyTools can no longer reach a learner's Drive
	// (disconnected, or the grant refused); nil until OnLostAccess.
	lostAccess func(userID uuid.UUID)

	// baseURL points the Drive REST client somewhere else in tests.
	baseURL string
	// maxImportBytes mirrors the Knowledge Center's upload cap. It is passed in
	// rather than imported so this package does not depend on internal/knowledge
	// for one constant; the pipeline enforces the real limit either way, and
	// this one stops a 2 GB file being pulled into memory before it gets there.
	maxImportBytes int64
	now            func() time.Time

	// refreshMu serialises token refreshes PER USER.
	//
	// Phase 4 measured what happens without it on the BYOK lanes: five
	// concurrent refreshes on one connection produce one accepted token and
	// four invalid_grant rejections, each of which then marks the connection as
	// needing reconnect — so concurrency alone disconnects a working account.
	// The sync job and a "Sync now" click can easily overlap, so the same
	// hazard exists here. A process-local mutex is enough because the API is
	// single-replica by rule (docs/architecture.md); if that ever changes this
	// becomes the advisory lock internal/store/pg/oauth_connection_locks.go
	// already provides.
	refreshMu sync.Map // uuid.UUID -> *sync.Mutex
}

// Config assembles a Service.
type Config struct {
	Store    Store
	Importer Importer
	Authz    Authorizer
	OAuth    OAuthConfig
	// BaseURL overrides Google's Drive API endpoint. Tests point it at a
	// recorded-fixture server; production leaves it empty.
	BaseURL string
	// MaxImportBytes caps one downloaded file. Zero takes the default below.
	MaxImportBytes int64
	Now            func() time.Time
}

// defaultMaxImportBytes matches knowledge.MaxUploadBytes. A Drive file larger
// than the pipeline would accept from an upload is refused before it is
// downloaded, not after.
const defaultMaxImportBytes = 50 << 20

// NewService returns a Service.
func NewService(cfg Config) *Service {
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &Service{
		store:          cfg.Store,
		importer:       cfg.Importer,
		authz:          cfg.Authz,
		oauth:          cfg.OAuth,
		baseURL:        cfg.BaseURL,
		maxImportBytes: cfg.MaxImportBytes,
		now:            now,
	}
}

// UseKnowledge hands the connector the Knowledge Center's import and
// authorization. The connector is built before the Knowledge Center, because
// a learner's files may live in their Drive (storage.go) and the Knowledge
// Center's file store is built over it; internal/app calls this once,
// before serving.
func (s *Service) UseKnowledge(importer Importer, authz Authorizer) {
	s.importer, s.authz = importer, authz
}

// UseStorage tells the connector that learners' own files may be kept in
// their Drives through st (drive-user-storage phase 3): Status then counts
// them, and a reconnect finds their folders again.
func (s *Service) UseStorage(st *Storage) { s.storage = st }

// OnLostAccess sets what runs when AnyTools can no longer reach a learner's
// Drive: a disconnect, or a grant Google refused (phase 3). internal/app
// removes the learner's cached copies of their Drive files, so nothing is
// served from the server that their Drive would not give now.
func (s *Service) OnLostAccess(fn func(userID uuid.UUID)) { s.lostAccess = fn }

func (s *Service) accessLost(userID uuid.UUID) {
	if s.lostAccess != nil {
		s.lostAccess(userID)
	}
}

// Configured reports whether the API has Google client credentials at all.
func (s *Service) Configured() bool { return s.oauth.Configured() }

// ───────────────────────────────────────────────────────────────── status

// Status is what GET /v1/connectors/drive/status answers, and what the
// readiness matrix reads.
type Status struct {
	Connected      bool       `json:"connected"`
	Configured     bool       `json:"configured"`
	Email          string     `json:"email,omitempty"`
	Scope          string     `json:"scope,omitempty"`
	NeedsReconnect bool       `json:"needs_reconnect"`
	LastError      string     `json:"last_error,omitempty"`
	ConnectedAt    *time.Time `json:"connected_at,omitempty"`
	Sync           *SyncState `json:"sync,omitempty"`
	// Grants counts what is being kept in sync, so the Settings row can say
	// something true without listing every file.
	Grants  int `json:"grants"`
	RePick  int `json:"re_pick"`
	Removed int `json:"removed"`
	// FilesInDrive and BytesInDrive count the learner's own files kept in
	// their Drive (drive-user-storage phase 3). The disconnect page warns
	// when they are not zero: AnyTools cannot open those files until the
	// learner reconnects. They count while disconnected too.
	FilesInDrive int   `json:"files_in_drive"`
	BytesInDrive int64 `json:"bytes_in_drive"`
}

// Status reports the connector's state for one user.
func (s *Service) Status(ctx context.Context, userID uuid.UUID) (*Status, error) {
	out := &Status{Configured: s.oauth.Configured()}
	if s.storage != nil {
		n, b, err := s.storage.usage(ctx, userID)
		if err != nil {
			return nil, err
		}
		out.FilesInDrive, out.BytesInDrive = n, b
	}

	conn, err := s.store.GetConnection(ctx, userID)
	if errors.Is(err, ErrNotConnected) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}

	out.Connected = true
	out.Email = conn.Email
	out.Scope = conn.Scope
	out.NeedsReconnect = conn.NeedsReconnect
	out.LastError = conn.LastError
	connectedAt := conn.ConnectedAt
	out.ConnectedAt = &connectedAt

	if st, err := s.store.GetSyncState(ctx, userID); err == nil && st != nil {
		out.Sync = st
	}

	grants, err := s.store.ListGrants(ctx, userID, nil)
	if err != nil {
		return nil, err
	}
	for _, g := range grants {
		switch g.State {
		case GrantRePick:
			out.RePick++
		case GrantRemoved:
			out.Removed++
		default:
			out.Grants++
		}
	}
	return out, nil
}

// ReadinessLine is the one sentence the readiness matrix shows.
//
// "Drive: reconnect needed" is the phrase the plan specifies and the only one
// that tells the user what to do; the others exist so the row is never blank.
func (st *Status) ReadinessLine() (status, reason string) {
	switch {
	case !st.Configured:
		return "warn", "Drive: not configured on this deployment."
	case !st.Connected:
		return "warn", "Drive: not connected."
	case st.NeedsReconnect:
		return "blocked", "Drive: reconnect needed."
	case st.RePick > 0:
		return "warn", fmt.Sprintf("Drive: %d file(s) need re-picking.", st.RePick)
	case st.Sync != nil && st.Sync.LastError != "":
		return "warn", "Drive: the last sync did not finish."
	default:
		return "green", "Drive: connected."
	}
}

// ───────────────────────────────────────────────────────────── connect

// Credentials is what the BFF posts after a successful consent exchange.
type Credentials struct {
	RefreshToken string `json:"refresh_token"`
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`
	Email        string `json:"email"`
	GoogleSub    string `json:"google_sub"`
}

// Connect stores a fresh grant.
//
// A refresh token is REQUIRED. Accepting a credentials post without one would
// produce a connector that works for an hour and then fails every sync with a
// 401 the user cannot interpret; refusing it here sends them back through a
// consent that carries prompt=consent and therefore does mint one.
func (s *Service) Connect(ctx context.Context, userID uuid.UUID, creds Credentials) error {
	if strings.TrimSpace(creds.RefreshToken) == "" {
		return errors.New("drive: Google did not return a refresh token — reconnect and approve the consent screen again")
	}
	// The scope is checked rather than trusted. A grant that came back with
	// less than drive.file cannot read anything, and finding that out here is
	// better than finding it out one 403 at a time.
	if creds.Scope != "" && !strings.Contains(creds.Scope, ScopeDriveFile) {
		return fmt.Errorf("drive: the granted scope %q does not include %s", creds.Scope, ScopeDriveFile)
	}

	conn := Connection{
		UserID:       userID,
		GoogleSub:    creds.GoogleSub,
		Email:        creds.Email,
		RefreshToken: creds.RefreshToken,
		AccessToken:  creds.AccessToken,
		Scope:        creds.Scope,
	}
	if creds.ExpiresIn > 0 {
		exp := s.now().Add(time.Duration(creds.ExpiresIn) * time.Second)
		conn.ExpiresAt = &exp
	}
	if err := s.store.SaveConnection(ctx, conn); err != nil {
		return err
	}

	// A reconnect after a revoked grant has to clear the block, or readiness
	// keeps saying "reconnect needed" to a user who just did.
	slog.Info("drive: connection stored", "user", userID, "has_refresh", true)
	if s.storage != nil {
		// The files kept in Drive before are reachable again as they are;
		// this finds their folders and clears stale "removed" marks.
		s.storage.Reconnected(ctx, userID)
	}
	return nil
}

// Disconnect revokes the grant at Google and forgets it locally.
//
// The revoke runs FIRST and its failure does not stop the delete. A user who
// presses Disconnect has decided; leaving the row behind because Google was
// briefly unreachable would mean the button does nothing and they press it
// again. The reverse order is the one that leaks: a deleted row with a live
// token at Google that nothing on this side can ever withdraw.
func (s *Service) Disconnect(ctx context.Context, userID uuid.UUID) error {
	conn, err := s.store.GetConnection(ctx, userID)
	if err != nil && !errors.Is(err, ErrNotConnected) {
		return err
	}
	if conn != nil {
		if err := s.oauth.Revoke(ctx, conn.RefreshToken); err != nil {
			slog.Warn("drive: revoking the token at Google failed; deleting the local grant anyway",
				"error", err, "user", userID)
		}
	}
	if err := s.store.DeleteConnection(ctx, userID); err != nil {
		return err
	}
	// The files kept in the learner's Drive stay there, and so do the rows
	// that say where they are, for a reconnect; the server's copies go.
	s.accessLost(userID)
	return nil
}

// ───────────────────────────────────────────────────────────────── tokens

// client returns a Drive client whose token refreshes underneath it, and
// which answers a 401 the way Storage does (drive-user-storage phase 5).
func (s *Service) client(userID uuid.UUID) *Client {
	c := NewClient(s.baseURL, nil)
	c.authorize = func(ctx context.Context, send func(tok string) (*http.Response, error)) (*http.Response, string, error) {
		return s.authorized(ctx, userID, send)
	}
	return c
}

// authorized sends one request with userID's access token. On a 401 it
// refreshes once (refreshRejected) and sends again; a second 401 means the
// grant itself is no longer honoured, and rejectGrant marks the connection
// needs_reconnect. It returns the token the answer came with, so the caller
// can scrub it from an error message.
//
// send builds a fresh request each time, so a retry never reuses a body the
// transport may still be reading. The errors are the connector's own
// (ErrNeedsReconnect, ErrNotConnected); Storage turns them into
// blob.ErrReconnect, import and sync use them as they are.
func (s *Service) authorized(ctx context.Context, userID uuid.UUID, send func(tok string) (*http.Response, error)) (*http.Response, string, error) {
	tok, err := s.accessToken(ctx, userID)
	if err != nil {
		return nil, "", err
	}
	resp, err := send(tok)
	if err != nil || resp.StatusCode != http.StatusUnauthorized {
		return resp, tok, err
	}
	// The access token was revoked or expired before the time Google gave
	// for it. One refresh and one retry.
	drain(resp)
	if tok, err = s.refreshRejected(ctx, userID, tok); err != nil {
		return nil, "", err
	}
	if resp, err = send(tok); err != nil || resp.StatusCode != http.StatusUnauthorized {
		return resp, tok, err
	}
	drain(resp)
	return nil, tok, s.rejectGrant(ctx, userID)
}

// accessToken returns a usable access token, refreshing when it must.
func (s *Service) accessToken(ctx context.Context, userID uuid.UUID) (string, error) {
	mu := s.userMutex(userID)
	mu.Lock()
	defer mu.Unlock()

	conn, err := s.store.GetConnection(ctx, userID)
	if err != nil {
		return "", err
	}
	if conn.NeedsReconnect {
		return "", ErrNeedsReconnect
	}
	// A minute of headroom: a token that expires mid-request is a 401 the
	// caller has to interpret, and the whole point of refreshing early is that
	// nobody has to.
	if conn.AccessToken != "" && conn.ExpiresAt != nil && conn.ExpiresAt.After(s.now().Add(time.Minute)) {
		return conn.AccessToken, nil
	}
	return s.refreshLocked(ctx, userID, conn)
}

// refreshRejected returns a new access token after Drive answered 401 to
// rejected: revoked, or expired before the time Google gave for it
// (drive-user-storage phase 3). If another request already replaced it, that
// token is used; otherwise the grant is refreshed now, whatever its expiry
// says.
func (s *Service) refreshRejected(ctx context.Context, userID uuid.UUID, rejected string) (string, error) {
	mu := s.userMutex(userID)
	mu.Lock()
	defer mu.Unlock()

	conn, err := s.store.GetConnection(ctx, userID)
	if err != nil {
		return "", err
	}
	if conn.NeedsReconnect {
		return "", ErrNeedsReconnect
	}
	if conn.AccessToken != "" && conn.AccessToken != rejected &&
		conn.ExpiresAt != nil && conn.ExpiresAt.After(s.now().Add(time.Minute)) {
		return conn.AccessToken, nil
	}
	return s.refreshLocked(ctx, userID, conn)
}

// rejectGrant records a grant whose freshly refreshed token Drive refused as
// well: nothing but a new consent will fix it. It returns ErrNeedsReconnect.
func (s *Service) rejectGrant(ctx context.Context, userID uuid.UUID) error {
	reason := "Google stopped accepting this connection. Reconnect Drive to continue."
	if err := s.store.MarkNeedsReconnect(ctx, userID, reason); err != nil {
		slog.Error("drive: could not record that the grant needs reconnecting", "error", err, "user", userID)
	}
	s.accessLost(userID)
	return ErrNeedsReconnect
}

// refreshLocked trades the refresh token for a new access token and stores
// it. The caller holds the user's mutex.
func (s *Service) refreshLocked(ctx context.Context, userID uuid.UUID, conn *Connection) (string, error) {
	tok, err := s.oauth.Refresh(ctx, conn.RefreshToken)
	if err != nil {
		if isGrantRejected(err) {
			// Only a rejected GRANT gets here. A 500 or a timeout leaves the
			// connection alone, because telling a user with a perfectly good
			// account to reconnect is a worse failure than one sync that did
			// not run.
			var apiErr *APIError
			_ = errors.As(err, &apiErr)
			reason := "Google rejected this connection. Reconnect Drive to continue syncing."
			if merr := s.store.MarkNeedsReconnect(ctx, userID, reason); merr != nil {
				slog.Error("drive: could not record that the grant needs reconnecting", "error", merr, "user", userID)
			}
			s.accessLost(userID)
			return "", ErrNeedsReconnect
		}
		return "", fmt.Errorf("drive: refreshing the access token: %w", err)
	}

	if err := s.store.SaveAccessToken(ctx, userID, tok.AccessToken, tok.Expiry); err != nil {
		// The token is good even if storing it failed; using it now and
		// refreshing again next time is better than failing the sync.
		slog.Error("drive: could not store the refreshed access token", "error", err, "user", userID)
	}
	return tok.AccessToken, nil
}

// PickerToken returns an access token for the Google Picker in the browser.
//
// The Picker is a Google-hosted widget that needs the user's OAuth token
// client-side (PickerBuilder.setOAuthToken); there is no server-side way to
// show it. What leaves this process is the ACCESS token only — an hour of
// drive.file, which can read nothing but what this user has already picked —
// and never the refresh token, which stays encrypted in the store.
func (s *Service) PickerToken(ctx context.Context, userID uuid.UUID) (string, error) {
	if !s.oauth.Configured() {
		return "", ErrNotConfigured
	}
	return s.accessToken(ctx, userID)
}

func (s *Service) userMutex(userID uuid.UUID) *sync.Mutex {
	v, _ := s.refreshMu.LoadOrStore(userID, &sync.Mutex{})
	return v.(*sync.Mutex)
}

// ListGrants returns a knowledge base's grants, after checking ownership.
func (s *Service) ListGrants(ctx context.Context, userID, kbID uuid.UUID) ([]Grant, error) {
	if err := s.authz.OwnsKB(ctx, userID, kbID); err != nil {
		return nil, err
	}
	grants, err := s.store.ListGrants(ctx, userID, &kbID)
	if err != nil {
		return nil, err
	}
	if grants == nil {
		grants = []Grant{}
	}
	return grants, nil
}
