package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/runtime"
)

// TurnStore is the pgx implementation of runtime.TurnStore and
// runtime.EventStore.
//
// The state machine is enforced in SQL, not in Go. Every transition is a
// conditional UPDATE with the acceptable source statuses in its WHERE clause,
// so a cancel arriving at the same instant the capability finishes resolves to
// exactly one winner at the database — the loser updates zero rows and is told
// so. A read-then-write in Go would let both succeed under READ COMMITTED and
// the last writer would decide, which is how a cancelled turn ends up recorded
// as done.
type TurnStore struct {
	pool *Pool
}

// NewTurnStore builds a TurnStore over the shared pool.
func NewTurnStore(pool *Pool) *TurnStore { return &TurnStore{pool: pool} }

var (
	_ runtime.TurnStore  = (*TurnStore)(nil)
	_ runtime.EventStore = (*TurnStore)(nil)
)

const turnColumns = `id, user_id, session_id, capability, status, failure_code, retryable,
	lease_expires_at, heartbeat_at, attempt, error, provider, model, usage,
	created_at, updated_at, finished_at`

// CreateTurn inserts a queued turn.
func (s *TurnStore) CreateTurn(ctx context.Context, t runtime.Turn) (*runtime.Turn, error) {
	capability := t.Capability
	if capability == "" {
		capability = "chat"
	}
	row := s.pool.QueryRow(ctx, `
		INSERT INTO turns (user_id, session_id, capability, status)
		VALUES ($1, $2, $3, 'queued')
		RETURNING `+turnColumns,
		t.UserID, t.SessionID, capability)
	return scanTurn(row)
}

// ClaimTurn moves queued → running and stamps the lease.
//
// `status = 'queued'` in the WHERE clause is the mutual exclusion: a second
// worker (or a retry of the same goroutine) finds zero rows and learns it does
// not own the turn, rather than starting a parallel run that would interleave
// two answers into one stream.
func (s *TurnStore) ClaimTurn(ctx context.Context, turnID uuid.UUID, lease time.Duration) (*runtime.Turn, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE turns
		   SET status = 'running',
		       attempt = attempt + 1,
		       lease_expires_at = now() + $2::interval,
		       heartbeat_at = now(),
		       updated_at = now()
		 WHERE id = $1 AND status = 'queued'
		RETURNING `+turnColumns,
		turnID, intervalOf(lease))

	turn, err := scanTurn(row)
	if errors.Is(err, runtime.ErrTurnNotFound) {
		return nil, fmt.Errorf("%w: turn %s is not queued", runtime.ErrTurnNotFound, turnID)
	}
	return turn, err
}

// Heartbeat extends the lease of a turn still held by this worker.
//
// It refuses to extend a terminal turn: a heartbeat that could resurrect a
// swept turn's lease would give the process two live writers for one turn, one
// of which the database believes is dead.
func (s *TurnStore) Heartbeat(ctx context.Context, turnID uuid.UUID, lease time.Duration) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE turns
		   SET lease_expires_at = now() + $2::interval,
		       heartbeat_at = now(),
		       updated_at = now()
		 WHERE id = $1 AND status IN ('running', 'waiting_user')`,
		turnID, intervalOf(lease))
	if err != nil {
		return fmt.Errorf("heartbeat turn: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return runtime.ErrTurnNotFound
	}
	return nil
}

// SetStatus applies a guarded status change.
//
// It returns (nil, nil) when the guard did not match: that is a lost race, not
// an error. The orchestrator's terminal write and a user's cancel both call
// this, and exactly one of them updating a row is the correct outcome — turning
// the other into an error would fill the logs with noise about the system
// working.
func (s *TurnStore) SetStatus(
	ctx context.Context, turnID uuid.UUID, from []string, to string, upd runtime.TurnUpdate,
) (*runtime.Turn, error) {
	for _, f := range from {
		if err := runtime.CheckTransition(f, to); err != nil {
			return nil, err
		}
	}

	var usage []byte
	if upd.Usage != nil {
		usage = upd.Usage.JSON()
	}

	row := s.pool.QueryRow(ctx, `
		UPDATE turns
		   SET status = $3,
		       failure_code = CASE WHEN $4 = '' THEN failure_code ELSE $4 END,
		       retryable = $5,
		       error = CASE WHEN $6 = '' THEN error ELSE $6 END,
		       provider = CASE WHEN $7 = '' THEN provider ELSE $7 END,
		       model = CASE WHEN $8 = '' THEN model ELSE $8 END,
		       usage = COALESCE($9::jsonb, usage),
		       lease_expires_at = CASE WHEN $10 THEN NULL ELSE lease_expires_at END,
		       finished_at = CASE WHEN $11 THEN now() ELSE finished_at END,
		       updated_at = now()
		 WHERE id = $1 AND status = ANY($2::text[])
		RETURNING `+turnColumns,
		turnID, from, to,
		upd.FailureCode, upd.Retryable, upd.Error, upd.Provider, upd.Model,
		usage, upd.ClearLease, upd.Finished)

	turn, err := scanTurn(row)
	if errors.Is(err, runtime.ErrTurnNotFound) {
		return nil, nil
	}
	return turn, err
}

