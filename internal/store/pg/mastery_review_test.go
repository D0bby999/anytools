package pg_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/capabilities/mastery"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// mastery_review_test.go proves the cross-path review's two reads: the due
// candidates (bounded, due-only, active paths, the caller's rows) and the
// latest attempt the interleaving rule starts from (up-methods phase 12).

// seedReviewPath gives user a path of one module holding n points, each due
// at dueAt, and returns the path, the module and the points.
func seedReviewPath(t *testing.T, ctx context.Context, pool *pgxpool.Pool, user uuid.UUID, goal string,
	n int, dueAt time.Time,
) (path, module uuid.UUID, points []uuid.UUID) {
	t.Helper()
	var kb uuid.UUID
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("seed review path: %v", err)
		}
	}
	must(pool.QueryRow(ctx, `INSERT INTO knowledge_bases (user_id, name) VALUES ($1, 'Review KB') RETURNING id`, user).Scan(&kb))
	must(pool.QueryRow(ctx, `INSERT INTO mastery_paths (user_id, kb_id, goal) VALUES ($1, $2, $3) RETURNING id`, user, kb, goal).Scan(&path))
	must(pool.QueryRow(ctx, `INSERT INTO mastery_modules (user_id, path_id, ord, name) VALUES ($1, $2, 0, $3) RETURNING id`,
		user, path, goal+" module").Scan(&module))
	rows, err := pool.Query(ctx, `
		INSERT INTO knowledge_points (user_id, module_id, name, type)
		SELECT $1, $2, 'point ' || g, 'concept' FROM generate_series(1, $3::int) g
		RETURNING id`, user, module, n)
	must(err)
	for rows.Next() {
		var id uuid.UUID
		must(rows.Scan(&id))
		points = append(points, id)
	}
	must(rows.Err())
	_, err = pool.Exec(ctx, `
		INSERT INTO kp_state (kp_id, user_id, due_at, mastery_estimate)
		SELECT kp.id, kp.user_id, $3, 0.4 FROM knowledge_points kp WHERE kp.user_id = $1 AND kp.module_id = $2`,
		user, module, dueAt)
	must(err)
	return path, module, points
}

func TestReviewCandidatesAreBoundedDueOnlyAndTheCallers(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	store := pg.NewMasteryStore(pool)
	now := time.Now().UTC()
	user, stranger := testutil.NewUser(t, pool), testutil.NewUser(t, pool)

	// A thousand-point path, all due.
	big, bigModule, _ := seedReviewPath(t, ctx, pool, user, "Big", 1000, now.Add(-time.Hour))
	// A second path due earlier, so it leads; one point not yet due.
	small, _, smallPoints := seedReviewPath(t, ctx, pool, user, "Small", 3, now.Add(-2*time.Hour))
	if _, err := pool.Exec(ctx, `UPDATE kp_state SET due_at = $2 WHERE kp_id = $1`, smallPoints[2], now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	// An archived path's due points are not reviewed.
	archived, _, _ := seedReviewPath(t, ctx, pool, user, "Archived", 2, now.Add(-3*time.Hour))
	if err := store.ArchivePath(ctx, user, archived); err != nil {
		t.Fatal(err)
	}
	// Someone else's due points never appear.
	_, _, strangerPoints := seedReviewPath(t, ctx, pool, stranger, "Stranger", 5, now.Add(-4*time.Hour))

	got, err := store.ReviewCandidates(ctx, user, now, mastery.ReviewCandidateLimit)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != mastery.ReviewCandidateLimit {
		t.Fatalf("a 1,000-point path returned %d candidates, want %d", len(got), mastery.ReviewCandidateLimit)
	}
	foreign := map[uuid.UUID]bool{}
	for _, id := range strangerPoints {
		foreign[id] = true
	}
	for i, c := range got {
		if foreign[c.KPID] {
			t.Fatalf("candidate %d is the stranger's point", i)
		}
		if c.DueAt.After(now) {
			t.Fatalf("candidate %d is not due: %v", i, c.DueAt)
		}
		if c.PathID != big && c.PathID != small {
			t.Fatalf("candidate %d is from path %s (archived)", i, c.PathID)
		}
	}
	// Oldest due first: the small path's two due points lead.
	if got[0].PathID != small || got[1].PathID != small || got[2].PathID != big {
		t.Fatalf("order = %s, %s, %s; want the earlier-due path first", got[0].PathGoal, got[1].PathGoal, got[2].PathGoal)
	}
	// The module columns Rank needs are filled.
	last := got[len(got)-1]
	if last.ModuleID != bigModule || last.ModuleName != "Big module" || last.PathGoal != "Big" ||
		last.ModuleMastery < 0.39 || last.ModuleMastery > 0.41 || last.MasteryEstimate < 0.39 {
		t.Fatalf("candidate = %+v", last)
	}

	none, err := store.ReviewCandidates(ctx, testutil.NewUser(t, pool), now, mastery.ReviewCandidateLimit)
	if err != nil || len(none) != 0 {
		t.Fatalf("a user with nothing = %d, %v", len(none), err)
	}
}

func TestLastAttemptedPointIsTheCallersLatestAcrossPaths(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	store := pg.NewMasteryStore(pool)
	now := time.Now().UTC()
	user, stranger := testutil.NewUser(t, pool), testutil.NewUser(t, pool)

	if _, ok, err := store.LastAttemptedPoint(ctx, user); err != nil || ok {
		t.Fatalf("no attempts = %v, %v; want none", ok, err)
	}

	_, moduleA, pointsA := seedReviewPath(t, ctx, pool, user, "A", 1, now)
	_, moduleB, pointsB := seedReviewPath(t, ctx, pool, user, "B", 1, now)
	_, moduleS, pointsS := seedReviewPath(t, ctx, pool, stranger, "S", 1, now)
	attempt := func(owner, kp, module uuid.UUID, at time.Time) {
		t.Helper()
		var kb, q uuid.UUID
		if err := pool.QueryRow(ctx, `SELECT p.kb_id FROM mastery_modules m JOIN mastery_paths p ON p.id = m.path_id WHERE m.id = $1`,
			module).Scan(&kb); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(ctx, `INSERT INTO questions (user_id, kb_id, knowledge_point_id, module_id, prompt, type, answer)
			VALUES ($1, $2, $3, $4, 'q', 'short', 'a') RETURNING id`, owner, kb, kp, module).Scan(&q); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO question_attempts (user_id, question_id, knowledge_point_id, module_id, user_answer, is_correct, rating, created_at)
			VALUES ($1, $2, $3, $4, 'x', true, 'good', $5)`, owner, q, kp, module, at); err != nil {
			t.Fatal(err)
		}
	}
	attempt(user, pointsA[0], moduleA, now.Add(-2*time.Minute))
	attempt(user, pointsB[0], moduleB, now.Add(-time.Minute))
	// The stranger answered last of all; it must not be this user's "previous".
	attempt(stranger, pointsS[0], moduleS, now)

	got, ok, err := store.LastAttemptedPoint(ctx, user)
	if err != nil || !ok || got != pointsB[0] {
		t.Fatalf("last attempted = %s, %v, %v; want path B's point", got, ok, err)
	}
}
