package jobs_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

func makeUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, display_name) VALUES ($1, 'jobs test') RETURNING id`,
		"jobs-"+uuid.NewString()+"@example.test").Scan(&id)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

type payload struct {
	Doc string `json:"doc"`
}

func TestEnqueueClaimComplete(t *testing.T) {
	pool := testutil.TestDB(t)
	user := makeUser(t, pool)
	q := jobs.NewQueue(pool, time.Minute)
	ctx := context.Background()

	id, err := q.Enqueue(ctx, user, "test_kind_"+uuid.NewString(), payload{Doc: "a"}, 3)
	if err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	job, err := q.Get(ctx, id)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}

	claimed, err := q.Claim(ctx, "worker-1", []string{job.Kind})
	if err != nil {
		t.Fatalf("Claim: %v", err)
	}
	if claimed.ID != id {
		t.Fatalf("claimed %s, want %s", claimed.ID, id)
	}
	// attempts is incremented AT CLAIM TIME, not at failure: a worker that dies
	// before it can report anything is exactly the case max_attempts bounds,
	// and a dead worker cannot increment a counter on its way out.
	if claimed.Attempts != 1 {
		t.Fatalf("attempts = %d after one claim, want 1", claimed.Attempts)
	}

	// A second claim finds nothing: the row is leased.
	if _, err := q.Claim(ctx, "worker-2", []string{job.Kind}); !errors.Is(err, jobs.ErrNoJob) {
		t.Fatalf("second claim err = %v, want ErrNoJob", err)
	}

	if err := q.Complete(ctx, id, "worker-1"); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	done, _ := q.Get(ctx, id)
	if done.Status != jobs.StatusDone {
		t.Fatalf("status = %q", done.Status)
	}
}

// SKIP LOCKED is what lets several workers claim concurrently without any of
// them waiting — and without two of them getting the same job, which for a
// parse job would write every passage twice.
func TestConcurrentClaimsNeverHandOutTheSameJob(t *testing.T) {
	pool := testutil.TestDB(t)
	user := makeUser(t, pool)
	q := jobs.NewQueue(pool, time.Minute)
	ctx := context.Background()
	kind := "concurrent_" + uuid.NewString()

	const total = 20
	for i := 0; i < total; i++ {
		if _, err := q.Enqueue(ctx, user, kind, payload{Doc: "x"}, 3); err != nil {
			t.Fatalf("Enqueue: %v", err)
		}
	}

	var mu sync.Mutex
	seen := map[uuid.UUID]int{}
	var wg sync.WaitGroup
	for w := 0; w < 8; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for {
				job, err := q.Claim(ctx, "worker-"+uuid.NewString(), []string{kind})
				if errors.Is(err, jobs.ErrNoJob) {
					return
				}
				if err != nil {
					t.Errorf("Claim: %v", err)
					return
				}
				mu.Lock()
				seen[job.ID]++
				mu.Unlock()
			}
		}(w)
	}
	wg.Wait()

	if len(seen) != total {
		t.Fatalf("claimed %d distinct jobs, want %d", len(seen), total)
	}
	for id, n := range seen {
		if n != 1 {
			t.Fatalf("job %s was claimed %d times", id, n)
		}
	}
}

func TestHeartbeatExtendsTheLeaseAndReportsALostOne(t *testing.T) {
	pool := testutil.TestDB(t)
	user := makeUser(t, pool)
	q := jobs.NewQueue(pool, 2*time.Second)
	ctx := context.Background()
	kind := "heartbeat_" + uuid.NewString()

	id, _ := q.Enqueue(ctx, user, kind, payload{Doc: "a"}, 3)
	if _, err := q.Claim(ctx, "worker-1", []string{kind}); err != nil {
		t.Fatalf("Claim: %v", err)
	}

	ok, err := q.Heartbeat(ctx, id, "worker-1")
	if err != nil {
		t.Fatalf("Heartbeat: %v", err)
	}
	if !ok {
		t.Fatal("the holder's heartbeat must succeed")
	}

	// Somebody else's heartbeat must not extend our lease.
	ok, err = q.Heartbeat(ctx, id, "worker-2")
	if err != nil {
		t.Fatalf("Heartbeat: %v", err)
	}
	if ok {
		t.Fatal("a worker that does not hold the lease extended it")
	}

	// After the reaper takes the row, the old holder learns it has lost it —
	// which is the signal that makes it STOP rather than keep writing chunks
	// for a document another worker may already be parsing.
	expireLease(t, pool, id)
	if _, err := jobs.NewReaper(pool, nil, time.Minute).ReapOnce(ctx); err != nil {
		t.Fatalf("ReapOnce: %v", err)
	}
	ok, err = q.Heartbeat(ctx, id, "worker-1")
	if err != nil {
		t.Fatalf("Heartbeat: %v", err)
	}
	if ok {
		t.Fatal("a reaped job's former holder must not be able to extend the lease")
	}
}

func TestFailRequeuesUntilMaxAttempts(t *testing.T) {
	pool := testutil.TestDB(t)
	user := makeUser(t, pool)
	q := jobs.NewQueue(pool, time.Minute)
	ctx := context.Background()
	kind := "retry_" + uuid.NewString()

	id, _ := q.Enqueue(ctx, user, kind, payload{Doc: "a"}, 2)

	// Attempt 1 fails -> requeued.
	if _, err := q.Claim(ctx, "w1", []string{kind}); err != nil {
		t.Fatalf("Claim: %v", err)
	}
	gaveUp, err := q.Fail(ctx, id, "w1", errors.New("boom"), false)
	if err != nil {
		t.Fatalf("Fail: %v", err)
	}
	if gaveUp {
		t.Fatal("gave up after one of two attempts")
	}
	if j, _ := q.Get(ctx, id); j.Status != jobs.StatusQueued {
		t.Fatalf("status = %q, want queued", j.Status)
	}

	// Backoff: run_after is in the future, so a poisonous payload cannot spin
	// the worker pool.
	clearBackoff(t, pool, id)

	// Attempt 2 fails -> failed.
	if _, err := q.Claim(ctx, "w1", []string{kind}); err != nil {
		t.Fatalf("Claim: %v", err)
	}
	gaveUp, err = q.Fail(ctx, id, "w1", errors.New("boom again"), false)
	if err != nil {
		t.Fatalf("Fail: %v", err)
	}
	if !gaveUp {
		t.Fatal("must give up at max_attempts")
	}
	j, _ := q.Get(ctx, id)
	if j.Status != jobs.StatusFailed {
		t.Fatalf("status = %q, want failed", j.Status)
	}
	if j.LastError == "" {
		t.Fatal("a failed job must record why")
	}
}

// A terminal error must not burn the remaining attempts. Retrying an
// unsupported file type three times spends the user's quota to reach the same
// answer.
func TestTerminalFailureSkipsRemainingAttempts(t *testing.T) {
	pool := testutil.TestDB(t)
	user := makeUser(t, pool)
	q := jobs.NewQueue(pool, time.Minute)
	ctx := context.Background()
	kind := "terminal_" + uuid.NewString()

	id, _ := q.Enqueue(ctx, user, kind, payload{Doc: "a"}, 5)
	if _, err := q.Claim(ctx, "w1", []string{kind}); err != nil {
		t.Fatalf("Claim: %v", err)
	}
	gaveUp, err := q.Fail(ctx, id, "w1", errors.New("unsupported file type"), true)
	if err != nil {
		t.Fatalf("Fail: %v", err)
	}
	if !gaveUp {
		t.Fatal("a terminal failure must give up immediately")
	}
	j, _ := q.Get(ctx, id)
	if j.Status != jobs.StatusFailed || j.Attempts != 1 {
		t.Fatalf("status=%q attempts=%d, want failed after 1", j.Status, j.Attempts)
	}
}

// A handler that gives up must be able to find what its job owned: the
// gave-up handler is handed the job's payload, as the reaper's is.
func TestAGaveUpHandlerIsHandedThePayload(t *testing.T) {
	pool := testutil.TestDB(t)
	user := makeUser(t, pool)
	q := jobs.NewQueue(pool, time.Minute)
	ctx := context.Background()
	kind := "gave_up_" + uuid.NewString()
	var got payload
	q.OnGaveUp(func(_ context.Context, _ pgx.Tx, job jobs.ReapedJob) error {
		if job.Kind == kind {
			return json.Unmarshal(job.Payload, &got)
		}
		return nil
	})

	id, _ := q.Enqueue(ctx, user, kind, payload{Doc: "owned"}, 1)
	if _, err := q.Claim(ctx, "w1", []string{kind}); err != nil {
		t.Fatalf("Claim: %v", err)
	}
	if _, err := q.Fail(ctx, id, "w1", errors.New("boom"), false); err != nil {
		t.Fatalf("Fail: %v", err)
	}
	if got.Doc != "owned" {
		t.Fatalf("the gave-up handler saw payload %+v", got)
	}
}

func TestBackoffDelaysARequeuedJob(t *testing.T) {
	pool := testutil.TestDB(t)
	user := makeUser(t, pool)
	q := jobs.NewQueue(pool, time.Minute)
	ctx := context.Background()
	kind := "backoff_" + uuid.NewString()

	id, _ := q.Enqueue(ctx, user, kind, payload{Doc: "a"}, 5)
	if _, err := q.Claim(ctx, "w1", []string{kind}); err != nil {
		t.Fatalf("Claim: %v", err)
	}
	if _, err := q.Fail(ctx, id, "w1", errors.New("transient"), false); err != nil {
		t.Fatalf("Fail: %v", err)
	}
	if _, err := q.Claim(ctx, "w2", []string{kind}); !errors.Is(err, jobs.ErrNoJob) {
		t.Fatalf("a requeued job must not be immediately reclaimable; err = %v", err)
	}
}

// ── the reaper ─────────────────────────────────────────────────────────────

func TestReaperRequeuesAnExpiredLease(t *testing.T) {
	pool := testutil.TestDB(t)
	user := makeUser(t, pool)
	q := jobs.NewQueue(pool, time.Minute)
	ctx := context.Background()
	kind := "reap_" + uuid.NewString()

	id, _ := q.Enqueue(ctx, user, kind, payload{Doc: "a"}, 3)
	if _, err := q.Claim(ctx, "dead-worker", []string{kind}); err != nil {
		t.Fatalf("Claim: %v", err)
	}
	expireLease(t, pool, id)

	reaped, err := jobs.NewReaper(pool, nil, time.Minute).ReapOnce(ctx)
	if err != nil {
		t.Fatalf("ReapOnce: %v", err)
	}
	if !containsJob(reaped, id) {
		t.Fatalf("the expired job was not reaped: %+v", reaped)
	}
	j, _ := q.Get(ctx, id)
	if j.Status != jobs.StatusQueued {
		t.Fatalf("status = %q, want queued", j.Status)
	}
	if j.LastError == "" {
		t.Fatal("a reaped job must record that its worker vanished")
	}
}

func TestReaperFailsAJobOutOfAttempts(t *testing.T) {
	pool := testutil.TestDB(t)
	user := makeUser(t, pool)
	q := jobs.NewQueue(pool, time.Minute)
	ctx := context.Background()
	kind := "reapfail_" + uuid.NewString()

	id, _ := q.Enqueue(ctx, user, kind, payload{Doc: "a"}, 1)
	if _, err := q.Claim(ctx, "dead-worker", []string{kind}); err != nil {
		t.Fatalf("Claim: %v", err)
	}
	expireLease(t, pool, id)

	reaped, err := jobs.NewReaper(pool, nil, time.Minute).ReapOnce(ctx)
	if err != nil {
		t.Fatalf("ReapOnce: %v", err)
	}
	for _, r := range reaped {
		if r.ID == id && !r.Terminal {
			t.Fatal("a job out of attempts must be reaped as terminal")
		}
	}
	j, _ := q.Get(ctx, id)
	if j.Status != jobs.StatusFailed {
		t.Fatalf("status = %q, want failed", j.Status)
	}
}

// The handler runs INSIDE the reaper's transaction. If it errors, nothing
// commits — job and document stay consistent rather than half-moved.
func TestReapHandlerRunsInTheSameTransaction(t *testing.T) {
	pool := testutil.TestDB(t)
	user := makeUser(t, pool)
	q := jobs.NewQueue(pool, time.Minute)
	ctx := context.Background()
	kind := "reaphandler_" + uuid.NewString()

	id, _ := q.Enqueue(ctx, user, kind, payload{Doc: "a"}, 3)
	if _, err := q.Claim(ctx, "dead-worker", []string{kind}); err != nil {
		t.Fatalf("Claim: %v", err)
	}
	expireLease(t, pool, id)

	boom := errors.New("handler refused")
	failing := jobs.NewReaper(pool, func(context.Context, pgx.Tx, jobs.ReapedJob) error {
		return boom
	}, time.Minute)

	if _, err := failing.ReapOnce(ctx); !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the handler's error", err)
	}
	j, _ := q.Get(ctx, id)
	if j.Status != jobs.StatusRunning {
		t.Fatalf("status = %q — the job moved although the handler failed, so job and document can diverge", j.Status)
	}
}

// ── the kill-worker-mid-parse test ─────────────────────────────────────────

// The phase's named test: kill a worker mid-parse and the document must end
// `failed` or requeued — never stuck `parsing`.
//
// The kill is simulated the way it actually happens: the process stops
// heartbeating and never reports a result. Nothing cooperative happens; the
// reaper takes the row back on its own, and the reap handler moves the document
// in the same transaction.
func TestKillWorkerMidParseNeverLeavesADocumentParsing(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	user := makeUser(t, pool)
	kind := jobs.KindParseDocument

	kbID, docID := seedKBAndDocument(t, pool, user)
	q := jobs.NewQueue(pool, time.Minute)

	id, err := q.Enqueue(ctx, user, kind,
		map[string]string{"document_id": docID.String(), "kb_id": kbID.String()}, 3)
	if err != nil {
		t.Fatalf("Enqueue: %v", err)
	}

	// A worker claims it and puts the document into `parsing`...
	if _, err := q.Claim(ctx, "worker-about-to-die", []string{kind}); err != nil {
		t.Fatalf("Claim: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE documents SET status = 'parsing' WHERE id = $1`, docID); err != nil {
		t.Fatalf("set parsing: %v", err)
	}

	// ...and then dies. No Complete, no Fail, no goodbye.
	expireLease(t, pool, id)

	reaper := jobs.NewReaper(pool, reapHandlerForTest(), time.Minute)
	if _, err := reaper.ReapOnce(ctx); err != nil {
		t.Fatalf("ReapOnce: %v", err)
	}

	status := documentStatus(t, pool, docID)
	if status == "parsing" {
		t.Fatal("the document is stuck in `parsing` with no worker — the failure RT-8 named")
	}
	if status != "queued" {
		t.Fatalf("status = %q; a job with attempts left must requeue the document", status)
	}

	// Now exhaust the attempts: the document must end `failed`, with a reason.
	for i := 0; i < 3; i++ {
		if _, err := pool.Exec(ctx,
			`UPDATE jobs SET run_after = now() - interval '1 minute' WHERE id = $1`, id); err != nil {
			t.Fatalf("clear backoff: %v", err)
		}
		if _, err := q.Claim(ctx, "worker-that-also-dies", []string{kind}); err != nil {
			if errors.Is(err, jobs.ErrNoJob) {
				break
			}
			t.Fatalf("Claim: %v", err)
		}
		if _, err := pool.Exec(ctx, `UPDATE documents SET status = 'parsing' WHERE id = $1`, docID); err != nil {
			t.Fatalf("set parsing: %v", err)
		}
		expireLease(t, pool, id)
		if _, err := reaper.ReapOnce(ctx); err != nil {
			t.Fatalf("ReapOnce: %v", err)
		}
		if documentStatus(t, pool, docID) == "failed" {
			break
		}
	}

	if got := documentStatus(t, pool, docID); got != "failed" {
		t.Fatalf("after exhausting attempts the document is %q, want failed", got)
	}
	var reason string
	if err := pool.QueryRow(ctx, `SELECT error FROM documents WHERE id = $1`, docID).Scan(&reason); err != nil {
		t.Fatalf("read error: %v", err)
	}
	if reason == "" {
		t.Fatal("a failed document must tell the user why")
	}
	if j, _ := q.Get(ctx, id); j.Status != jobs.StatusFailed {
		t.Fatalf("job status = %q, want failed alongside the document", j.Status)
	}
}

