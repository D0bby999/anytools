// Package account deletes a user and everything that belongs to them.
package account

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/store/kbindex"
)

// Deletion order, and why:
//
//  1. Revoke grants at the providers FIRST, while the tokens are still readable.
//     Once the rows are gone nothing on this side can withdraw them, and a live
//     refresh token would sit in the user's Google account permissions with no
//     owner. A revocation that fails is logged and does not stop the deletion:
//     the user asked for their data to be gone, and a provider outage must not
//     keep it.
//  2. Delete the user row. Every table references users(id) ON DELETE CASCADE
//     (a test asserts this for every migration), so one statement removes
//     documents, chunks, chats, keys, notes and the learning record together.
//  3. Delete the files. After the rows, so a failure leaves unreachable files,
//     never rows pointing at files that are gone.
//
// Files a learner kept in their own Google Drive are NOT deleted (owner
// decision 1 of drive-user-storage). Their "AnyTools" folder belongs to them
// and stays after the account is gone. Deleting the user row removes
// drive_files and drive_folders by cascade; FileStore.DeleteUser removes the
// server's cached copies; nothing here can reach a files.delete. The proof is
// internal/app's TestAccountDeletionLeavesTheLearnersDriveAlone, which fails
// on any DELETE sent to the fake Drive.

// DriveDisconnector revokes and removes the user's Drive grant.
type DriveDisconnector interface {
	Disconnect(ctx context.Context, userID uuid.UUID) error
}

// TokenRevoker withdraws the user's subscription-lane grants at the provider.
type TokenRevoker interface {
	RevokeAll(ctx context.Context, userID uuid.UUID) error
}

// FileStore deletes the user's uploaded and parsed files.
type FileStore interface {
	DeleteUser(ctx context.Context, userID uuid.UUID) error
}

// Service deletes accounts.
type Service struct {
	pool   *pgxpool.Pool
	files  FileStore
	drive  DriveDisconnector // nil when Drive is not configured
	tokens TokenRevoker      // nil when there is nothing to revoke
}

// New builds the service. drive and tokens may be nil.
func New(pool *pgxpool.Pool, files FileStore, drive DriveDisconnector, tokens TokenRevoker) *Service {
	return &Service{pool: pool, files: files, drive: drive, tokens: tokens}
}

// ErrNotFound is returned when the user does not exist.
var ErrNotFound = fmt.Errorf("account: not found")

// Delete removes the user and everything they own.
func (s *Service) Delete(ctx context.Context, userID uuid.UUID) error {
	if s.drive != nil {
		if err := s.drive.Disconnect(ctx, userID); err != nil {
			slog.Warn("account: drive revoke failed; deleting anyway", "user", userID, "error", err)
		}
	}
	if s.tokens != nil {
		if err := s.tokens.RevokeAll(ctx, userID); err != nil {
			slog.Warn("account: subscription token revoke failed; deleting anyway", "user", userID, "error", err)
		}
	}

	tag, err := s.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	if err != nil {
		return fmt.Errorf("account: delete user: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	// The cascade removed the learner's knowledge bases but not their vector
	// indexes, which only DDL can drop. Best effort: a leftover is swept at
	// the next deletion or boot.
	if err := kbindex.DropOrphans(ctx, s.pool); err != nil {
		slog.Warn("account: vector indexes left behind after deletion", "user", userID, "error", err)
	}

	if err := s.files.DeleteUser(ctx, userID); err != nil {
		// The account is gone; say so loudly, but do not report the deletion
		// as failed — the user would retry into a 404.
		slog.Error("account: files left behind after deletion", "user", userID, "error", err)
	}
	slog.Info("account: deleted", "user", userID)
	return nil
}
