package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

// byok.go — the persistence surface for the user's own provider credentials.
//
// Two rules shape every signature here.
//
// First, userID is the FIRST argument of every method and is part of every
// WHERE clause, never a field the caller can forget to filter on. Red-team RT-3
// found the plan's retrieval SQL had silently dropped the user filter that the
// source it was copied from had; making the id positional means the same
// omission cannot be written.
//
// Second, a decrypted secret is only ever returned by a method whose NAME says
// so. ListConnections and GetConnection return the connection WITHOUT its
// secret, so the API handlers that serve them to a browser have nothing to
// leak; only ChainFor and SearchChain — read by the fallback chain, never by a
// response writer — carry plaintext.

// ErrConnectionNotFound is returned when no connection with that id belongs to
// that user. Deliberately one error for "does not exist" and "belongs to
// someone else": distinguishing them turns the endpoint into an existence
// oracle for other people's connections.
var ErrConnectionNotFound = errors.New("store: provider connection not found")

// ErrSearchConnectionNotFound is the same, for web-search keys.
var ErrSearchConnectionNotFound = errors.New("store: search connection not found")

// ErrDuplicateConnectionName is returned when a user already has a connection
// with that name.
var ErrDuplicateConnectionName = errors.New("store: a connection with that name already exists")

// Connection kinds. api_key holds a pasted secret; the two oauth kinds keep
// their tokens in oauth_credentials and leave secret_enc empty.
const (
	KindAPIKey         = "api_key"
	KindOAuthRelay     = "oauth_relay"
	KindOAuthGeminiSub = "oauth_gemini_sub"
	KindOAuthCopilot   = "oauth_copilot"
	KindOAuthClaudeSub = "oauth_claude_sub"
)

// VerifyStatus values persisted in ConnectionSettings.VerifyStatus.
const (
	VerifyStatusUnknown  = ""
	VerifyStatusVerified = "verified"
	VerifyStatusFailed   = "failed"
)

// ConnectionSettings is the chain's own state, stored as the `settings` jsonb
// column.
//
// It lives in jsonb rather than in columns because it is written on the hot
// failure path and read on the hot serve path, and because phases 5-9 will add
// fields without wanting a migration each time. Every field is optional: a
// connection created a second ago has an entirely zero ConnectionSettings and
// must behave exactly like one that has simply never failed.
type ConnectionSettings struct {
	// CooldownUntil benches this connection until the given time. Persisted
	// rather than held in memory because an API restart mid-cooldown would
	// otherwise resurrect a connection the provider is still refusing — the
	// phase's second success criterion.
	CooldownUntil *time.Time `json:"cooldown_until,omitempty"`
	// BackoffLevel is the persisted exponent for the rate-limit curve. Without
	// it every restart starts the curve over at two seconds.
	BackoffLevel int `json:"backoff_level,omitempty"`
	// CooldownReason is "rate_limit" or "quota", and is what the UI turns into
	// "resting" versus "quota — resets ~X".
	CooldownReason string `json:"cooldown_reason,omitempty"`

	// VerifyStatus / VerifiedModel record what the last verify ping proved.
	VerifyStatus  string `json:"verify_status,omitempty"`
	VerifiedModel string `json:"verified_model,omitempty"`

	// Dims is the embedding width this connection returned on its last embed
	// verify. Phase 5 pins a knowledge base to a width; readiness warns when
	// they disagree.
	Dims int `json:"dims,omitempty"`

	// OAuth carries the subscription lanes' non-secret token metadata. The
	// tokens themselves are in oauth_credentials; what lives here is the flow
	// name and the stable per-connection device id the Anthropic and Codex
	// request shapes require.
	OAuth *OAuthMeta `json:"oauth,omitempty"`
}

// OAuthMeta is the non-secret half of a subscription-lane connection.
type OAuthMeta struct {
	Flow           string `json:"flow,omitempty"`
	DeviceID       string `json:"device_id,omitempty"`
	AccountID      string `json:"account_id,omitempty"`
	ProjectID      string `json:"project_id,omitempty"`
	Scope          string `json:"scope,omitempty"`
	NeedsReconnect bool   `json:"needs_reconnect,omitempty"`
}

