package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/knowledge"
)

// drive.go — persistence for the Google Drive connector (phase 13).
//
// The refresh token here is the most valuable row this store writes after the
// BYOK credentials: it is a standing permission to read the user's picked Drive
// files, good until the user revokes it. Both token columns go through
// encryptOrFail, which REFUSES the write when no encryption key is configured
// rather than silently storing plaintext — the exact incident that helper was
// extracted to prevent (see encrypt_helper.go).
//
// Every query is scoped by user_id, including the ones that already have a
// unique id to work with. A grant id in a URL is not evidence of ownership.

// DriveStore persists Drive connections, grants and sync state.
type DriveStore struct {
	pool   *Pool
	encKey string
}

// NewDriveStore returns a DriveStore.
func NewDriveStore(pool *Pool, encKey string) *DriveStore {
	return &DriveStore{pool: pool, encKey: encKey}
}

var _ drive.Store = (*DriveStore)(nil)

// ─────────────────────────────────────────────────────────────── connection

func (s *DriveStore) GetConnection(ctx context.Context, userID uuid.UUID) (*drive.Connection, error) {
	var (
		c          drive.Connection
		refreshEnc string
		accessEnc  string
		expires    *time.Time
	)
	err := s.pool.QueryRow(ctx, `
        SELECT user_id, google_sub, email, refresh_enc, access_enc, expires_at, scope,
               needs_reconnect, last_error, connected_at, updated_at
        FROM drive_connections
        WHERE user_id = $1`, userID).
		Scan(&c.UserID, &c.GoogleSub, &c.Email, &refreshEnc, &accessEnc, &expires, &c.Scope,
			&c.NeedsReconnect, &c.LastError, &c.ConnectedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, drive.ErrNotConnected
	}
	if err != nil {
		return nil, fmt.Errorf("pg: get drive connection: %w", err)
	}

	if c.RefreshToken, err = decryptIfPresent(refreshEnc, s.encKey, "drive refresh"); err != nil {
		return nil, err
	}
	if c.AccessToken, err = decryptIfPresent(accessEnc, s.encKey, "drive access"); err != nil {
		return nil, err
	}
	c.ExpiresAt = expires
	return &c, nil
}

// SaveConnection writes a fresh grant, replacing whatever was there.
//
// needs_reconnect and last_error are CLEARED on every write. A user who has
// just completed consent has fixed the problem, and a readiness card still
// saying "reconnect needed" after they reconnected is worse than no card.
func (s *DriveStore) SaveConnection(ctx context.Context, conn drive.Connection) error {
	refreshEnc, err := encryptOrFail(conn.RefreshToken, s.encKey, "drive_connections.refresh_enc")
	if err != nil {
		return err
	}
	accessEnc, err := encryptOrFail(conn.AccessToken, s.encKey, "drive_connections.access_enc")
	if err != nil {
		return err
	}

	_, err = s.pool.Exec(ctx, `
        INSERT INTO drive_connections
            (user_id, google_sub, email, refresh_enc, access_enc, expires_at, scope,
             needs_reconnect, last_error, connected_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, false, '', now(), now())
        ON CONFLICT (user_id) DO UPDATE SET
            google_sub      = EXCLUDED.google_sub,
            email           = EXCLUDED.email,
            refresh_enc     = EXCLUDED.refresh_enc,
            access_enc      = EXCLUDED.access_enc,
            expires_at      = EXCLUDED.expires_at,
            scope           = EXCLUDED.scope,
            needs_reconnect = false,
            last_error      = '',
            connected_at    = now(),
            updated_at      = now()`,
		conn.UserID, conn.GoogleSub, conn.Email, refreshEnc, accessEnc, conn.ExpiresAt, conn.Scope)
	if err != nil {
		return fmt.Errorf("pg: save drive connection: %w", err)
	}
	return nil
}

