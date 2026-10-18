package drive

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// store.go — the persistence and import surfaces this connector consumes.
//
// Both are declared HERE, by the consumer, for the reason internal/knowledge
// gives in its own ports.go: the package that needs a capability is the one
// that knows its contract, and a consumer-defined interface can be faked in a
// test without a database. internal/store/pg/drive.go supplies the real Store;
// internal/app/wire_drive.go supplies the real Importer over
// knowledge.Service.ImportExternal.

// Grant states. A grant is the record of what the user handed this app through
// the Picker — under `drive.file` there is no other way for the app to see a
// file at all, so this list is the whole of what may be read.
const (
	// GrantActive: in scope, synced.
	GrantActive = "active"
	// GrantRePick: Google answered 403 insufficientFilePermissions. The app no
	// longer has this file and no retry will change that — the user must pick
	// it again. The spike proved this classifies as Forbidden and NOT as Gone,
	// so it must never trigger a change-feed re-baseline.
	GrantRePick = "re-pick"
	// GrantRemoved: trashed or deleted in Drive.
	GrantRemoved = "removed"
)

// Grant kinds.
const (
	KindFile   = "file"
	KindFolder = "folder"
)

// Connection is one user's Google Drive grant.
//
// The token fields hold PLAINTEXT and exist only in memory: the store
// encrypts on the way in and decrypts on the way out. Nothing in this package
// logs a Connection value.
type Connection struct {
	UserID       uuid.UUID
	GoogleSub    string
	Email        string
	RefreshToken string
	AccessToken  string
	ExpiresAt    *time.Time
	Scope        string

	NeedsReconnect bool
	LastError      string
	ConnectedAt    time.Time
	UpdatedAt      time.Time
}

// Grant is one picked file or folder.
type Grant struct {
	ID           uuid.UUID  `json:"id"`
	UserID       uuid.UUID  `json:"-"`
	KBID         uuid.UUID  `json:"kb_id"`
	FileID       string     `json:"file_id"`
	Kind         string     `json:"kind"`
	ParentFileID string     `json:"parent_file_id,omitempty"`
	Name         string     `json:"name"`
	MIME         string     `json:"mime"`
	MD5          string     `json:"-"`
	ModifiedTime string     `json:"modified_time,omitempty"`
	State        string     `json:"state"`
	LastError    string     `json:"last_error,omitempty"`
	DocumentID   *uuid.UUID `json:"document_id,omitempty"`
	GrantedAt    time.Time  `json:"granted_at"`
	SyncedAt     *time.Time `json:"synced_at,omitempty"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// SyncState is the per-user `changes.list` checkpoint.
//
// Per USER and not per knowledge base, because Drive's change feed is
// account-wide: one token covers every file the app can see, whichever KB its
// grant belongs to.
type SyncState struct {
	UserID         uuid.UUID  `json:"-"`
	StartPageToken string     `json:"-"`
	LastSyncAt     *time.Time `json:"last_sync_at,omitempty"`
	LastError      string     `json:"last_error,omitempty"`
	Rebaselines    int        `json:"rebaselines"`
}

// Store is the connector's persistence surface.
//
// Every method takes the authenticated user id explicitly and every query is
// scoped by it — the rule internal/authz states and the reason it is a package:
// an id that came from a URL path is not evidence of ownership.
type Store interface {
	// GetConnection returns ErrNotConnected when the user has no grant.
	GetConnection(ctx context.Context, userID uuid.UUID) (*Connection, error)
	SaveConnection(ctx context.Context, conn Connection) error
	// SaveAccessToken records a refreshed access token without touching the
	// refresh token, which Google does not re-mint on a refresh.
	SaveAccessToken(ctx context.Context, userID uuid.UUID, access string, expiresAt time.Time) error
	MarkNeedsReconnect(ctx context.Context, userID uuid.UUID, reason string) error
	DeleteConnection(ctx context.Context, userID uuid.UUID) error
	// ListConnectedUsers names everyone the periodic sync should visit.
	ListConnectedUsers(ctx context.Context) ([]uuid.UUID, error)

	UpsertGrant(ctx context.Context, g Grant) (*Grant, error)
	// ListGrants returns a knowledge base's grants; a nil kbID returns all of
	// this user's.
	ListGrants(ctx context.Context, userID uuid.UUID, kbID *uuid.UUID) ([]Grant, error)
	// ListActiveFileGrants returns every active file grant of a user, across
	// knowledge bases — the set the change feed is matched against.
	ListActiveFileGrants(ctx context.Context, userID uuid.UUID) ([]Grant, error)
	SetGrantState(ctx context.Context, userID, grantID uuid.UUID, state, lastError string) error
	RecordGrantSynced(ctx context.Context, userID, grantID uuid.UUID, documentID uuid.UUID, md5, modifiedTime string) error

	GetSyncState(ctx context.Context, userID uuid.UUID) (*SyncState, error)
	SaveSyncState(ctx context.Context, st SyncState) error
}

// ImportRequest is one Drive file on its way into the phase 5 pipeline.
type ImportRequest struct {
	UserID uuid.UUID
	KBID   uuid.UUID
	// ExternalID is the Drive file id, stored on documents.drive_file_id. It is
	// what makes a re-import an UPDATE of the same document rather than a
	// second copy of it.
	ExternalID string
	// Filename carries the EXTENSION the pipeline detects the type from. A
	// Google Doc arrives here as "<name>.md" because it was exported to
	// Markdown; a PDF arrives with its own name.
	Filename string
	Data     []byte
}

// Importer hands a file to the Knowledge Center.
//
// One method, and it returns the document id so a grant can point at the
// document it produced. Everything the pipeline does afterwards — parse, chunk,
// embed, status — belongs to phase 5 and is not this connector's business.
type Importer interface {
	Import(ctx context.Context, req ImportRequest) (uuid.UUID, error)
}

// Authorizer answers whether a user owns a knowledge base.
//
// Consumer-defined so this package does not import internal/authz and does not
// need a database to test the check is made. wire_drive.go passes the real
// *authz.Authorizer.
type Authorizer interface {
	OwnsKB(ctx context.Context, user, kbID uuid.UUID) error
}
