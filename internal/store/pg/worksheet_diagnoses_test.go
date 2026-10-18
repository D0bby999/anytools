package pg_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/capabilities/writingdiag"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/store/pg"
)

func TestWorksheetDiagnosesAreOnePerPassAndDraftAndTheOwnersOnly(t *testing.T) {
	ctx, f := newWorksheetFixture(t)
	w := f.create(t, ctx, f.alice, worksheet.WritingEvidenceKind, nil)
	store := pg.NewWorksheetDiagnosisStore(f.pool)
	draftA, draftB := strings.Repeat("a", 64), strings.Repeat("b", 64)
	diag := func(sha, problem string) writingdiag.Diagnosis {
		return writingdiag.Diagnosis{WorksheetID: w.ID, Pass: 2, DraftSHA256: sha, Model: "m", CreatedAt: time.Now().UTC(),
			Issues: []writingdiag.Issue{{Quote: "q", Problem: problem, Basis: "b", Confidence: "low", MightBeWrong: "m"}}}
	}

	first, err := store.Save(ctx, f.alice, diag(draftA, "first"))
	if err != nil || first.Pass != 2 || first.Issues[0].Problem != "first" {
		t.Fatalf("save: %+v %v", first, err)
	}
	// The same pass of the same draft: the stored one, not a second.
	again, err := store.Save(ctx, f.alice, diag(draftA, "second"))
	if err != nil || again.ID != first.ID || again.Issues[0].Problem != "first" {
		t.Fatalf("a second save of the same pass and draft: %+v %v", again, err)
	}
	if _, err := store.Save(ctx, f.alice, diag(draftB, "edited draft")); err != nil {
		t.Fatal(err)
	}
	if got, err := store.Find(ctx, f.alice, w.ID, 2, draftA); err != nil || got == nil || got.ID != first.ID {
		t.Fatalf("find: %+v %v", got, err)
	}
	if got, err := store.Find(ctx, f.alice, w.ID, 3, draftA); err != nil || got != nil {
		t.Fatalf("find an undiagnosed pass: %+v %v", got, err)
	}
	if list, err := store.List(ctx, f.alice, w.ID, draftB); err != nil || len(list) != 1 || list[0].Issues[0].Problem != "edited draft" {
		t.Fatalf("list one draft: %+v %v", list, err)
	}

	// Bob reads nothing of Alice's and cannot write onto her worksheet, even
	// for a pass and draft she already has.
	if got, err := store.Find(ctx, f.bob, w.ID, 2, draftA); err != nil || got != nil {
		t.Errorf("bob found alice's diagnosis: %+v %v", got, err)
	}
	if list, _ := store.List(ctx, f.bob, w.ID, draftA); len(list) != 0 {
		t.Errorf("bob listed alice's diagnoses: %+v", list)
	}
	for _, sha := range []string{draftA, strings.Repeat("c", 64)} {
		if _, err := store.Save(ctx, f.bob, diag(sha, "bob")); !errors.Is(err, writingdiag.ErrNotFound) {
			t.Errorf("bob saved onto alice's worksheet (%s…): %v", sha[:1], err)
		}
	}

	// A diagnosis goes with its worksheet.
	if err := f.svc.Delete(ctx, f.alice, w.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM worksheet_diagnoses WHERE worksheet_id = $1`, w.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("%d diagnoses outlived their worksheet (%v)", n, err)
	}
}
