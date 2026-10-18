package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

// units.go — jobs that bill the learner many times, and must not do it twice.
//
// A retry used to start the handler from step one (learning-depth red team
// SF-14). For a parse that is harmless; for a 15-minute audio overview it pays
// for every synthesised chunk again, on the learner's own key. A handler that
// makes several billed calls splits its work into ordered UNITS and runs them
// through RunUnits, which:
//
//   - persists each finished unit before starting the next, so a retry resumes
//     at the first unfinished one;
//   - checks for a cancel request between units, so Cancel stops the job
//     after the unit in flight rather than mid-call;
//   - counts the provider calls actually made, across attempts, for the UI.
//
// The unit's own OUTPUT (a chunk of audio, a set of questions) is the
// handler's to store in its own table or object before it returns; the
// checkpoint only records that unit i is done.
//
// Enqueue such jobs with maxAttempts 2, and return Terminal(err) for a
// provider 4xx: a refused request is refused again.

// Progress is a multi-unit job's checkpoint, stored in jobs.progress.
type Progress struct {
	Done   int `json:"done"`
	Total  int `json:"total"`
	Billed int `json:"billed"`
}

// ErrCancelled ends a job the learner cancelled. RunUnits returns it wrapped
// as Terminal, so the job fails once and its gave-up handler runs.
var ErrCancelled = errors.New("cancelled")

// ErrLeaseLost means the reaper took the job while a unit ran: another worker
// may be running it now, and this one must stop without writing anything.
var ErrLeaseLost = errors.New("jobs: lease lost")

// ProgressOf decodes a job's checkpoint. A missing or unreadable one is a
// fresh start.
func ProgressOf(job *Job) Progress {
	var p Progress
	if len(job.Progress) > 0 {
		_ = json.Unmarshal(job.Progress, &p)
	}
	if p.Done < 0 {
		p.Done = 0
	}
	return p
}

// UnitFunc runs unit i and reports how many provider calls it made, even when
// it fails: a call that was billed and then errored still cost the learner.
type UnitFunc func(ctx context.Context, i int) (billed int, err error)

// RunUnits runs units [done, total) of job in order. total may differ from a
// previous attempt's only if the handler's plan changed; units already done
// are never rerun.
func (q *Queue) RunUnits(ctx context.Context, job *Job, total int, unit UnitFunc) error {
	p := ProgressOf(job)
	p.Total = total
	for i := p.Done; i < total; i++ {
		cancelled, err := q.CancelRequested(ctx, job.ID)
		if err != nil {
			return err
		}
		if cancelled {
			return Terminal(ErrCancelled)
		}
		billed, uerr := unit(ctx, i)
		p.Billed += billed
		if uerr == nil {
			p.Done = i + 1
		}
		if err := q.saveProgress(ctx, job, p); err != nil {
			if uerr != nil {
				return errors.Join(uerr, err)
			}
			return err
		}
		if uerr != nil {
			return uerr
		}
	}
	return nil
}

func (q *Queue) saveProgress(ctx context.Context, job *Job, p Progress) error {
	raw, err := json.Marshal(p)
	if err != nil {
		return err
	}
	tag, err := q.pool.Exec(ctx, `
        UPDATE jobs SET progress = $3, updated_at = now()
         WHERE id = $1 AND locked_by = $2 AND status = 'running'`, job.ID, job.WorkerID, raw)
	if err != nil {
		return fmt.Errorf("jobs: save progress: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	job.Progress = raw
	return nil
}

// RequestCancel asks a queued or running job of userID's to stop. It reports
// false when there is no such job, it is not theirs, or it already finished;
// the caller answers 404 for all three, so a job id is no oracle.
func (q *Queue) RequestCancel(ctx context.Context, userID, jobID uuid.UUID) (bool, error) {
	tag, err := q.pool.Exec(ctx, `
        UPDATE jobs SET cancel_requested = true, updated_at = now()
         WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'running')`, jobID, userID)
	if err != nil {
		return false, fmt.Errorf("jobs: request cancel: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// CancelRequested reports whether the job's owner asked it to stop.
func (q *Queue) CancelRequested(ctx context.Context, jobID uuid.UUID) (bool, error) {
	var v bool
	if err := q.pool.QueryRow(ctx, `SELECT cancel_requested FROM jobs WHERE id = $1`, jobID).Scan(&v); err != nil {
		return false, fmt.Errorf("jobs: cancel requested: %w", err)
	}
	return v, nil
}