// GetTurn reads one turn, scoped to its owner.
//
// user_id is in the WHERE clause rather than checked after the read. A handler
// that fetched by id and compared afterwards would still have loaded another
// user's row into memory, and every later refactor of that handler is one
// forgotten comparison away from returning it.
func (s *TurnStore) GetTurn(ctx context.Context, userID, turnID uuid.UUID) (*runtime.Turn, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT `+turnColumns+` FROM turns WHERE id = $1 AND user_id = $2`, turnID, userID)
	return scanTurn(row)
}

// ExpiredTurns returns the sweeper's candidates.
func (s *TurnStore) ExpiredTurns(ctx context.Context, limit int) ([]runtime.Turn, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+turnColumns+`
		  FROM turns
		 WHERE status IN ('running', 'waiting_user')
		   AND lease_expires_at IS NOT NULL
		   AND lease_expires_at < now()
		 ORDER BY lease_expires_at
		 LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("query expired turns: %w", err)
	}
	defer rows.Close()

	var out []runtime.Turn
	for rows.Next() {
		t, err := scanTurn(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// AppendEvents writes a batch of turn events.
//
// ON CONFLICT DO NOTHING is what makes a retried flush safe: the sink re-sends
// a batch whose write timed out, and a duplicate-key error there would abort
// the statement and lose every event after the collision.
func (s *TurnStore) AppendEvents(ctx context.Context, turnID, userID uuid.UUID, events []runtime.Event) error {
	if len(events) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, ev := range events {
		metadata := []byte("{}")
		if len(ev.Metadata) > 0 {
			if b, err := json.Marshal(ev.Metadata); err == nil {
				metadata = b
			}
		}
		batch.Queue(`
			INSERT INTO turn_events (turn_id, user_id, seq, type, source, stage, content, metadata)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
			ON CONFLICT (turn_id, seq) DO NOTHING`,
			turnID, userID, ev.Seq, ev.Type, ev.Source, ev.Stage, ev.Content, metadata)
	}

	results := s.pool.SendBatch(ctx, batch)
	defer results.Close()
	for range events {
		if _, err := results.Exec(); err != nil {
			return fmt.Errorf("append turn events: %w", err)
		}
	}
	return nil
}

// EventsAfter reads the persisted log for replay.
func (s *TurnStore) EventsAfter(
	ctx context.Context, userID, turnID uuid.UUID, afterSeq int64, limit int,
) ([]runtime.Event, error) {
	if limit <= 0 {
		limit = 5000
	}
	rows, err := s.pool.Query(ctx, `
		SELECT type, source, stage, content, metadata, seq, extract(epoch from created_at)
		  FROM turn_events
		 WHERE turn_id = $1 AND user_id = $2 AND seq > $3
		 ORDER BY seq
		 LIMIT $4`, turnID, userID, afterSeq, limit)
	if err != nil {
		return nil, fmt.Errorf("query turn events: %w", err)
	}
	defer rows.Close()

	var out []runtime.Event
	for rows.Next() {
		var ev runtime.Event
		var metadata []byte
		if err := rows.Scan(&ev.Type, &ev.Source, &ev.Stage, &ev.Content, &metadata, &ev.Seq, &ev.Timestamp); err != nil {
			return nil, fmt.Errorf("scan turn event: %w", err)
		}
		if len(metadata) > 0 {
			_ = json.Unmarshal(metadata, &ev.Metadata)
		}
		ev.TurnID = turnID.String()
		out = append(out, ev)
	}
	return out, rows.Err()
}

// MaxSeq returns the highest persisted seq for a turn, or 0.
func (s *TurnStore) MaxSeq(ctx context.Context, turnID uuid.UUID) (int64, error) {
	var seq *int64
	if err := s.pool.QueryRow(ctx,
		`SELECT max(seq) FROM turn_events WHERE turn_id = $1`, turnID).Scan(&seq); err != nil {
		return 0, fmt.Errorf("max turn event seq: %w", err)
	}
	if seq == nil {
		return 0, nil
	}
	return *seq, nil
}

func scanTurn(row rowScanner) (*runtime.Turn, error) {
	var t runtime.Turn
	var usage []byte
	err := row.Scan(
		&t.ID, &t.UserID, &t.SessionID, &t.Capability, &t.Status, &t.FailureCode, &t.Retryable,
		&t.LeaseExpires, &t.HeartbeatAt, &t.Attempt, &t.Error, &t.Provider, &t.Model, &usage,
		&t.CreatedAt, &t.UpdatedAt, &t.FinishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, runtime.ErrTurnNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan turn: %w", err)
	}
	if len(usage) > 0 {
		_ = json.Unmarshal(usage, &t.Usage)
	}
	return &t, nil
}

// intervalOf renders a duration as a Postgres interval literal. Passing a
// time.Duration directly would send nanoseconds, which Postgres reads as
// microseconds — a lease sixty seconds long silently becoming sixty
// microseconds, i.e. always expired.
func intervalOf(d time.Duration) string {
	return fmt.Sprintf("%d milliseconds", d.Milliseconds())
}