// SaveAccessToken records a refreshed access token.
//
// It deliberately does not touch refresh_enc: Google does not mint a new
// refresh token on a refresh, so a statement that wrote one would write the
// empty string and disconnect the account an hour later.
func (s *DriveStore) SaveAccessToken(ctx context.Context, userID uuid.UUID, access string, expiresAt time.Time) error {
	accessEnc, err := encryptOrFail(access, s.encKey, "drive_connections.access_enc")
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `
        UPDATE drive_connections
        SET access_enc = $2, expires_at = $3, needs_reconnect = false, last_error = '', updated_at = now()
        WHERE user_id = $1`, userID, accessEnc, expiresAt)
	if err != nil {
		return fmt.Errorf("pg: save drive access token: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return drive.ErrNotConnected
	}
	return nil
}

func (s *DriveStore) MarkNeedsReconnect(ctx context.Context, userID uuid.UUID, reason string) error {
	_, err := s.pool.Exec(ctx, `
        UPDATE drive_connections
        SET needs_reconnect = true, last_error = $2, access_enc = '', expires_at = NULL, updated_at = now()
        WHERE user_id = $1`, userID, reason)
	if err != nil {
		return fmt.Errorf("pg: mark drive connection for reconnect: %w", err)
	}
	return nil
}

// DeleteConnection forgets the grant and everything that depended on it.
//
// The grants go with it. A grant is a record of permission this app no longer
// has; keeping the rows after a disconnect would leave the KB page listing
// files it can no longer read, and the next connect would resurrect a sync for
// files the user may not have re-picked. The DOCUMENTS stay — they are the
// user's, already parsed and cited, and deleting someone's knowledge base
// content because they disconnected a source would be a surprise.
func (s *DriveStore) DeleteConnection(ctx context.Context, userID uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("pg: delete drive connection: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, stmt := range []string{
		`DELETE FROM drive_grants WHERE user_id = $1`,
		`DELETE FROM drive_sync_state WHERE user_id = $1`,
		`DELETE FROM drive_connections WHERE user_id = $1`,
	} {
		if _, err := tx.Exec(ctx, stmt, userID); err != nil {
			return fmt.Errorf("pg: delete drive connection: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// ListConnectedUsers names everyone the periodic sync should visit.
//
// Users whose grant Google already rejected are excluded: every sync for them
// would spend a request to be told the same thing, and the readiness card is
// already saying it.
func (s *DriveStore) ListConnectedUsers(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT user_id FROM drive_connections WHERE needs_reconnect = false ORDER BY user_id`)
	if err != nil {
		return nil, fmt.Errorf("pg: list drive users: %w", err)
	}
	defer rows.Close()

	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("pg: list drive users: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ─────────────────────────────────────────────────────────────────── grants

const grantColumns = `id, user_id, kb_id, file_id, kind, parent_file_id, name, mime, md5,
                      modified_time, state, last_error, document_id, granted_at, synced_at, updated_at`

func scanGrant(row pgx.Row) (*drive.Grant, error) {
	var g drive.Grant
	err := row.Scan(&g.ID, &g.UserID, &g.KBID, &g.FileID, &g.Kind, &g.ParentFileID, &g.Name,
		&g.MIME, &g.MD5, &g.ModifiedTime, &g.State, &g.LastError, &g.DocumentID,
		&g.GrantedAt, &g.SyncedAt, &g.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &g, nil
}

// UpsertGrant records a pick, or refreshes one that already exists.
//
// md5, modified_time and document_id are NOT written here, and that is the
// point. They record what was successfully IMPORTED; writing the new checksum
// at pick time would make a file whose import then failed look unchanged to
// every later sync, and the document would stay missing with nothing retrying.
// Picking a file again does clear state and last_error, which is how a
// "re-pick" grant recovers.
func (s *DriveStore) UpsertGrant(ctx context.Context, g drive.Grant) (*drive.Grant, error) {
	if g.State == "" {
		g.State = drive.GrantActive
	}
	row := s.pool.QueryRow(ctx, `
        INSERT INTO drive_grants (user_id, kb_id, file_id, kind, parent_file_id, name, mime, state, last_error)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (user_id, kb_id, file_id) DO UPDATE SET
            kind           = EXCLUDED.kind,
            parent_file_id = CASE WHEN EXCLUDED.parent_file_id = '' THEN drive_grants.parent_file_id
                                  ELSE EXCLUDED.parent_file_id END,
            name           = EXCLUDED.name,
            mime           = EXCLUDED.mime,
            state          = EXCLUDED.state,
            last_error     = EXCLUDED.last_error,
            updated_at     = now()
        RETURNING `+grantColumns,
		g.UserID, g.KBID, g.FileID, g.Kind, g.ParentFileID, g.Name, g.MIME, g.State, g.LastError)

	out, err := scanGrant(row)
	if err != nil {
		return nil, fmt.Errorf("pg: upsert drive grant: %w", err)
	}
	return out, nil
}

func (s *DriveStore) ListGrants(ctx context.Context, userID uuid.UUID, kbID *uuid.UUID) ([]drive.Grant, error) {
	query := `SELECT ` + grantColumns + ` FROM drive_grants WHERE user_id = $1`
	args := []any{userID}
	if kbID != nil {
		query += ` AND kb_id = $2`
		args = append(args, *kbID)
	}
	// Folders first, then children, so the KB page can render a folder above
	// the files it contributed without sorting in the browser.
	query += ` ORDER BY (kind = 'folder') DESC, name, file_id`

	return s.queryGrants(ctx, query, args...)
}

func (s *DriveStore) ListActiveFileGrants(ctx context.Context, userID uuid.UUID) ([]drive.Grant, error) {
	return s.queryGrants(ctx, `SELECT `+grantColumns+`
        FROM drive_grants
        WHERE user_id = $1 AND kind = 'file' AND state = 'active'
        ORDER BY file_id`, userID)
}

func (s *DriveStore) queryGrants(ctx context.Context, query string, args ...any) ([]drive.Grant, error) {
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("pg: list drive grants: %w", err)
	}
	defer rows.Close()

	var out []drive.Grant
	for rows.Next() {
		g, err := scanGrant(rows)
		if err != nil {
			return nil, fmt.Errorf("pg: list drive grants: %w", err)
		}
		out = append(out, *g)
	}
	return out, rows.Err()
}

func (s *DriveStore) SetGrantState(ctx context.Context, userID, grantID uuid.UUID, state, lastError string) error {
	tag, err := s.pool.Exec(ctx, `
        UPDATE drive_grants SET state = $3, last_error = $4, updated_at = now()
        WHERE id = $1 AND user_id = $2`, grantID, userID, state, lastError)
	if err != nil {
		return fmt.Errorf("pg: set drive grant state: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return authz.ErrNoAccess
	}
	return nil
}

// RecordGrantSynced records a SUCCESSFUL import: the document it produced and
// the checksum/timestamp that mean "this version is the one indexed".
func (s *DriveStore) RecordGrantSynced(ctx context.Context, userID, grantID uuid.UUID,
	documentID uuid.UUID, md5, modifiedTime string) error {

	tag, err := s.pool.Exec(ctx, `
        UPDATE drive_grants
        SET document_id = $3, md5 = $4, modified_time = $5,
            state = 'active', last_error = '', synced_at = now(), updated_at = now()
        WHERE id = $1 AND user_id = $2`, grantID, userID, documentID, md5, modifiedTime)
	if err != nil {
		return fmt.Errorf("pg: record drive grant sync: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return authz.ErrNoAccess
	}
	return nil
}

// ─────────────────────────────────────────────────────────────── sync state

func (s *DriveStore) GetSyncState(ctx context.Context, userID uuid.UUID) (*drive.SyncState, error) {
	var st drive.SyncState
	err := s.pool.QueryRow(ctx, `
        SELECT user_id, start_page_token, last_sync_at, last_error, rebaselines
        FROM drive_sync_state WHERE user_id = $1`, userID).
		Scan(&st.UserID, &st.StartPageToken, &st.LastSyncAt, &st.LastError, &st.Rebaselines)
	if errors.Is(err, pgx.ErrNoRows) {
		// Not an error: a user who has never synced has no state, and the
		// caller's next move is to baseline.
		return &drive.SyncState{UserID: userID}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("pg: get drive sync state: %w", err)
	}
	return &st, nil
}

func (s *DriveStore) SaveSyncState(ctx context.Context, st drive.SyncState) error {
	_, err := s.pool.Exec(ctx, `
        INSERT INTO drive_sync_state (user_id, start_page_token, last_sync_at, last_error, rebaselines, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (user_id) DO UPDATE SET
            start_page_token = EXCLUDED.start_page_token,
            last_sync_at     = EXCLUDED.last_sync_at,
            last_error       = EXCLUDED.last_error,
            rebaselines      = EXCLUDED.rebaselines,
            updated_at       = now()`,
		st.UserID, st.StartPageToken, st.LastSyncAt, st.LastError, st.Rebaselines)
	if err != nil {
		return fmt.Errorf("pg: save drive sync state: %w", err)
	}
	return nil
}

// ──────────────────────────────────────────────────────── external documents

// UpsertExternalDocument creates or re-versions a connector-sourced document.
//
// The conflict target is the partial unique index on (kb_id, drive_file_id),
// which is why the predicate is repeated here: Postgres infers a partial index
// only when the statement restates its WHERE clause.
//
// On conflict this is the sanctioned way out of a terminal state, and it does
// what ResetDocumentForReprocessing does for a manual re-parse: version + 1,
// status back to `queued`, error cleared. The version bump is what makes the
// versioned parsed-Markdown path mean something — blob.PutParsed writes
// `<doc>-v<version>.md`, so a re-import that fails halfway leaves the viewer
// serving the copy the user was reading.
func (s *DriveStore) UpsertExternalDocument(ctx context.Context, d knowledge.Document, externalID string) (*knowledge.Document, error) {
	if externalID == "" {
		return nil, errors.New("pg: an external document needs a source id")
	}
	var out knowledge.Document
	err := s.pool.QueryRow(ctx, `
        INSERT INTO documents
            (user_id, kb_id, source_kind, drive_file_id, title, mime, bytes, sha256, page_count, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued')
        ON CONFLICT (kb_id, drive_file_id) WHERE drive_file_id <> '' DO UPDATE SET
            title      = EXCLUDED.title,
            mime       = EXCLUDED.mime,
            bytes      = EXCLUDED.bytes,
            sha256     = EXCLUDED.sha256,
            page_count = EXCLUDED.page_count,
            status     = 'queued',
            error      = '',
            version    = documents.version + 1,
            updated_at = now()
        -- Defence in depth behind the composite foreign key: an UPDATE that
        -- would cross users writes nothing rather than writing the wrong row.
        WHERE documents.user_id = EXCLUDED.user_id
        RETURNING id, user_id, kb_id, source_kind, title, mime, bytes, sha256, page_count,
                  status, error, processed_by, version, parsed_markdown_path, created_at, updated_at`,
		d.UserID, d.KBID, d.SourceKind, externalID, d.Title, d.MIME, d.Bytes, d.SHA256, d.PageCount).
		Scan(&out.ID, &out.UserID, &out.KBID, &out.SourceKind, &out.Title, &out.MIME, &out.Bytes,
			&out.SHA256, &out.PageCount, &out.Status, &out.Error, &out.ProcessedBy, &out.Version,
			&out.ParsedMarkdownPath, &out.CreatedAt, &out.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// The DO UPDATE's WHERE excluded the row: the document belongs to
		// someone else. Same answer as everywhere else, for the same reason —
		// distinguishing "not yours" from "does not exist" is an oracle.
		return nil, authz.ErrNoAccess
	}
	if err != nil {
		return nil, fmt.Errorf("pg: upsert external document: %w", err)
	}
	return &out, nil
}