// ── the advisory lock ──────────────────────────────────────────────────────

// The cron primitive phases 7 and 10 need: `try`, not `wait`. A nightly job
// that queues up behind the one already running is a nightly job that runs
// twice.
func TestAdvisoryLockIsExclusiveAndNonBlocking(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	name := "nightly-" + uuid.NewString()

	inside := make(chan struct{})
	release := make(chan struct{})
	var firstRan, secondRan bool

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		got, err := jobs.WithAdvisoryLock(ctx, pool, name, func(context.Context) error {
			firstRan = true
			close(inside)
			<-release
			return nil
		})
		if err != nil || !got {
			t.Errorf("first holder: got=%v err=%v", got, err)
		}
	}()

	<-inside
	got, err := jobs.WithAdvisoryLock(ctx, pool, name, func(context.Context) error {
		secondRan = true
		return nil
	})
	if err != nil {
		t.Fatalf("second attempt: %v", err)
	}
	if got {
		t.Fatal("two processes both held the lock")
	}
	if secondRan {
		t.Fatal("the second body ran without the lock")
	}

	close(release)
	wg.Wait()
	if !firstRan {
		t.Fatal("the first body never ran")
	}

	// Released: the next caller gets it.
	got, err = jobs.WithAdvisoryLock(ctx, pool, name, func(context.Context) error { return nil })
	if err != nil || !got {
		t.Fatalf("after release: got=%v err=%v — the lock leaked", got, err)
	}
}

