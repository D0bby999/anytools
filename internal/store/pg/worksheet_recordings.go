package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
)

// worksheet_recordings.go keeps the learner's recordings on a worksheet
// (migration 1790010000, up-methods phase 7). The row is the recording; the
// audio is the ObjectStore object worksheet.RecordingNamespace/<row id>.
//
// Order, so no file is ever orphaned by a request that fails (red team SF-6):
//
//   - upload: lock the worksheet, check the per-worksheet cap and the user's
//     quota under the lock (and a per-user lock, so two worksheets cannot
//     both take the last megabytes), insert the row, write the file. A failed
//     write rolls the row back.
//   - delete: lock the worksheet, delete the file, then the row, and clear
//     its id from the answers, in one transaction. A file that cannot be
//     deleted fails it with the row kept, so it can be retried.
//
// A row whose file is gone (a crash between the two) serves "recording
// missing" and can still be deleted.

var _ worksheet.RecordingStore = (*WorksheetStore)(nil)

const recordingColumns = `id, worksheet_id, mime, bytes, duration_seconds, created_at`

// listRecordings reads a worksheet's recordings, oldest first.
func listRecordings(ctx context.Context, q querier, userID, worksheetID uuid.UUID) ([]worksheet.Recording, error) {
	rows, err := q.Query(ctx, `SELECT `+recordingColumns+` FROM worksheet_recordings
		 WHERE worksheet_id = $1 AND user_id = $2 ORDER BY created_at, id`, worksheetID, userID)
	if err != nil {
		return nil, fmt.Errorf("worksheet recordings: %w", err)
	}
	defer rows.Close()
	out := []worksheet.Recording{}
	for rows.Next() {
		var r worksheet.Recording
		if err := rows.Scan(&r.ID, &r.WorksheetID, &r.MIME, &r.Bytes, &r.DurationSeconds, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// AddRecording keeps one take, in the order above.
func (s *WorksheetStore) AddRecording(
	ctx context.Context, userID, worksheetID uuid.UUID, r worksheet.Recording, data []byte,
) (*worksheet.Recording, error) {
	if s.objects == nil {
		return nil, errors.New("worksheet recordings: no object store")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var locked uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM worksheets WHERE id = $1 AND user_id = $2 FOR UPDATE`,
		worksheetID, userID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, worksheet.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lock worksheet: %w", err)
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM worksheet_recordings WHERE worksheet_id = $1 AND user_id = $2`,
		worksheetID, userID).Scan(&count); err != nil {
		return nil, err
	}
	if count >= worksheet.MaxRecordingsPerWorksheet {
		return nil, worksheet.ErrRecordingsFull
	}
	// The quota spans every worksheet of the user, each with its own row
	// lock: one more lock, per user, makes the sum and the insert atomic.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`,
		jobs.AdvisoryKey("worksheet-recordings:"+userID.String())); err != nil {
		return nil, err
	}
	var used int64
	if err := tx.QueryRow(ctx, `SELECT COALESCE(sum(bytes), 0) FROM worksheet_recordings WHERE user_id = $1`,
		userID).Scan(&used); err != nil {
		return nil, err
	}
	if used+int64(len(data)) > worksheet.RecordingQuotaBytes {
		return nil, worksheet.ErrRecordingQuota
	}

	out := r
	if err := tx.QueryRow(ctx, `
		INSERT INTO worksheet_recordings (user_id, worksheet_id, mime, bytes, duration_seconds)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING `+recordingColumns,
		userID, worksheetID, r.MIME, len(data), r.DurationSeconds).Scan(
		&out.ID, &out.WorksheetID, &out.MIME, &out.Bytes, &out.DurationSeconds, &out.CreatedAt); err != nil {
		return nil, fmt.Errorf("insert recording: %w", err)
	}
	if err := s.objects.PutObject(ctx, userID, worksheet.RecordingNamespace, out.ID, data); err != nil {
		return nil, fmt.Errorf("write recording: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		// The row is gone with the transaction; its file goes too.
		_ = s.objects.DeleteObject(context.WithoutCancel(ctx), userID, worksheet.RecordingNamespace, out.ID)
		return nil, err
	}
	return &out, nil
}

// OpenRecording is the recording, resolved with both ids and the owner, and
// its file opened for streaming.
func (s *WorksheetStore) OpenRecording(
	ctx context.Context, userID, worksheetID, recordingID uuid.UUID,
) (*worksheet.Recording, *blob.File, error) {
	var r worksheet.Recording
	err := s.pool.QueryRow(ctx, `SELECT `+recordingColumns+` FROM worksheet_recordings
		 WHERE id = $1 AND worksheet_id = $2 AND user_id = $3`, recordingID, worksheetID, userID).Scan(
		&r.ID, &r.WorksheetID, &r.MIME, &r.Bytes, &r.DurationSeconds, &r.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, worksheet.ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("worksheet recording: %w", err)
	}
	if s.objects == nil {
		return nil, nil, worksheet.ErrRecordingMissing
	}
	f, err := s.objects.OpenObject(ctx, userID, worksheet.RecordingNamespace, r.ID)
	if blob.Gone(err) {
		return &r, nil, worksheet.ErrRecordingMissing
	}
	if err != nil {
		return nil, nil, err
	}
	return &r, f, nil
}

// DeleteRecording deletes the file, then the row, and writes the sections
// clear returns (its id removed from the answers), in one transaction under
// the worksheet's row lock. The sections it rewrites are stamped, so a page
// still holding the id gets "changed elsewhere" rather than re-sending it.
func (s *WorksheetStore) DeleteRecording(
	ctx context.Context, userID, worksheetID, recordingID uuid.UUID,
	clear func(*worksheet.Worksheet) map[string]map[string]any,
) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	w, err := scanWorksheet(tx.QueryRow(ctx,
		`SELECT `+worksheetColumns+` FROM worksheets WHERE id = $1 AND user_id = $2 FOR UPDATE`, worksheetID, userID))
	if err != nil {
		return err
	}
	var id uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM worksheet_recordings WHERE id = $1 AND worksheet_id = $2 AND user_id = $3`,
		recordingID, worksheetID, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return worksheet.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("worksheet recording: %w", err)
	}
	if err := s.deleteFiles(ctx, userID, []worksheet.Recording{{ID: id}}); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM worksheet_recordings WHERE id = $1 AND user_id = $2`, id, userID); err != nil {
		return fmt.Errorf("delete recording: %w", err)
	}

	sections := clear(w)
	if len(sections) > 0 {
		var rev time.Time
		if err := tx.QueryRow(ctx, `SELECT greatest(clock_timestamp(), $1::timestamptz + interval '1 microsecond')`,
			w.UpdatedAt).Scan(&rev); err != nil {
			return err
		}
		revs := map[string]time.Time{}
		for section, fields := range sections {
			raw, err := json.Marshal(fields)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				UPDATE worksheets SET answers = jsonb_set(answers, ARRAY[$3::text], $4::jsonb)
				 WHERE id = $1 AND user_id = $2`, worksheetID, userID, section, raw); err != nil {
				return fmt.Errorf("clear recording: %w", err)
			}
			revs[section] = rev
		}
		revsJSON, err := json.Marshal(revs)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE worksheets SET section_revs = section_revs || $3::jsonb, updated_at = $4
			 WHERE id = $1 AND user_id = $2`, worksheetID, userID, revsJSON, rev); err != nil {
			return fmt.Errorf("clear recording: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// DeleteDocumentRecordings is knowledge.RecordingCleaner: before a document
// is deleted, the files of every recording on a worksheet attached to it go.
// Its rows go with the document (ON DELETE CASCADE). A file that cannot be
// deleted fails the document's delete, which can be retried.
func (s *WorksheetStore) DeleteDocumentRecordings(ctx context.Context, userID, documentID uuid.UUID) error {
	return s.deleteRecordingFiles(ctx, userID, `
		SELECT r.id FROM worksheet_recordings r
		  JOIN worksheets w ON w.id = r.worksheet_id AND w.user_id = r.user_id
		 WHERE r.user_id = $1 AND w.document_id = $2`, documentID)
}

// DeleteKBRecordings is knowledge.RecordingCleaner for a whole knowledge
// base: the recordings on worksheets attached to any of its documents.
func (s *WorksheetStore) DeleteKBRecordings(ctx context.Context, userID, kbID uuid.UUID) error {
	return s.deleteRecordingFiles(ctx, userID, `
		SELECT r.id FROM worksheet_recordings r
		  JOIN worksheets w ON w.id = r.worksheet_id AND w.user_id = r.user_id
		  JOIN documents d ON d.id = w.document_id AND d.user_id = w.user_id
		 WHERE r.user_id = $1 AND d.kb_id = $2`, kbID)
}

func (s *WorksheetStore) deleteRecordingFiles(ctx context.Context, userID uuid.UUID, query string, id uuid.UUID) error {
	rows, err := s.pool.Query(ctx, query, userID, id)
	if err != nil {
		return fmt.Errorf("worksheet recordings: %w", err)
	}
	recs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (worksheet.Recording, error) {
		var r worksheet.Recording
		return r, row.Scan(&r.ID)
	})
	if err != nil {
		return fmt.Errorf("worksheet recordings: %w", err)
	}
	return s.deleteFiles(ctx, userID, recs)
}

// deleteFiles removes recordings' files; a missing file is already gone.
func (s *WorksheetStore) deleteFiles(ctx context.Context, userID uuid.UUID, recs []worksheet.Recording) error {
	if len(recs) == 0 {
		return nil
	}
	if s.objects == nil {
		return errors.New("worksheet recordings: no object store to delete their files from")
	}
	for _, r := range recs {
		if err := s.objects.DeleteObject(ctx, userID, worksheet.RecordingNamespace, r.ID); err != nil {
			return fmt.Errorf("delete recording file: %w", err)
		}
	}
	return nil
}
