package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/store"
)

// RefreshFunc exchanges a refresh token for a fresh pair. Injectable so the
// concurrency test can count calls without touching a live provider — the real
// implementations rotate their refresh tokens, so running one against the
// owner's account would invalidate the credential their other tools hold.
type RefreshFunc func(ctx context.Context, flow Flow, refreshToken string) (*TokenResult, error)

// ReconnectNotifier is told when a connection's refresh has failed permanently
// and the user must reconnect.
//
// postclaw routes this through a whole internal/notify package with dispatchers
// and sinks; AnyTools' Settings page reads the flag off the connection, so the
// default implementation writes it and does nothing else.
type ReconnectNotifier interface {
	NeedsReconnect(ctx context.Context, userID, connectionID uuid.UUID, reason string)
}

// Service mints access tokens for subscription-lane connections.
type Service struct {
	creds   store.OAuthCredentialStore
	conns   store.ProviderConnectionStore
	locker  store.OAuthConnectionLocker
	refresh RefreshFunc
	notify  ReconnectNotifier
	now     func() time.Time
}

// ErrNoLocker is returned by NewService when no advisory locker is supplied.
var ErrNoLocker = errors.New("oauth: a connection locker is required")

// NewService builds the token service.
//
// locker is REQUIRED and nil is an error, not a default. This is the single
// most important line in the package, and it is a measured decision rather than
// a stylistic one (reports/spike-providers.md, "Concurrency"): postclaw's
// locker is a package global consulted as `if connectionLocker != nil`, and
// with it unset five simultaneous callers produced ONE accepted refresh and
// FOUR `invalid_grant` rejections — each of which postclaw turns into
// markNeedsReconnect. An unsynchronised refresh therefore self-destructs a
// perfectly healthy connection, silently, with zero warnings logged. Making nil
// a construction error means that configuration cannot be reached.
func NewService(creds store.OAuthCredentialStore, conns store.ProviderConnectionStore, locker store.OAuthConnectionLocker, refresh RefreshFunc, notify ReconnectNotifier) (*Service, error) {
	if locker == nil {
		return nil, ErrNoLocker
	}
	if refresh == nil {
		refresh = DefaultRefresh
	}
	if notify == nil {
		notify = noopNotifier{}
	}
	return &Service{creds: creds, conns: conns, locker: locker, refresh: refresh, notify: notify, now: time.Now}, nil
}

// AccessToken returns a usable access token for a subscription connection,
// refreshing it first when it is about to expire.
//
// The control flow, and why each branch is what it is:
//
//  1. Not near expiry → return the stored token. No lock, no network.
//  2. Near expiry → take the advisory lock. Exactly one process refreshes.
//  3. RE-READ INSIDE THE LOCK. This is the spike's finding (d): the lock
//     SERIALISES but does not DEDUPLICATE. With the lock held and callers
//     arriving 120 ms apart, five callers produced five refreshes and five
//     rotated tokens — each one waited its turn and then refreshed a token the
//     previous holder had already replaced. Re-reading and bailing out when the
//     stored expiry has moved is what turns serialisation into deduplication.
//  4. Lost the race → re-read once and serve whatever the winner stored.
//  5. Lock infrastructure error → serve the token in hand and do NOT refresh.
//     postclaw falls through UNLOCKED here, which degrades a flaky lock store
//     straight back to the self-destructing behaviour in (0). Declining to
//     refresh costs one expired-token 401, which the chain handles; refreshing
//     without the lock costs the connection.
func (s *Service) AccessToken(ctx context.Context, userID, connectionID uuid.UUID) (string, error) {
	cred, err := s.creds.GetOAuthCredential(ctx, userID, connectionID)
	if err != nil {
		return "", err
	}
	if !s.needsRefresh(cred) {
		return cred.AccessToken, nil
	}
	if cred.RefreshToken == "" {
		// Nothing to refresh with. Serve what we have; the provider will say
		// whether it is still good, and a 401 there is classified normally.
		return cred.AccessToken, nil
	}

	acquired, lockErr := s.locker.TryAcquireConnectionLock(ctx, connectionID)
	if lockErr != nil {
		slog.Error("oauth: connection lock unavailable — declining to refresh unlocked",
			"connection", connectionID, "error", lockErr)
		return cred.AccessToken, nil
	}
	if !acquired {
		// Another process is refreshing right now. Re-read: it may already have
		// committed, in which case this caller gets the fresh token rather than
		// a doomed one.
		if fresh, err := s.creds.GetOAuthCredential(ctx, userID, connectionID); err == nil {
			return fresh.AccessToken, nil
		}
		return cred.AccessToken, nil
	}
	defer func() {
		relCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if err := s.locker.ReleaseConnectionLock(relCtx, connectionID); err != nil {
			slog.Error("oauth: release connection lock", "connection", connectionID, "error", err)
		}
	}()

	// (3) The in-lock re-read.
	cred, err = s.creds.GetOAuthCredential(ctx, userID, connectionID)
	if err != nil {
		return "", err
	}
	if !s.needsRefresh(cred) {
		return cred.AccessToken, nil
	}

	conn, err := s.conns.GetConnection(ctx, userID, connectionID)
	if err != nil {
		return "", err
	}
	flow := Flow(conn.Settings.OAuth.FlowOrEmpty())

	res, err := s.refresh(ctx, flow, cred.RefreshToken)
	if err != nil {
		if IsPermanentGrantFailure(err) {
			s.notify.NeedsReconnect(ctx, userID, connectionID, err.Error())
		}
		// Transient or permanent, the answer to the caller is the same: serve
		// the token in hand and let the provider adjudicate it.
		slog.Warn("oauth: refresh failed", "connection", connectionID, "flow", flow, "error", err)
		return cred.AccessToken, nil
	}

	var expires *time.Time
	if !res.ExpiresAt.IsZero() {
		expires = &res.ExpiresAt
	}
	if err := s.creds.SaveOAuthCredential(ctx, userID, connectionID, res.AccessToken, res.RefreshToken, expires); err != nil {
		// The new token is live at the provider whether or not the write
		// succeeded, and the OLD refresh token is now dead (both lanes rotate).
		// Returning the new access token at least lets this request succeed;
		// losing it entirely would strand the connection.
		slog.Error("oauth: could not persist refreshed token — the rotated refresh token may be lost",
			"connection", connectionID, "error", err)
	}
	return res.AccessToken, nil
}