// CoolingDownAt reports whether this connection is benched at the given moment.
func (s ConnectionSettings) CoolingDownAt(now time.Time) bool {
	return s.CooldownUntil != nil && s.CooldownUntil.After(now)
}

// ProviderConnection is one credential the user connected.
type ProviderConnection struct {
	ID       uuid.UUID
	UserID   uuid.UUID
	Provider string
	Kind     string
	Name     string
	APIBase  string
	// Secret is populated ONLY by the chain-reading methods. It is empty on
	// everything a handler can reach.
	Secret     string
	Settings   ConnectionSettings
	VerifiedAt *time.Time
	LastError  string
	CreatedAt  time.Time
	UpdatedAt  time.Time
	HasSecret  bool
}

// NewProviderConnection is the input to CreateConnection. Secret is plaintext
// and is encrypted by the store — no caller may pass ciphertext, because then
// "was this encrypted?" becomes a question with two possible answers.
type NewProviderConnection struct {
	Provider string
	Kind     string
	Name     string
	APIBase  string
	Secret   string
	Settings ConnectionSettings
}

// ConnectionUpdate is the input to UpdateConnection. A nil pointer means "leave
// this field alone"; a non-nil pointer to "" means "clear it". Without that
// distinction a rename would silently blank the key.
type ConnectionUpdate struct {
	Name    *string
	APIBase *string
	Secret  *string
}

// ProviderConnectionStore persists the user's provider credentials.
type ProviderConnectionStore interface {
	CreateConnection(ctx context.Context, userID uuid.UUID, in NewProviderConnection) (*ProviderConnection, error)
	ListConnections(ctx context.Context, userID uuid.UUID) ([]ProviderConnection, error)
	GetConnection(ctx context.Context, userID uuid.UUID, id uuid.UUID) (*ProviderConnection, error)
	// GetConnectionWithSecret is the one single-row read that decrypts. Used by
	// verify, which must talk to the provider with the key the user just pasted.
	GetConnectionWithSecret(ctx context.Context, userID uuid.UUID, id uuid.UUID) (*ProviderConnection, error)
	UpdateConnection(ctx context.Context, userID uuid.UUID, id uuid.UUID, in ConnectionUpdate) (*ProviderConnection, error)
	DeleteConnection(ctx context.Context, userID uuid.UUID, id uuid.UUID) error
	// MergeConnectionSettings applies a shallow jsonb merge (`settings || patch`)
	// rather than replacing the object. Two writers touching different keys —
	// the chain persisting a cooldown while verify persists a status — must not
	// erase each other, which a read-modify-write of the whole object does.
	MergeConnectionSettings(ctx context.Context, userID uuid.UUID, id uuid.UUID, patch json.RawMessage) error
	// SetVerifyResult records the outcome of a verify ping in the two real
	// columns the list endpoint reads.
	SetVerifyResult(ctx context.Context, userID uuid.UUID, id uuid.UUID, verifiedAt *time.Time, lastError string) error
}

// CustomModelStore keeps the model ids a learner adds by hand to one of their
// connections (plan 261021-1100 phase 4). Every method is scoped to the owner:
// another user's connection id reads as not found.
type CustomModelStore interface {
	ListCustomModels(ctx context.Context, userID, connectionID uuid.UUID) ([]string, error)
	// AddCustomModel is idempotent: adding a model twice keeps one row.
	AddCustomModel(ctx context.Context, userID, connectionID uuid.UUID, model string) error
	DeleteCustomModel(ctx context.Context, userID, connectionID uuid.UUID, model string) error
}

// FunctionRoute is one entry of one function's chain, as the API returns it.
type FunctionRoute struct {
	ID           uuid.UUID
	UserID       uuid.UUID
	Function     string
	Position     int
	ConnectionID uuid.UUID
	Model        string
	Dims         int
}

// RouteEntryInput is one entry of a replacement chain.
type RouteEntryInput struct {
	ConnectionID uuid.UUID
	Model        string
	Dims         int
}

