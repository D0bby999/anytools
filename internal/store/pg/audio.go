package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/capabilities/audio"
	"github.com/D0bby999/anytools/internal/jobs"
)

// AudioStore is audio_overviews (learning-depth phase 10). Every statement
// names the owner.
type AudioStore struct{ pool *Pool }

// NewAudioStore builds the store.
func NewAudioStore(pool *Pool) *AudioStore { return &AudioStore{pool: pool} }

var _ audio.Store = (*AudioStore)(nil)

const audioColumns = `id, user_id, kb_id, report_id, title, language, language_choice, minutes, topic, status, error,
	script, sources, source_versions, chunks_done, chunks_total, audio_bytes, duration_seconds,
	job_id, created_at, tts_engine, tts_model, tts_voices`

func scanOverview(row pgx.Row) (*audio.Overview, error) {
	var (
		o                                 audio.Overview
		script, sources, versions, voices []byte
	)
	err := row.Scan(&o.ID, &o.UserID, &o.KBID, &o.ReportID, &o.Title, &o.Language, &o.LanguageChoice, &o.Minutes, &o.Topic,
		&o.Status, &o.Error, &script, &sources, &versions, &o.ChunksDone, &o.ChunksTotal,
		&o.AudioBytes, &o.DurationSeconds, &o.JobID, &o.CreatedAt, &o.TTSEngine, &o.TTSModel, &voices)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, audio.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("audio overview: scan: %w", err)
	}
	if len(script) > 0 {
		o.Script = &audio.Script{}
		if err := json.Unmarshal(script, o.Script); err != nil {
			return nil, fmt.Errorf("audio overview: decode script: %w", err)
		}
	}
	o.Sources = []audio.Source{}
	_ = json.Unmarshal(sources, &o.Sources)
	o.SourceVersions = map[string]int{}
	_ = json.Unmarshal(versions, &o.SourceVersions)
	var pair audio.VoicePair
	if json.Unmarshal(voices, &pair) == nil && pair.Host != "" {
		o.TTSVoices = &pair
	}
	return &o, nil
}

// Create inserts an overview. The composite foreign keys refuse a knowledge
// base or report the user does not own.
func (s *AudioStore) Create(ctx context.Context, o audio.Overview) (*audio.Overview, error) {
	// language is the spoken language, filled in with the script;
	// language_choice is what the learner asked for ('' follows the sources).
	return scanOverview(s.pool.QueryRow(ctx, `
		INSERT INTO audio_overviews (user_id, kb_id, report_id, language, language_choice, minutes, topic, status)
		VALUES ($1, $2, $3, 'en', $4, $5, $6, $7)
		RETURNING `+audioColumns,
		o.UserID, o.KBID, o.ReportID, o.LanguageChoice, o.Minutes, o.Topic, o.Status))
}

// Get reads one overview.
func (s *AudioStore) Get(ctx context.Context, userID, id uuid.UUID) (*audio.Overview, error) {
	return scanOverview(s.pool.QueryRow(ctx,
		`SELECT `+audioColumns+` FROM audio_overviews WHERE id = $1 AND user_id = $2`, id, userID))
}

// List lists a knowledge base's or a report's overviews, newest first, with
// their scripts: the page shows each one's player and transcript in place,
// and a script is at most 40 short turns.
func (s *AudioStore) List(ctx context.Context, userID uuid.UUID, kbID, reportID *uuid.UUID) ([]audio.Overview, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+audioColumns+` FROM audio_overviews
		 WHERE user_id = $1
		   AND ($2::uuid IS NULL OR kb_id = $2)
		   AND ($3::uuid IS NULL OR report_id = $3)
		 ORDER BY created_at DESC LIMIT 20`, userID, kbID, reportID)
	if err != nil {
		return nil, fmt.Errorf("audio overviews: %w", err)
	}
	defer rows.Close()
	out := []audio.Overview{}
	for rows.Next() {
		o, err := scanOverview(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	return out, rows.Err()
}

// SetJob records the generation job's id, for Cancel.
func (s *AudioStore) SetJob(ctx context.Context, userID, id, jobID uuid.UUID) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE audio_overviews SET job_id = $3, updated_at = now() WHERE id = $1 AND user_id = $2`, id, userID, jobID)
	return err
}

// SaveScript stores the validated script and moves the overview on.
func (s *AudioStore) SaveScript(
	ctx context.Context, userID, id uuid.UUID, script audio.Script, sources []audio.Source,
	versions map[string]int, language, status string, chunks int,
) error {
	sc, _ := json.Marshal(script)
	src, _ := json.Marshal(sources)
	ver, _ := json.Marshal(versions)
	_, err := s.pool.Exec(ctx, `
		UPDATE audio_overviews
		   SET script = $3, sources = $4, source_versions = $5, status = $6, chunks_total = $7,
		       title = $8, language = $9, updated_at = now()
		 WHERE id = $1 AND user_id = $2`,
		id, userID, sc, src, ver, status, chunks, truncateTitle(script.Title), language)
	return err
}

// StartSpeaking moves a script_only overview to synthesizing, once, and
// records the engine, model and voices that will speak it.
func (s *AudioStore) StartSpeaking(ctx context.Context, userID, id uuid.UUID, by audio.SpokenBy) (bool, error) {
	voices, err := json.Marshal(by.Voices)
	if err != nil {
		return false, err
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE audio_overviews SET status = 'synthesizing', chunks_done = 0, error = '', updated_at = now(),
		       tts_engine = $3, tts_model = $4, tts_voices = $5
		 WHERE id = $1 AND user_id = $2 AND status = 'script_only' AND script IS NOT NULL`,
		id, userID, by.Engine, by.Model, voices)
	if err != nil {
		return false, fmt.Errorf("start speaking: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// Progress records the chunks spoken so far.
func (s *AudioStore) Progress(ctx context.Context, userID, id uuid.UUID, done int) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE audio_overviews SET chunks_done = $3, updated_at = now() WHERE id = $1 AND user_id = $2`, id, userID, done)
	return err
}

// Ready marks the audio written.
func (s *AudioStore) Ready(ctx context.Context, userID, id uuid.UUID, bytes int64, seconds float64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE audio_overviews SET status = 'ready', audio_bytes = $3, duration_seconds = $4, updated_at = now()
		 WHERE id = $1 AND user_id = $2`, id, userID, bytes, seconds)
	return err
}