func (s *Service) needsRefresh(cred *store.OAuthCredential) bool {
	if cred.ExpiresAt == nil {
		// No expiry recorded means a long-lived token; refreshing on every call
		// would rotate a working credential for nothing.
		return false
	}
	return cred.ExpiresAt.Sub(s.now()) <= ServeRefreshLead
}

// TokenSourceFor adapts a connection to providers.TokenSource, which is what
// the Codex and Code Assist clients take.
//
// The closure captures the user id, so a provider built for one user can never
// mint a token for another even if the connection id were somehow wrong.
func (s *Service) TokenSourceFor(ctx context.Context, userID, connectionID uuid.UUID) tokenSourceFunc {
	return func() (string, error) {
		tok, err := s.AccessToken(ctx, userID, connectionID)
		if err != nil {
			return "", err
		}
		if tok == "" {
			return "", fmt.Errorf("oauth: connection %s has no access token — reconnect it", connectionID)
		}
		return tok, nil
	}
}

type tokenSourceFunc func() (string, error)

func (f tokenSourceFunc) Token() (string, error) { return f() }

type noopNotifier struct{}

func (noopNotifier) NeedsReconnect(context.Context, uuid.UUID, uuid.UUID, string) {}

// StoreNotifier records the needs-reconnect flag on the connection itself, which
// is where the Settings page and the readiness matrix read it from.
type StoreNotifier struct {
	Conns store.ProviderConnectionStore
}

func (n StoreNotifier) NeedsReconnect(ctx context.Context, userID, connectionID uuid.UUID, reason string) {
	slog.Warn("oauth: connection needs reconnect", "connection", connectionID, "reason", reason)
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()

	// The settings merge is SHALLOW (`settings || patch`), so writing
	// `{"oauth":{"needs_reconnect":true}}` would REPLACE the whole oauth object
	// and take the flow name, device id, account id and project id with it —
	// leaving a connection that could never be refreshed again because nothing
	// knew which lane it belonged to. Read, set the one field, write the whole
	// object back.
	conn, err := n.Conns.GetConnection(writeCtx, userID, connectionID)
	if err != nil {
		slog.Error("oauth: could not read connection to flag it for reconnect",
			"connection", connectionID, "error", err)
		return
	}
	meta := conn.Settings.OAuth
	if meta == nil {
		meta = &store.OAuthMeta{}
	}
	meta.NeedsReconnect = true

	patch, err := json.Marshal(map[string]any{"oauth": meta})
	if err != nil {
		slog.Error("oauth: marshal reconnect patch", "connection", connectionID, "error", err)
		return
	}
	if err := n.Conns.MergeConnectionSettings(writeCtx, userID, connectionID, patch); err != nil {
		slog.Error("oauth: could not flag connection for reconnect", "connection", connectionID, "error", err)
	}
	if err := n.Conns.SetVerifyResult(writeCtx, userID, connectionID, nil, "This connection must be reconnected."); err != nil {
		slog.Error("oauth: could not clear verification", "connection", connectionID, "error", err)
	}
}

// SaveTokens stores a connection's token pair. Used when a lane is first
// connected; afterwards AccessToken owns every write, under the lock.
func (s *Service) SaveTokens(ctx context.Context, userID, connectionID uuid.UUID, access, refresh string, expiresAt *time.Time) error {
	return s.creds.SaveOAuthCredential(ctx, userID, connectionID, access, refresh, expiresAt)
}