// ChainEntry is a route entry joined to its connection, WITH the decrypted
// secret. Returned only to internal/byok.
type ChainEntry struct {
	Position   int
	Model      string
	Dims       int
	Connection ProviderConnection
}

// FunctionRouteStore persists which connection serves which function.
type FunctionRouteStore interface {
	ListRoutes(ctx context.Context, userID uuid.UUID) ([]FunctionRoute, error)
	// ReplaceRoute swaps a function's whole chain in one transaction. Partial
	// updates are not offered: a chain is an ordered list, and "move entry 3 to
	// position 1" expressed as individual writes transiently violates the
	// (user, function, position) unique index.
	ReplaceRoute(ctx context.Context, userID uuid.UUID, function string, entries []RouteEntryInput) error
	ChainFor(ctx context.Context, userID uuid.UUID, function string) ([]ChainEntry, error)
}

// SearchConnection is a web-search key.
type SearchConnection struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	Provider   string
	Secret     string
	VerifiedAt *time.Time
	LastError  string
	CreatedAt  time.Time
}

// SearchConnectionStore persists BYOK web-search keys. Separate from
// ProviderConnectionStore because a search key has no model, no chain position
// and no cooldown curve (red-team RT-13).
type SearchConnectionStore interface {
	ListSearchConnections(ctx context.Context, userID uuid.UUID) ([]SearchConnection, error)
	// GetSearchConnectionWithSecret is the one single-row read that decrypts,
	// used by verify. On the interface rather than reached through a type
	// assertion: an assertion compiles against any store and fails at runtime
	// for one that happens not to implement the unpublished method.
	GetSearchConnectionWithSecret(ctx context.Context, userID uuid.UUID, id uuid.UUID) (*SearchConnection, error)
	UpsertSearchConnection(ctx context.Context, userID uuid.UUID, provider, secret string) (*SearchConnection, error)
	DeleteSearchConnection(ctx context.Context, userID uuid.UUID, id uuid.UUID) error
	SetSearchVerifyResult(ctx context.Context, userID uuid.UUID, id uuid.UUID, verifiedAt *time.Time, lastError string) error
	SearchChain(ctx context.Context, userID uuid.UUID) ([]SearchConnection, error)
}

// OAuthCredential is a subscription lane's token pair, decrypted.
type OAuthCredential struct {
	ConnectionID uuid.UUID
	UserID       uuid.UUID
	AccessToken  string
	RefreshToken string
	ExpiresAt    *time.Time
	RotatedAt    time.Time
}

// OAuthCredentialStore persists subscription-lane tokens.
type OAuthCredentialStore interface {
	GetOAuthCredential(ctx context.Context, userID uuid.UUID, connectionID uuid.UUID) (*OAuthCredential, error)
	SaveOAuthCredential(ctx context.Context, userID uuid.UUID, connectionID uuid.UUID, access, refresh string, expiresAt *time.Time) error
}

// OAuthConnectionLocker serialises token refresh across concurrent callers.
//
// It is an interface rather than an optional field for a measured reason. In
// postclaw the locker is a package global consulted as `if connectionLocker !=
// nil`, so leaving it unset silently disables the exclusive section with no
// warning. The spike ran that configuration: five simultaneous callers produced
// one accepted refresh and four `invalid_grant` rejections, each of which
// postclaw turns into markNeedsReconnect — an unsynchronised refresh
// self-destructs a healthy connection. AnyTools takes the locker as a REQUIRED
// constructor argument so nil is a programming error, not a default.
type OAuthConnectionLocker interface {
	// TryAcquireConnectionLock is non-blocking: (false, nil) means another
	// process holds it right now.
	TryAcquireConnectionLock(ctx context.Context, connectionID uuid.UUID) (bool, error)
	ReleaseConnectionLock(ctx context.Context, connectionID uuid.UUID) error
}

// FlowOrEmpty returns the flow name, tolerating a nil receiver. A connection
// created before its OAuth block was written has none, and a nil dereference on
// the serve path would be a 500 for a connection that merely needs reconnecting.
func (m *OAuthMeta) FlowOrEmpty() string {
	if m == nil {
		return ""
	}
	return m.Flow
}
