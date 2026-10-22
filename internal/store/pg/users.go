package pg

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/D0bby999/anytools/internal/store"
)

// Constraint names the concurrent-signup paths below translate. They are the
// database's last word on uniqueness, and two simultaneous first-sign-ins WILL
// reach them: both transactions read "no account for this email", both proceed,
// and one loses at COMMIT. The index keeps the data correct either way; these
// names are how the loser gets the right ERROR instead of a 500.
const (
	constraintUserEmailUnique = "users_email_unique_live"
	constraintIdentityUnique  = "user_identities_provider_subject_unique"
	sqlStateUniqueViolation   = "23505"
)

// UserStore is the pgx implementation of store.UserStore.
type UserStore struct {
	pool *Pool
}

// NewUserStore builds a UserStore over the shared pool.
func NewUserStore(pool *Pool) *UserStore { return &UserStore{pool: pool} }

var _ store.UserStore = (*UserStore)(nil)

const userColumns = `id, email, email_verified_at, display_name, created_at, deleted_at, timezone, timezone_set_at, own_version_first, file_storage, language, language_set_at, study_focus`

// UpsertIdentity applies AnyTools' account-linking policy inside one
// transaction. The policy, in order:
//
//  1. An unverified email is refused outright. A provider that will not assert
//     the address has been proven is a provider that lets anyone register it.
//  2. A known (provider, subject) is the same person signing in again: touch
//     last_login_at and return their user. This is keyed on the provider's
//     immutable subject, never on the email, so an address change at the
//     provider does not fork the account.
//  3. An unknown identity while SIGNED IN links to the session's user. The
//     browser already proved control of that account, so this is the one case
//     where joining two identities is safe.
//  4. An unknown identity while SIGNED OUT whose email already has a live
//     account is REFUSED (ErrEmailBelongsToAnotherUser). Auto-linking here is
//     the classic pre-verified-email takeover: register the victim's address at
//     any provider AnyTools trusts and inherit their account. The caller shows
//     "this email already has an account, sign in with X".
//  5. Otherwise a new user is created.
func (s *UserStore) UpsertIdentity(ctx context.Context, claims store.IdentityClaims, linkToUserID uuid.UUID) (*store.User, error) {
	if err := validateClaims(claims); err != nil {
		return nil, err
	}
	email := normalizeEmail(claims.Email)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op

	// Serialize every concurrent sign-in for THIS email address.
	//
	// Without it the policy below is a read-then-write across three statements
	// under READ COMMITTED, and concurrent callbacks interleave into wrong
	// answers. The worst was the same person's own flow finishing twice (double
	// click, two tabs): the loser's identity lookup saw nothing, its email
	// pre-check then saw the winner's just-committed user, and it refused a
	// brand-new account holder with "this email already has an account with a
	// different sign-in method" — for the provider that owned it. Reproduced
	// 10 times in 12 runs before this lock.
	//
	// Advisory, transaction-scoped, keyed on the email: released automatically
	// at commit or rollback, contends only with other sign-ins for the same
	// address, and blocks nothing else in the database.
	if _, err := tx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, email,
	); err != nil {
		return nil, fmt.Errorf("lock email for sign-in: %w", err)
	}

	// (2) Known identity — the same person signing in again.
	var existingUserID uuid.UUID
	err = tx.QueryRow(ctx,
		`UPDATE user_identities SET last_login_at = now(), email = $3
		  WHERE provider = $1 AND subject = $2
		 RETURNING user_id`,
		claims.Provider, claims.Subject, email,
	).Scan(&existingUserID)
	switch {
	case err == nil:
		user, uErr := getUserTx(ctx, tx, existingUserID)
		if uErr != nil {
			return nil, uErr
		}
		if err := touchUserProfile(ctx, tx, user, claims); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit: %w", err)
		}
		return getUser(ctx, s.pool, existingUserID)
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, fmt.Errorf("lookup identity: %w", err)
	}

	// (3) Unknown identity, signed in — link to the proven session user.
	targetUserID := uuid.Nil
	if linkToUserID != uuid.Nil {
		signedInUser, uErr := getUserTx(ctx, tx, linkToUserID)
		if uErr != nil {
			// The session names a user that no longer exists. Falling through
			// to "create a new account" would silently strand the caller in a
			// fresh workspace; refusing makes the dead session visible.
			return nil, uErr
		}

		// A proven session authorizes linking to THIS account — it does not
		// authorize carrying someone else's address into it. Without this
		// check, account A can hold a verified identity whose email belongs to
		// live account B, and "one live account per verified email" stops being
		// true in user_identities even though it still holds in users. Every
		// later feature that resolves people by identity email — sharing,
		// invites — would inherit that collision.
		var ownerID uuid.UUID
		err = tx.QueryRow(ctx,
			`SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`, email,
		).Scan(&ownerID)
		switch {
		case err == nil && ownerID != signedInUser.ID:
			return nil, store.ErrEmailBelongsToAnotherUser
		case err != nil && !errors.Is(err, pgx.ErrNoRows):
			return nil, fmt.Errorf("lookup user by email for linking: %w", err)
		}

		targetUserID = signedInUser.ID
	} else {
		// (4) Unknown identity, signed out — an existing account for this
		// address is a refusal, not a link.
		var ownerID uuid.UUID
		err = tx.QueryRow(ctx,
			`SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`, email,
		).Scan(&ownerID)
		switch {
		case err == nil:
			return nil, store.ErrEmailBelongsToAnotherUser
		case !errors.Is(err, pgx.ErrNoRows):
			return nil, fmt.Errorf("lookup user by email: %w", err)
		}
	}

	// (5) New account.
	if targetUserID == uuid.Nil {
		err = tx.QueryRow(ctx,
			`INSERT INTO users (email, email_verified_at, display_name)
			 VALUES ($1, now(), $2)
			 RETURNING id`,
			email, claims.DisplayName,
		).Scan(&targetUserID)
		if err != nil {
			// Someone else created an account for this address between our
			// lookup and this insert. Whether that is a REFUSAL or the SAME
			// PERSON depends on who won, and only a re-read can tell — so this
			// must not assume either. See resolveAfterEmailConflict.
			if isUniqueViolation(err, constraintUserEmailUnique) {
				if rbErr := tx.Rollback(ctx); rbErr != nil && !errors.Is(rbErr, pgx.ErrTxClosed) {
					return nil, fmt.Errorf("rollback after email conflict: %w", rbErr)
				}
				return s.resolveAfterEmailConflict(ctx, claims.Provider, claims.Subject)
			}
			return nil, fmt.Errorf("insert user: %w", err)
		}
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO user_identities (user_id, provider, subject, email)
		 VALUES ($1, $2, $3, $4)`,
		targetUserID, claims.Provider, claims.Subject, email,
	); err != nil {
		// The same (provider, subject) was inserted concurrently — the user
		// double-clicked, or two tabs finished the same flow. It is the same
		// person either way, so the answer is their account, not an error.
		if isUniqueViolation(err, constraintIdentityUnique) {
			if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
				return nil, fmt.Errorf("rollback after identity conflict: %w", err)
			}
			return s.userForIdentity(ctx, claims.Provider, claims.Subject)
		}
		return nil, fmt.Errorf("insert identity: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return getUser(ctx, s.pool, targetUserID)
}

// resolveAfterEmailConflict decides what a lost race on users_email_unique_live
// actually means.
//
// Two different shapes reach the same constraint:
//
//   - the SAME person's flow finishing twice (a double click, two tabs). The
//     winner already wrote this exact (provider, subject), so the answer is
//     their account — erroring here would fail a sign-in that succeeded.
//   - a DIFFERENT provider identity claiming an address that now has an
//     account. That is the takeover case the signed-out branch refuses, and it
//     must refuse here too.
//
// The identity lookup is what separates them, so it runs before either
// conclusion is drawn.
func (s *UserStore) resolveAfterEmailConflict(ctx context.Context, provider, subject string) (*store.User, error) {
	user, err := s.userForIdentity(ctx, provider, subject)
	if err == nil {
		return user, nil
	}
	if errors.Is(err, store.ErrUserNotFound) {
		return nil, store.ErrEmailBelongsToAnotherUser
	}
	return nil, err
}

// userForIdentity resolves the user behind an existing (provider, subject),
// used to recover from a concurrent insert of the same identity.
func (s *UserStore) userForIdentity(ctx context.Context, provider, subject string) (*store.User, error) {
	var userID uuid.UUID
	err := s.pool.QueryRow(ctx,
		`SELECT user_id FROM user_identities WHERE provider = $1 AND subject = $2`,
		provider, subject,
	).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		// The conflicting row is gone again (the other transaction rolled back).
		// Nothing sensible is left to return.
		return nil, store.ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("resolve identity after conflict: %w", err)
	}
	return getUser(ctx, s.pool, userID)
}

// isUniqueViolation reports whether err is a Postgres unique violation on the
// named constraint. Matching the NAME rather than the code alone keeps one
// constraint's conflict from being mistaken for another's.
func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	return pgErr.Code == sqlStateUniqueViolation && pgErr.ConstraintName == constraint
}

// GetUser returns a live user by id.
func (s *UserStore) GetUser(ctx context.Context, id uuid.UUID) (*store.User, error) {
	return getUser(ctx, s.pool, id)
}

// UserLanguage implements httpx.UserLanguageLookup: UserExists, with the
// learner's interface language from the same row.
func (s *UserStore) UserLanguage(ctx context.Context, id uuid.UUID) (bool, string, error) {
	var language string
	err := s.pool.QueryRow(ctx,
		`SELECT language FROM users WHERE id = $1 AND deleted_at IS NULL`, id,
	).Scan(&language)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, "", nil
	}
	if err != nil {
		return false, "", fmt.Errorf("user language: %w", err)
	}
	return true, language, nil
}

// UserExists reports whether id names a live user.
func (s *UserStore) UserExists(ctx context.Context, id uuid.UUID) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL)`, id,
	).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("user exists: %w", err)
	}
	return ok, nil
}