func TestAdvisoryLockReleasesOnAFailingBody(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	name := "failing-" + uuid.NewString()
	boom := errors.New("body failed")

	got, err := jobs.WithAdvisoryLock(ctx, pool, name, func(context.Context) error { return boom })
	if !got {
		t.Fatal("the lock should have been taken")
	}
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the body's error", err)
	}

	got, err = jobs.WithAdvisoryLock(ctx, pool, name, func(context.Context) error { return nil })
	if err != nil || !got {
		t.Fatalf("the lock was not released after a failing body: got=%v err=%v", got, err)
	}
}

func TestAdvisoryKeyIsStableAndDistinct(t *testing.T) {
	a := jobs.AdvisoryKey("nightly-review")
	if a != jobs.AdvisoryKey("nightly-review") {
		t.Fatal("the same name must give the same key in every process")
	}
	if a == jobs.AdvisoryKey("nightly-reviews") {
		t.Fatal("different names collided")
	}
	if a < 0 {
		t.Fatal("a negative key makes every pg_locks row look like a bug")
	}
}

// ── helpers ────────────────────────────────────────────────────────────────

func expireLease(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, id); err != nil {
		t.Fatalf("expire lease: %v", err)
	}
}

func clearBackoff(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE jobs SET run_after = now() - interval '1 minute' WHERE id = $1`, id); err != nil {
		t.Fatalf("clear backoff: %v", err)
	}
}

func containsJob(list []jobs.ReapedJob, id uuid.UUID) bool {
	for _, j := range list {
		if j.ID == id {
			return true
		}
	}
	return false
}

func documentStatus(t *testing.T, pool *pgxpool.Pool, docID uuid.UUID) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM documents WHERE id = $1`, docID).Scan(&s); err != nil {
		t.Fatalf("read document status: %v", err)
	}
	return s
}

