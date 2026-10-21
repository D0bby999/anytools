package pg_test

import (
	"context"
	"testing"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/capabilities/quiz/starters"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// The Library's question sets (the private design notes,
// phase 5): a part goes into a knowledge base once, and only the caller's
// knowledge base counts as having it.
func TestAQuestionSetPartIsAddedOnceToTheRightKnowledgeBase(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	store := pg.NewQuestionStore(pool)
	kbs := pg.NewKnowledgeStore(pool)
	alice, bob := testutil.NewUser(t, pool), testutil.NewUser(t, pool)
	aliceKB, err := kbs.CreateKB(ctx, alice, "General knowledge")
	if err != nil {
		t.Fatal(err)
	}
	otherKB, err := kbs.CreateKB(ctx, alice, "Physics")
	if err != nil {
		t.Fatal(err)
	}
	bobKB, err := kbs.CreateKB(ctx, bob, "Bob's")
	if err != nil {
		t.Fatal(err)
	}
	svc := quiz.NewService(quiz.Config{Store: store, Authz: authz.New(kbs)})

	_, p, ok := starters.QuestionPart(starters.SetTrivia, "general-knowledge-1")
	if !ok {
		t.Fatal("no general-knowledge-1")
	}
	first, err := svc.AddSet(ctx, alice, aliceKB.ID, starters.SetTrivia, "general-knowledge-1")
	if err != nil || first.Added != len(p.Questions) || first.Already != 0 {
		t.Fatalf("first: %+v, %v", first, err)
	}
	again, err := svc.AddSet(ctx, alice, aliceKB.ID, starters.SetTrivia, "general-knowledge-1")
	if err != nil || again.Added != 0 || again.Already != len(p.Questions) {
		t.Fatalf("again: %+v, %v", again, err)
	}
	// Another of Alice's knowledge bases, and Bob's, have none of it.
	if other, err := svc.AddSet(ctx, alice, otherKB.ID, starters.SetTrivia, "general-knowledge-1"); err != nil || other.Added != len(p.Questions) {
		t.Fatalf("Alice's other knowledge base: %+v, %v", other, err)
	}
	if res, err := svc.AddSet(ctx, bob, bobKB.ID, starters.SetTrivia, "general-knowledge-1"); err != nil || res.Already != 0 {
		t.Fatalf("Bob: %+v, %v", res, err)
	}
	if _, err := svc.AddSet(ctx, bob, aliceKB.ID, starters.SetTrivia, "general-knowledge-2"); err != quiz.ErrNoAccess {
		t.Fatalf("Bob adding to Alice's knowledge base: %v", err)
	}

	// The Python set, past the 50 newest the bank's list shows: its second part
	// added twice is added once.
	for _, part := range []string{"1", "2", "3", "2"} {
		if _, err := svc.AddSet(ctx, alice, aliceKB.ID, starters.SetPython, part); err != nil {
			t.Fatalf("python %s: %v", part, err)
		}
	}
	var code int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM questions WHERE kb_id = $1 AND type = 'code'`, aliceKB.ID).Scan(&code); err != nil || code != 3*starters.PythonPart {
		t.Fatalf("code questions: %d, %v", code, err)
	}
}
