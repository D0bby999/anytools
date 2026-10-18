package pg

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
)

// KnowledgeReapHandler resolves a reaped or given-up job back to the document
// it was working on, and moves that document in the SAME transaction.
//
// Registered on BOTH the reaper (lease expiry) and the queue's gave-up hook
// (a handler that ran out of attempts, an unreadable payload, a kind with no
// handler). Those are the only two ways a job can stop mattering, and each
// needs the document to stop waiting for it.
//
// This is the whole point of jobs.ReapHandler taking a pgx.Tx. Two separate
// transactions — "the job is failed", then "the document is failed" — have a
// window between them, and a crash inside that window recreates exactly the
// state red-team RT-8 named: a job row that has given up and a document row
// still saying `parsing`, with nothing left running to reconcile them.
//
// The mapping is deliberately narrow: only parse_document owns a document's
// status. A reaped reindex_kb leaves documents alone, because a reindex that
// died leaves ready documents ready — with stale vectors, which is what the
// KB's needs_reembed flag is for.
func KnowledgeReapHandler() jobs.ReapHandler {
	return func(ctx context.Context, tx pgx.Tx, job jobs.ReapedJob) error {
		if job.Kind == jobs.KindTranscribeVideo || job.Kind == jobs.KindTranscribeBuiltin {
			return reapTranscription(ctx, tx, job)
		}
		if job.Kind != jobs.KindParseDocument {
			return nil
		}

		var payload knowledge.ParseJobPayload
		if err := json.Unmarshal(job.Payload, &payload); err != nil {
			// A payload this build cannot read is not a reason to abort the
			// whole sweep and leave every other expired lease held.
			return nil
		}

		if job.Terminal {
			return FailDocumentTx(ctx, tx, job.UserID, payload.DocumentID,
				"processing stopped unexpectedly and has been retried as many times as allowed")
		}
		// Going back on the queue: the document must say so too, or the UI
		// shows "parsing" for a document nobody is parsing until a worker
		// happens to pick it up again.
		return RequeueDocumentTx(ctx, tx, job.UserID, payload.DocumentID)
	}
}

// reapTranscription is the transcribe_video backstop. A transcription that
// gave up puts its video back to waiting for the learner; one going back on
// the queue leaves the video `parsing`, because a retry is coming and resumes
// at its first unfinished window. The handler normally settles the video with
// a specific reason first, which this never overwrites (MarkNeedsTranscriptTx
// moves only a `parsing` row).
func reapTranscription(ctx context.Context, tx pgx.Tx, job jobs.ReapedJob) error {
	if !job.Terminal {
		return nil
	}
	var payload knowledge.TranscribeJobPayload
	if err := json.Unmarshal(job.Payload, &payload); err != nil {
		return nil
	}
	if job.Kind == jobs.KindTranscribeBuiltin {
		if err := refundBuiltinTx(ctx, tx, job, payload); err != nil {
			return err
		}
	}
	return MarkNeedsTranscriptTx(ctx, tx, job.UserID, payload.DocumentID,
		"the AI transcript stopped unexpectedly. Try again, or upload subtitles or paste the transcript.")
}

// refundBuiltinTx gives back the built-in minutes a job that gave up did not
// use (up-methods phase 21): the share of its booked seconds for the windows
// it never stored. Here, in the job's final transaction, because this is the
// one place every way a job ends passes exactly once — a handler that gave
// up, a cancel, a lease that expired.
func refundBuiltinTx(ctx context.Context, tx pgx.Tx, job jobs.ReapedJob, p knowledge.TranscribeJobPayload) error {
	if p.ChargedDay == "" || p.ChargedSeconds <= 0 {
		return nil
	}
	var raw []byte
	if err := tx.QueryRow(ctx, `SELECT progress FROM jobs WHERE id = $1`, job.ID).Scan(&raw); err != nil {
		return err
	}
	var progress jobs.Progress
	_ = json.Unmarshal(raw, &progress)
	unused := p.ChargedSeconds
	if progress.Total > 0 {
		unused = p.ChargedSeconds * (progress.Total - min(progress.Done, progress.Total)) / progress.Total
	}
	if unused <= 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `
		UPDATE stt_usage SET seconds = GREATEST(0, seconds - $3)
		 WHERE user_id = $1 AND day = $2::date`, job.UserID, p.ChargedDay, unused)
	return err
}