// SetTimezone stores the learner's IANA zone. The caller has validated the
// name with learning.LoadZone. With onlyIfUnset, a zone the learner chose
// is kept: that is the browser's automatic report, which must never
// overwrite a choice made in Settings. It reports whether the row changed.
func (s *UserStore) SetTimezone(ctx context.Context, id uuid.UUID, zone string, onlyIfUnset bool) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE users SET timezone = $2, timezone_set_at = now(), updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL AND (NOT $3 OR timezone_set_at IS NULL)`,
		id, zone, onlyIfUnset)
	if err != nil {
		return false, fmt.Errorf("set timezone: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// SetLanguage stores the learner's interface language (en, vi, es or pt; the
// column's CHECK refuses anything else). With onlyIfUnset, a language the
// learner chose is kept, as SetTimezone keeps a chosen zone.
func (s *UserStore) SetLanguage(ctx context.Context, id uuid.UUID, language string, onlyIfUnset bool) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE users SET language = $2, language_set_at = now(), updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL AND (NOT $3 OR language_set_at IS NULL)`,
		id, language, onlyIfUnset)
	if err != nil {
		return false, fmt.Errorf("set language: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// Timezone returns the learner's zone name ('UTC' until one is set).
func (s *UserStore) Timezone(ctx context.Context, id uuid.UUID) (string, error) {
	var zone string
	err := s.pool.QueryRow(ctx, `SELECT timezone FROM users WHERE id = $1`, id).Scan(&zone)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", store.ErrUserNotFound
	}
	if err != nil {
		return "", fmt.Errorf("timezone: %w", err)
	}
	return zone, nil
}

// SetStudyFocus stores what the learner came to learn; an empty list records
// that they skipped the question.
func (s *UserStore) SetStudyFocus(ctx context.Context, id uuid.UUID, focus []string) error {
	if focus == nil {
		focus = []string{}
	}
	if _, err := s.pool.Exec(ctx, `
		UPDATE users SET study_focus = $2, updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL`, id, focus); err != nil {
		return fmt.Errorf("set study focus: %w", err)
	}
	return nil
}

// SetOwnVersionFirst turns "write your own version first" on or off.
func (s *UserStore) SetOwnVersionFirst(ctx context.Context, id uuid.UUID, on bool) error {
	if _, err := s.pool.Exec(ctx, `
		UPDATE users SET own_version_first = $2, updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL`, id, on); err != nil {
		return fmt.Errorf("set own version first: %w", err)
	}
	return nil
}

// OwnVersionFirst reports whether the learner has "write your own version
// first" on. Chat and Solve read it on every start, so the rule is the
// server's and not only the composer's.
func (s *UserStore) OwnVersionFirst(ctx context.Context, id uuid.UUID) (bool, error) {
	var on bool
	err := s.pool.QueryRow(ctx, `SELECT own_version_first FROM users WHERE id = $1`, id).Scan(&on)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, store.ErrUserNotFound
	}
	if err != nil {
		return false, fmt.Errorf("own version first: %w", err)
	}
	return on, nil
}