// reapHandlerForTest is the REAL production handler. Using the real one is the
// point: this test asks whether the shipped wiring keeps a document and its job
// consistent, not whether a test double can.
func reapHandlerForTest() jobs.ReapHandler { return pg.KnowledgeReapHandler() }

// seedKBAndDocument creates the rows a parse job refers to.
func seedKBAndDocument(t *testing.T, pool *pgxpool.Pool, user uuid.UUID) (uuid.UUID, uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	store := pg.NewKnowledgeStore(pool)

	kb, err := store.CreateKB(ctx, user, "Reaper KB")
	if err != nil {
		t.Fatalf("CreateKB: %v", err)
	}
	doc, err := store.CreateDocument(ctx, knowledge.Document{
		UserID: user, KBID: kb.ID, SourceKind: knowledge.SourceUpload,
		Title: "doomed.pdf", MIME: "application/pdf", Bytes: 100,
		SHA256: strings.Repeat("d", 64), PageCount: 2,
	})
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}
	return kb.ID, doc.ID
}

// A handler that panics must not take the process with it (security audit
// F-1), and must not be retried: the input that panicked it will panic again.
func TestAPanickingHandlerFailsItsJobTerminallyAndTheWorkerLives(t *testing.T) {
	pool := testutil.TestDB(t)
	user := makeUser(t, pool)
	q := jobs.NewQueue(pool, time.Minute)
	ctx := context.Background()
	kind := "panic_" + uuid.NewString()

	id, _ := q.Enqueue(ctx, user, kind, payload{Doc: "a"}, 5)
	w := jobs.NewWorker(q, "w-panic", time.Millisecond)
	w.Handle(kind, func(context.Context, *jobs.Job) error { panic("missing endobj") })

	ran, err := w.RunOnce(ctx) // reaching the next line is the test
	if err != nil || !ran {
		t.Fatalf("RunOnce: ran=%v err=%v", ran, err)
	}
	j, _ := q.Get(ctx, id)
	if j.Status != jobs.StatusFailed || j.Attempts != 1 {
		t.Fatalf("status=%q attempts=%d, want failed after 1", j.Status, j.Attempts)
	}
	if strings.Contains(j.LastError, "endobj") {
		t.Fatalf("the panic value reached the stored error: %q", j.LastError)
	}
}
