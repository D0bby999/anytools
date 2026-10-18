package jobs_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Up-methods phase 21: the built-in engine's line. A job waits behind the
// running one and those queued before it, across users, and only its own
// kind counts.
func TestAheadCountsTheLineOfOneKind(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	// The line is server-wide, so this test has the kind to itself.
	kind := "transcribe_builtin_test_" + uuid.NewString()[:8]
	q := jobs.NewQueue(pool, time.Minute)
	alice, bob := makeUser(t, pool), makeUser(t, pool)

	doc := uuid.New()
	first, _ := q.Enqueue(ctx, alice, kind, map[string]any{"document_id": uuid.New()}, 2)
	second, _ := q.Enqueue(ctx, bob, kind, map[string]any{"document_id": doc}, 2)
	third, _ := q.Enqueue(ctx, alice, kind, map[string]any{"document_id": uuid.New()}, 2)
	if _, err := q.Enqueue(ctx, alice, "other_kind_"+uuid.NewString()[:8], map[string]any{}, 2); err != nil {
		t.Fatal(err)
	}

	ahead := func(id uuid.UUID) int {
		t.Helper()
		n, ok, err := q.Ahead(ctx, id)
		if err != nil || !ok {
			t.Fatalf("ahead %s: %d %v %v", id, n, ok, err)
		}
		return n
	}
	if a, b, c := ahead(first), ahead(second), ahead(third); a != 0 || b != 1 || c != 2 {
		t.Fatalf("queued: %d %d %d", a, b, c)
	}
	if n, err := q.Waiting(ctx, kind); err != nil || n != 3 {
		t.Fatalf("waiting %d %v", n, err)
	}

	// The first starts: it is running, with nothing ahead; the others still
	// wait behind it.
	job, err := q.Claim(ctx, "w", []string{kind})
	if err != nil || job.ID != first {
		t.Fatalf("claimed %v %v", job, err)
	}
	if a, b := ahead(first), ahead(second); a != 0 || b != 1 {
		t.Fatalf("running: %d %d", a, b)
	}
	if err := q.Complete(ctx, first, "w"); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := q.Ahead(ctx, first); ok {
		t.Fatal("a finished job is still in line")
	}
	if b := ahead(second); b != 0 {
		t.Fatalf("after the first finished: %d", b)
	}

	// Found by its document, for the page; another user's is not.
	if id, ok, err := q.ActiveFor(ctx, bob, kind, doc); err != nil || !ok || id != second {
		t.Fatalf("active for bob: %v %v %v", id, ok, err)
	}
	if _, ok, _ := q.ActiveFor(ctx, alice, kind, doc); ok {
		t.Fatal("alice found bob's job")
	}
}