// touchUserProfile keeps the account's display name fresh without ever
// overwriting a set name with an empty one from a provider that omits it.
func touchUserProfile(ctx context.Context, tx pgx.Tx, user *store.User, claims store.IdentityClaims) error {
	if claims.DisplayName == "" || claims.DisplayName == user.DisplayName {
		return nil
	}
	if _, err := tx.Exec(ctx,
		`UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1`,
		user.ID, claims.DisplayName,
	); err != nil {
		return fmt.Errorf("update display name: %w", err)
	}
	return nil
}

type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func getUser(ctx context.Context, q rowQuerier, id uuid.UUID) (*store.User, error) {
	var u store.User
	err := q.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE id = $1 AND deleted_at IS NULL`, id,
	).Scan(&u.ID, &u.Email, &u.EmailVerifiedAt, &u.DisplayName, &u.CreatedAt, &u.DeletedAt,
		&u.Timezone, &u.TimezoneSetAt, &u.OwnVersionFirst, &u.FileStorage, &u.Language, &u.LanguageSetAt, &u.StudyFocus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, store.ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	return &u, nil
}

func getUserTx(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*store.User, error) {
	return getUser(ctx, tx, id)
}

func validateClaims(claims store.IdentityClaims) error {
	if !claims.EmailVerified {
		return fmt.Errorf("%w: provider %q did not assert a verified email", store.ErrUnverifiedEmail, claims.Provider)
	}
	if strings.TrimSpace(claims.Provider) == "" || strings.TrimSpace(claims.Subject) == "" {
		return store.ErrInvalidClaims
	}
	if normalizeEmail(claims.Email) == "" {
		return store.ErrInvalidClaims
	}
	return nil
}

// normalizeEmail lower-cases and trims so every Go-side comparison agrees with
// the citext column. Ported from postclaw internal/auth/email_normalize.go:
// before it existed, no code path normalized case and "Chau@Gmail.com" silently
// became a different workspace from "chau@gmail.com".
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// SessionWatermark returns the time before which the user's sessions are
// revoked, or nil when none has ever been set.
func (s *UserStore) SessionWatermark(ctx context.Context, id uuid.UUID) (*time.Time, error) {
	var at *time.Time
	err := s.pool.QueryRow(ctx,
		`SELECT sessions_valid_after FROM users WHERE id = $1 AND deleted_at IS NULL`, id).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, store.ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("session watermark: %w", err)
	}
	return at, nil
}

// RevokeSessions moves the watermark to now, ending every session minted
// before this instant, and returns it.
func (s *UserStore) RevokeSessions(ctx context.Context, id uuid.UUID) (time.Time, error) {
	var at time.Time
	err := s.pool.QueryRow(ctx,
		`UPDATE users SET sessions_valid_after = now() WHERE id = $1 AND deleted_at IS NULL
		 RETURNING sessions_valid_after`, id).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, store.ErrUserNotFound
	}
	if err != nil {
		return time.Time{}, fmt.Errorf("revoke sessions: %w", err)
	}
	return at, nil
}