// Fail marks the overview failed with a reason the learner can read. A
// finished overview is never marked failed after the fact.
func (s *AudioStore) Fail(ctx context.Context, userID, id uuid.UUID, message string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE audio_overviews SET status = 'failed', error = left($3, 2000), updated_at = now()
		 WHERE id = $1 AND user_id = $2 AND status NOT IN ('ready', 'script_only')`, id, userID, message)
	return err
}

// Delete removes an overview and returns it, so its files can go too.
func (s *AudioStore) Delete(ctx context.Context, userID, id uuid.UUID) (*audio.Overview, error) {
	return scanOverview(s.pool.QueryRow(ctx,
		`DELETE FROM audio_overviews WHERE id = $1 AND user_id = $2 RETURNING `+audioColumns, id, userID))
}

// KBName is the knowledge base's name, scoped to its owner.
func (s *AudioStore) KBName(ctx context.Context, userID, kbID uuid.UUID) (string, error) {
	var name string
	err := s.pool.QueryRow(ctx, `SELECT name FROM knowledge_bases WHERE id = $1 AND user_id = $2`, kbID, userID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", audio.ErrNotFound
	}
	return name, err
}

// DocumentVersions reads each document's current version.
func (s *AudioStore) DocumentVersions(ctx context.Context, userID uuid.UUID, docIDs []uuid.UUID) (map[string]int, error) {
	return documentVersions(ctx, s.pool, userID, docIDs)
}

// AudioReapHandler settles an overview whose job gave up, in the same
// transaction as the job's final write: without it, a job out of attempts
// leaves its overview saying "synthesizing" forever.
func AudioReapHandler() jobs.ReapHandler {
	return func(ctx context.Context, tx pgx.Tx, job jobs.ReapedJob) error {
		if (job.Kind != audio.JobKind && job.Kind != audio.JobKindBuiltin) || !job.Terminal {
			return nil
		}
		var p struct {
			OverviewID     uuid.UUID `json:"overview_id"`
			ChargedDay     string    `json:"charged_day"`
			ChargedSeconds int       `json:"charged_seconds"`
		}
		if err := json.Unmarshal(job.Payload, &p); err != nil {
			return nil
		}
		if job.Kind == audio.JobKindBuiltin {
			if err := refundUnspokenTx(ctx, tx, job, p.ChargedDay, p.ChargedSeconds); err != nil {
				return err
			}
		}
		var reason string
		_ = tx.QueryRow(ctx, `SELECT last_error FROM jobs WHERE id = $1`, job.ID).Scan(&reason)
		if reason == "" {
			reason = "the overview stopped and was retried as many times as allowed"
		}
		// A speaking job that gives up leaves the script as it was: the
		// transcript is still good, and the learner can try "Speak it" again.
		_, err := tx.Exec(ctx, `
			UPDATE audio_overviews
			   SET status = CASE WHEN script IS NULL THEN 'failed' ELSE 'script_only' END,
			       error = left($3, 2000), updated_at = now()
			 WHERE id = $1 AND user_id = $2 AND status NOT IN ('ready', 'script_only')`,
			p.OverviewID, job.UserID, reason)
		return err
	}
}

// refundUnspokenTx gives back the built-in speech a job that gave up did not
// use (up-methods phase 22): the share of its booking for the chunks it never
// spoke. Here, in the job's final transaction, because every way a job ends
// passes this exactly once — a handler that gave up, a cancel, a lease that
// expired.
func refundUnspokenTx(ctx context.Context, tx pgx.Tx, job jobs.ReapedJob, day string, charged int) error {
	if day == "" || charged <= 0 {
		return nil
	}
	var raw []byte
	if err := tx.QueryRow(ctx, `SELECT progress FROM jobs WHERE id = $1`, job.ID).Scan(&raw); err != nil {
		return err
	}
	var progress jobs.Progress
	_ = json.Unmarshal(raw, &progress)
	unused := charged
	if progress.Total > 0 {
		unused = charged * (progress.Total - min(progress.Done, progress.Total)) / progress.Total
	}
	return refundTTSTx(ctx, tx, job.UserID, day, unused)
}

func truncateTitle(s string) string {
	r := []rune(s)
	if len(r) > 200 {
		return string(r[:200])
	}
	return s
}
