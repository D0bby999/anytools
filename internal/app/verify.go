package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/crypto"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// verify.go is the restore drill's smoke test (phase 12): after a database and
// a data directory have been put back, is this a working AnyTools?
//
// Three things, each of which a restore can get wrong while every row still
// looks present:
//
//   - the encryption key is the one the database was written with. Read-only:
//     unlike boot, a MISSING sentinel is a failure here, not something to
//     seed — seeding would stamp the new key onto a database whose secrets
//     were written with the old one;
//   - every encrypted column decrypts. The columns are discovered by name
//     (`*_enc`) rather than listed, so a table added later is covered without
//     anyone remembering this file. A non-empty value WITHOUT the ciphertext
//     prefix is also a failure: that is a secret stored in the clear;
//   - every document's original file is where it is recorded, and every
//     parsed document's Markdown is in the data directory. Rows without their
//     files are documents that list fine and never open. An original kept in
//     the learner's Google Drive (a drive_files row, drive-user-storage
//     phase 1) is not on this disk by design: the drill counts it, reports
//     it if Drive answered that the learner removed it, and does not call
//     Drive — it runs offline, with no learner's token.

// VerifyReport is what Verify found. Problems is empty when the restore is good.
type VerifyReport struct {
	SecretsChecked   int
	DocumentsChecked int
	// InDrive counts the originals kept in learners' Google Drives, which
	// are not looked for in the data directory.
	InDrive  int
	Problems []string
}

// OK reports whether nothing was wrong.
func (r VerifyReport) OK() bool { return len(r.Problems) == 0 }

// maxProblems bounds the report: a wrong key makes EVERY secret fail, and a
// thousand identical lines hide the one sentence that matters.
const maxProblems = 50

func (r *VerifyReport) add(format string, args ...any) {
	if len(r.Problems) < maxProblems {
		r.Problems = append(r.Problems, fmt.Sprintf(format, args...))
	} else if len(r.Problems) == maxProblems {
		r.Problems = append(r.Problems, "… further problems omitted")
	}
}

// Verify checks a restored database and data directory against a key.
func Verify(ctx context.Context, pool *pg.Pool, encKey, dataDir string) (VerifyReport, error) {
	var report VerifyReport

	var sentinel string
	err := pool.QueryRow(ctx, `SELECT ciphertext FROM app_sentinel WHERE id = 1`).Scan(&sentinel)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		report.add("app_sentinel is empty: this database was never booted, or the restore missed it")
	case err != nil:
		return report, fmt.Errorf("verify: read sentinel: %w", err)
	default:
		if err := pg.NewSentinelStore(pool, encKey).Verify(ctx); err != nil {
			report.add("the encryption key does not match this database (%v)", err)
		}
	}

	if err := verifySecrets(ctx, pool, encKey, &report); err != nil {
		return report, err
	}
	if err := verifyDocuments(ctx, pool, dataDir, &report); err != nil {
		return report, err
	}
	return report, nil
}

func verifySecrets(ctx context.Context, pool *pg.Pool, encKey string, report *VerifyReport) error {
	rows, err := pool.Query(ctx, `
		SELECT table_name, column_name
		  FROM information_schema.columns
		 WHERE table_schema = 'public' AND column_name LIKE '%\_enc'
		 ORDER BY table_name, column_name`)
	if err != nil {
		return fmt.Errorf("verify: list encrypted columns: %w", err)
	}
	type column struct{ table, name string }
	var columns []column
	for rows.Next() {
		var c column
		if err := rows.Scan(&c.table, &c.name); err != nil {
			rows.Close()
			return fmt.Errorf("verify: scan column: %w", err)
		}
		columns = append(columns, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, c := range columns {
		// Identifiers come from information_schema, never from input, and are
		// quoted anyway. Rows are named by ctid because not every table with a
		// secret has an `id` column (oauth_credentials keys on connection_id).
		q := fmt.Sprintf(`SELECT ctid::text, %s FROM %s WHERE %s <> ''`,
			pgx.Identifier{c.name}.Sanitize(), pgx.Identifier{c.table}.Sanitize(), pgx.Identifier{c.name}.Sanitize())
		values, err := pool.Query(ctx, q)
		if err != nil {
			return fmt.Errorf("verify: read %s.%s: %w", c.table, c.name, err)
		}
		for values.Next() {
			var id, value string
			if err := values.Scan(&id, &value); err != nil {
				values.Close()
				return fmt.Errorf("verify: scan %s.%s: %w", c.table, c.name, err)
			}
			report.SecretsChecked++
			if !crypto.IsEncrypted(value) {
				report.add("%s.%s row %s holds a value that is not encrypted", c.table, c.name, id)
				continue
			}
			if _, err := crypto.Decrypt(value, encKey); err != nil {
				report.add("%s.%s row %s does not decrypt with this key", c.table, c.name, id)
			}
		}
		values.Close()
		if err := values.Err(); err != nil {
			return err
		}
	}
	return nil
}

func verifyDocuments(ctx context.Context, pool *pg.Pool, dataDir string, report *VerifyReport) error {
	store, err := blob.NewLocal(dataDir)
	if err != nil {
		return fmt.Errorf("verify: data directory: %w", err)
	}
	// The original's location is joined by its owner as well as its digest:
	// two learners with the same bytes each have their own row.
	rows, err := pool.Query(ctx, `
		SELECT d.id, d.user_id, d.title, d.sha256, d.parsed_markdown_path, d.status,
		       f.key IS NOT NULL, f.missing_at IS NOT NULL
		  FROM documents d
		  LEFT JOIN drive_files f
		         ON f.user_id = d.user_id AND f.kind = 'original' AND f.key = d.sha256
		 ORDER BY d.created_at`)
	if err != nil {
		return fmt.Errorf("verify: list documents: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id, userID                   uuid.UUID
			title, digest, parsed, state string
			inDrive, removed             bool
		)
		if err := rows.Scan(&id, &userID, &title, &digest, &parsed, &state, &inDrive, &removed); err != nil {
			return fmt.Errorf("verify: scan document: %w", err)
		}
		report.DocumentsChecked++
		switch {
		case removed:
			report.add("document %s (%q): the learner removed the original from their Google Drive", id, title)
		case inDrive:
			report.InDrive++
		default:
			if _, err := store.GetOriginal(ctx, userID, digest); err != nil {
				report.add("document %s (%q): original file missing from the data directory", id, title)
			}
		}
		if strings.TrimSpace(parsed) != "" {
			if _, err := store.GetParsed(ctx, parsed); err != nil {
				report.add("document %s (%q, %s): parsed Markdown missing from the data directory", id, title, state)
			}
		}
	}
	return rows.Err()
}
