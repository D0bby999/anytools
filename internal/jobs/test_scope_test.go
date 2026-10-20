package jobs_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/testutil"
)

// A job another test process enqueued (here: inserted without this process's
// Enqueue, for a user it never enqueued for) is not this process's to claim.
func TestATestProcessClaimsOnlyItsOwnUsersJobs(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	q := jobs.NewQueue(pool, time.Minute)
	kind := "scope-test-" + t.Name()

	stranger := testutil.NewUser(t, pool)
	if _, err := pool.Exec(ctx, `INSERT INTO jobs (user_id, kind, payload, max_attempts) VALUES ($1, $2, '{}', 1)`,
		stranger, kind); err != nil {
		t.Fatal(err)
	}
	if _, err := q.Claim(ctx, "w", []string{kind}); !errors.Is(err, jobs.ErrNoJob) {
		t.Fatalf("claimed another process's job: %v", err)
	}

	own := testutil.NewUser(t, pool)
	id, err := q.Enqueue(ctx, own, kind, struct{}{}, 1)
	if err != nil {
		t.Fatal(err)
	}
	job, err := q.Claim(ctx, "w", []string{kind})
	if err != nil || job.ID != id {
		t.Fatalf("own job not claimed: %v %v", job, err)
	}
}
