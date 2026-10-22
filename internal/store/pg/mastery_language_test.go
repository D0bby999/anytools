package pg_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/mastery"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// A path's language and a kept point's "not in your documents" mark survive
// the round trip, and a lesson in each language is its own cache entry
// (the private design notes, phase 4).
func TestMasteryKeepsAPathsLanguageAndItsUncoveredPoints(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	store := pg.NewMasteryStore(pool)
	user, other := testutil.NewUser(t, pool), testutil.NewUser(t, pool)
	var kb uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO knowledge_bases (user_id, name) VALUES ($1, 'KB') RETURNING id`, user).Scan(&kb); err != nil {
		t.Fatal(err)
	}
	path, err := store.CreatePath(ctx, mastery.Path{UserID: user, KBID: kb, Goal: "small talk", ExplainLang: "vi"})
	if err != nil || path.ExplainLang != "vi" {
		t.Fatalf("create: %+v %v", path, err)
	}
	if got, err := store.SetExplainLang(ctx, user, path.ID, "source"); err != nil || got.ExplainLang != "source" {
		t.Fatalf("set: %+v %v", got, err)
	}
	if _, err := store.SetExplainLang(ctx, other, path.ID, "en"); !errors.Is(err, mastery.ErrNotFound) {
		t.Fatalf("another user changed the path: %v", err)
	}
	if _, err := store.SetExplainLang(ctx, user, path.ID, "Vietnamese"); err == nil {
		t.Fatal("the column took a language name")
	}

	detail, err := store.ApproveModules(ctx, user, path.ID, []mastery.ProposedModule{{
		Name: "Openers", PassThreshold: 0.7,
		KnowledgePoints: []mastery.ProposedKP{
			{Name: "Asking about the weekend", Type: "concept"},
			{Name: "Adapting tone to the listener", Type: "concept", OutsideSource: true},
		},
	}}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	marked := map[string]bool{}
	for _, kp := range detail.Modules[0].KnowledgePoints {
		marked[kp.KnowledgePoint.Name] = kp.KnowledgePoint.OutsideSource
	}
	if !marked["Adapting tone to the listener"] || marked["Asking about the weekend"] {
		t.Fatalf("marks = %v", marked)
	}

	kp := detail.Modules[0].KnowledgePoints[0].KnowledgePoint.ID
	for _, lang := range []string{"vi", "en"} {
		if _, err := store.SaveExplanation(ctx, mastery.Explanation{
			UserID: user, KnowledgePointID: kp, Model: "m", BodyMD: "lesson " + lang, Lang: lang,
		}, nil); err != nil {
			t.Fatal(err)
		}
	}
	vi, err := store.Explanation(ctx, user, kp, "m", 0, "vi")
	if err != nil || vi.BodyMD != "lesson vi" {
		t.Fatalf("vi: %+v %v", vi, err)
	}
	if _, err := store.Explanation(ctx, user, kp, "m", 0, ""); !errors.Is(err, mastery.ErrNotFound) {
		t.Fatalf("an unasked language was served: %v", err)
	}
}
