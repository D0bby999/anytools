package pg_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning/loop"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/learning/worksheet/worksheettest"
	"github.com/D0bby999/anytools/internal/store/pg"
)

type worksheetFixture struct {
	*loopFixture
	sheets *pg.WorksheetStore
	svc    *worksheet.Service
	now    time.Time
}

func newWorksheetFixture(t *testing.T) (context.Context, *worksheetFixture) {
	ctx, lf := newLoopFixture(t)
	f := &worksheetFixture{loopFixture: lf, sheets: pg.NewWorksheetStore(lf.pool)}
	f.now = time.Now().UTC()
	f.svc = worksheet.NewService(f.sheets, pg.NewUserStore(lf.pool), func() time.Time { return f.now })
	return ctx, f
}

func (f *worksheetFixture) create(t *testing.T, ctx context.Context, user uuid.UUID, kind string, state *uuid.UUID) *worksheet.Worksheet {
	t.Helper()
	w, err := f.svc.Create(ctx, user, worksheet.NewWorksheet{Kind: kind, Title: "A worksheet", StateID: state})
	if err != nil {
		t.Fatalf("create %s: %v", kind, err)
	}
	return w
}

func section(t *testing.T, fields map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestWorksheetsAreTheOwnersOnly(t *testing.T) {
	ctx, f := newWorksheetFixture(t)
	st, _ := f.start(t, ctx, f.alice, time.Now().UTC())
	w := f.create(t, ctx, f.alice, worksheettest.State, &st.ID)
	if w.StateID == nil || *w.StateID != st.ID || w.Private || w.KindVersion != 1 {
		t.Fatalf("created %+v", w)
	}

	if _, err := f.svc.Get(ctx, f.bob, w.ID); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("bob reads alice's worksheet: %v", err)
	}
	_, err := f.svc.Update(ctx, f.bob, w.ID, worksheet.Patch{Revision: w.UpdatedAt,
		Answers: map[string]json.RawMessage{"plan": section(t, map[string]any{"task": "bob's"})}})
	if !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("bob writes alice's worksheet: %v", err)
	}
	if _, err := f.svc.AppendRow(ctx, f.bob, w.ID, "notes", "free", json.RawMessage(`{"row":"","cells":{"text":"x"}}`)); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("bob appends to alice's worksheet: %v", err)
	}
	if err := f.svc.Delete(ctx, f.bob, w.ID); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("bob deletes alice's worksheet: %v", err)
	}
	if list, _ := f.svc.List(ctx, f.bob, worksheet.Filter{StateID: &st.ID}); len(list) != 0 {
		t.Errorf("bob lists alice's worksheets by her state: %v", list)
	}
	if list, _ := f.svc.List(ctx, f.alice, worksheet.Filter{StateID: &st.ID}); len(list) != 1 {
		t.Errorf("alice lists %d worksheets on her state", len(list))
	}
	got, err := f.svc.Get(ctx, f.alice, w.ID)
	if err != nil || got.Answers["plan"] != nil {
		t.Fatalf("alice's worksheet changed under bob: %+v %v", got, err)
	}
}

func TestAWorksheetCannotAttachToAnotherUsersStateOrDocument(t *testing.T) {
	ctx, f := newWorksheetFixture(t)
	bobState, _ := f.start(t, ctx, f.bob, time.Now().UTC())
	kbs := pg.NewKnowledgeStore(f.pool)
	bobKB, err := kbs.CreateKB(ctx, f.bob, "KB")
	if err != nil {
		t.Fatal(err)
	}
	bobDoc := seedDocument(t, kbs, f.bob, bobKB.ID, "bob.pdf")

	if _, err := f.svc.Create(ctx, f.alice, worksheet.NewWorksheet{Kind: worksheettest.State, Title: "t", StateID: &bobState.ID}); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("attached to bob's state: %v", err)
	}
	if _, err := f.svc.Create(ctx, f.alice, worksheet.NewWorksheet{Kind: worksheettest.Document, Title: "t", DocumentID: &bobDoc.ID}); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("attached to bob's document: %v", err)
	}
	// The store refuses on its own, without the service's check first.
	if _, err := f.sheets.Create(ctx, worksheet.Worksheet{UserID: f.alice, Kind: worksheettest.State, KindVersion: 1,
		Title: "t", Answers: worksheet.Answers{}, StateID: &bobState.ID, Status: worksheet.StatusOpen}); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("store attached to bob's state: %v", err)
	}
	// And the composite foreign key refuses even a raw INSERT.
	if _, err := f.pool.Exec(ctx, `INSERT INTO worksheets (user_id, kind, kind_version, title, private, document_id)
		VALUES ($1, 'x', 1, 't', false, $2)`, f.alice, bobDoc.ID); err == nil {
		t.Error("the composite foreign key let a worksheet onto bob's document")
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO worksheets (user_id, kind, kind_version, title, private, state_id)
		VALUES ($1, 'x', 1, 't', false, $2)`, f.alice, bobState.ID); err == nil {
		t.Error("the composite foreign key let a worksheet onto bob's state")
	}

	// A kind that is not attached to states refuses the caller's own state.
	aliceState, _ := f.start(t, ctx, f.alice, time.Now().UTC())
	if _, err := f.svc.Create(ctx, f.alice, worksheet.NewWorksheet{Kind: worksheettest.Document, Title: "t", StateID: &aliceState.ID}); !errors.Is(err, worksheet.ErrInvalid) {
		t.Errorf("a document kind on a state: %v", err)
	}
	if _, err := f.svc.Create(ctx, f.alice, worksheet.NewWorksheet{Kind: worksheettest.Document, Title: "t"}); !errors.Is(err, worksheet.ErrInvalid) {
		t.Errorf("a document kind with no document: %v", err)
	}
}

func TestDeletingADocumentDeletesItsWorksheetsAndAStateKeepsThem(t *testing.T) {
	ctx, f := newWorksheetFixture(t)
	kbs := pg.NewKnowledgeStore(f.pool)
	kb, err := kbs.CreateKB(ctx, f.alice, "KB")
	if err != nil {
		t.Fatal(err)
	}
	doc := seedDocument(t, kbs, f.alice, kb.ID, "a.pdf")
	onDoc, err := f.svc.Create(ctx, f.alice, worksheet.NewWorksheet{Kind: worksheettest.Document, Title: "t", DocumentID: &doc.ID})
	if err != nil {
		t.Fatal(err)
	}
	st, _ := f.start(t, ctx, f.alice, time.Now().UTC())
	onState := f.create(t, ctx, f.alice, worksheettest.State, &st.ID)

	if _, err := f.pool.Exec(ctx, `DELETE FROM documents WHERE id = $1`, doc.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Get(ctx, f.alice, onDoc.ID); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("a worksheet outlived its document: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `DELETE FROM learning_states WHERE id = $1`, st.ID); err != nil {
		t.Fatal(err)
	}
	kept, err := f.svc.Get(ctx, f.alice, onState.ID)
	if err != nil || kept.StateID != nil {
		t.Errorf("deleting a state should keep its worksheet, unattached: %+v %v", kept, err)
	}
}

func TestWorksheetWritesMergeBySectionAndRefuseAStaleRevision(t *testing.T) {
	ctx, f := newWorksheetFixture(t)
	w := f.create(t, ctx, f.alice, worksheettest.State, nil)
	loaded := w.UpdatedAt

	// Two tabs loaded at the same revision write different sections: both land.
	a, err := f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: loaded,
		Answers: map[string]json.RawMessage{"plan": section(t, map[string]any{"task": "Write the brief"})}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: loaded,
		Answers: map[string]json.RawMessage{"notes": section(t, map[string]any{"free": []any{map[string]any{"row": "", "cells": map[string]any{"text": "n"}}}})}}); err != nil {
		t.Fatalf("a write to another section was refused: %v", err)
	}
	got, _ := f.svc.Get(ctx, f.alice, w.ID)
	if got.Answers["plan"]["task"] != "Write the brief" || got.Answers["notes"]["free"] == nil {
		t.Fatalf("one of the two writes was lost: %v", got.Answers)
	}
	if !a.UpdatedAt.After(loaded) || !got.UpdatedAt.After(a.UpdatedAt) {
		t.Errorf("revisions do not advance: %v %v %v", loaded, a.UpdatedAt, got.UpdatedAt)
	}

	// The first tab writes "plan" again at its stale revision: refused.
	_, err = f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: loaded,
		Answers: map[string]json.RawMessage{"plan": section(t, map[string]any{"task": "overwrite"})}})
	if !errors.Is(err, worksheet.ErrConflict) {
		t.Fatalf("a stale revision: %v, want ErrConflict", err)
	}
	// At the current revision it lands, and a field it does not send is kept.
	if _, err := f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: got.UpdatedAt,
		Answers: map[string]json.RawMessage{"plan": section(t, map[string]any{"delivered": "yes"})}}); err != nil {
		t.Fatal(err)
	}
	got, _ = f.svc.Get(ctx, f.alice, w.ID)
	if got.Answers["plan"]["task"] != "Write the brief" || got.Answers["plan"]["delivered"] != "yes" {
		t.Fatalf("the section merge dropped a field: %v", got.Answers["plan"])
	}
	// null clears one field.
	if _, err := f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: got.UpdatedAt,
		Answers: map[string]json.RawMessage{"plan": json.RawMessage(`{"task": null}`)}}); err != nil {
		t.Fatal(err)
	}
	got, _ = f.svc.Get(ctx, f.alice, w.ID)
	if _, has := got.Answers["plan"]["task"]; has || got.Answers["plan"]["delivered"] != "yes" {
		t.Fatalf("null should clear one field: %v", got.Answers["plan"])
	}

	// An appended row stamps its section: a PATCH of that table at an older
	// revision is refused rather than dropping the row.
	before := got.UpdatedAt
	if _, err := f.svc.AppendRow(ctx, f.alice, w.ID, "notes", "free", json.RawMessage(`{"row":"","cells":{"text":"from the toolbar"}}`)); err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: before,
		Answers: map[string]json.RawMessage{"notes": section(t, map[string]any{"free": []any{}})}})
	if !errors.Is(err, worksheet.ErrConflict) {
		t.Errorf("a stale PATCH over an appended row: %v", err)
	}
}

func TestRowAppendsAreCappedUnderTheRowLock(t *testing.T) {
	ctx, f := newWorksheetFixture(t)
	w := f.create(t, ctx, f.alice, worksheettest.State, nil)
	var wg sync.WaitGroup
	var mu sync.Mutex
	ok, refused := 0, 0
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := f.svc.AppendRow(ctx, f.alice, w.ID, "notes", "free", json.RawMessage(`{"row":"","cells":{"text":"x"}}`))
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				ok++
			case errors.Is(err, worksheet.ErrInvalid):
				refused++
			default:
				t.Errorf("append: %v", err)
			}
		}()
	}
	wg.Wait()
	got, _ := f.svc.Get(ctx, f.alice, w.ID)
	rows, _ := got.Answers["notes"]["free"].([]any)
	if ok != 2 || refused != 4 || len(rows) != 2 {
		t.Fatalf("MaxRows 2: %d appended, %d refused, %d stored", ok, refused, len(rows))
	}
}

func TestDatedRowsOpenOnTheirReviewDate(t *testing.T) {
	ctx, f := newWorksheetFixture(t)
	// Alice lives in Hanoi; her day 0 is the 1st.
	if _, err := pg.NewUserStore(f.pool).SetTimezone(ctx, f.alice, "Asia/Ho_Chi_Minh", false); err != nil {
		t.Fatal(err)
	}
	f.now = time.Date(2026, 10, 1, 1, 0, 0, 0, time.UTC) // 08:00 in Hanoi
	w := f.create(t, ctx, f.alice, worksheettest.State, nil)
	if r := w.Reviews["day7"]; r.Due != "2026-10-08" || r.Earliest != "2026-10-08" {
		t.Fatalf("day7 scheduled %+v", r)
	}
	if _, has := w.Reviews["after_delivery"]; has {
		t.Fatalf("a review counted from delivery is scheduled before delivery: %+v", w.Reviews)
	}
	day7 := func(rev time.Time, result string) error {
		_, err := f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: rev,
			Answers: map[string]json.RawMessage{"retest": section(t, map[string]any{"timeline": []any{
				map[string]any{"row": "day0", "cells": map[string]any{"result": "first"}},
				map[string]any{"row": "day7", "cells": map[string]any{"result": result}},
			}})}})
		return err
	}
	// Day 2: the Day 7 row is refused; the Day 0 row alone is fine.
	f.now = time.Date(2026, 10, 2, 1, 0, 0, 0, time.UTC)
	if err := day7(w.UpdatedAt, "too soon"); !errors.Is(err, worksheet.ErrTooEarly) {
		t.Fatalf("day 7 row on day 2: %v, want ErrTooEarly", err)
	}
	w, err := f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: w.UpdatedAt,
		Answers: map[string]json.RawMessage{"retest": section(t, map[string]any{"timeline": []any{
			map[string]any{"row": "day0", "cells": map[string]any{"result": "first"}}}})}})
	if err != nil {
		t.Fatal(err)
	}
	// Moving the review earlier than its anchor allows is refused; later is fine.
	early, later := "2026-10-05", "2026-10-09"
	if _, err := f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: w.UpdatedAt,
		Reviews: map[string]worksheet.ReviewPatch{"day7": {Due: &early}}}); !errors.Is(err, worksheet.ErrTooEarly) {
		t.Fatalf("moved before its anchor: %v", err)
	}
	if w, err = f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: w.UpdatedAt,
		Reviews: map[string]worksheet.ReviewPatch{"day7": {Due: &later}}}); err != nil {
		t.Fatal(err)
	}
	// 2026-10-08 at 23:30 in Hanoi is still before the moved date.
	f.now = time.Date(2026, 10, 8, 16, 30, 0, 0, time.UTC)
	if err := day7(w.UpdatedAt, "still early"); !errors.Is(err, worksheet.ErrTooEarly) {
		t.Fatalf("day 7 row before the moved date: %v", err)
	}
	// 2026-10-08 at 17:30 UTC is already the 9th in Hanoi.
	f.now = time.Date(2026, 10, 8, 17, 30, 0, 0, time.UTC)
	if err := day7(w.UpdatedAt, "retest"); err != nil {
		t.Fatalf("day 7 row on its (local) day: %v", err)
	}
	got, _ := f.svc.Get(ctx, f.alice, w.ID)
	if !got.Reviews["day7"].Done {
		t.Errorf("writing the dated row should complete its review: %+v", got.Reviews["day7"])
	}
}

func TestReviewsCountFromTheirAnchors(t *testing.T) {
	ctx, f := newWorksheetFixture(t)
	f.now = time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	w := f.create(t, ctx, f.alice, worksheettest.State, nil)
	f.now = time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	w, err := f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: w.UpdatedAt,
		Answers: map[string]json.RawMessage{"plan": section(t, map[string]any{"delivered": "v1 sent", "review_on": "2026-11-02"})}})
	if err != nil {
		t.Fatal(err)
	}
	if r := w.Reviews["after_delivery"]; r.Due != "2026-10-07" {
		t.Errorf("three days after the delivery was first written: %+v", r)
	}
	if r := w.Reviews["chosen"]; r.Due != "2026-11-02" {
		t.Errorf("the written review date: %+v", r)
	}
	// Rewriting the delivery does not move its review; rewriting the date does.
	f.now = time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	w, err = f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: w.UpdatedAt,
		Answers: map[string]json.RawMessage{"plan": section(t, map[string]any{"delivered": "v2 sent", "review_on": "2026-11-09"})}})
	if err != nil {
		t.Fatal(err)
	}
	if w.Reviews["after_delivery"].Due != "2026-10-07" || w.Reviews["chosen"].Due != "2026-11-09" {
		t.Errorf("anchors after a rewrite: %+v", w.Reviews)
	}
	// Clearing the date unschedules its review.
	w, err = f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: w.UpdatedAt,
		Answers: map[string]json.RawMessage{"plan": json.RawMessage(`{"review_on": null}`)}})
	if err != nil {
		t.Fatal(err)
	}
	if _, has := w.Reviews["chosen"]; has {
		t.Errorf("a cleared date leaves its review scheduled: %+v", w.Reviews)
	}
}

func TestDueListsOpenWorksheetsOnTheLearnersDayAndHidesPrivateTitles(t *testing.T) {
	ctx, f := newWorksheetFixture(t)
	if _, err := pg.NewUserStore(f.pool).SetTimezone(ctx, f.alice, "Asia/Ho_Chi_Minh", false); err != nil {
		t.Fatal(err)
	}
	f.now = time.Date(2026, 10, 1, 1, 0, 0, 0, time.UTC)
	open := f.create(t, ctx, f.alice, worksheettest.State, nil)
	closed := f.create(t, ctx, f.alice, worksheettest.State, nil)
	if _, err := f.svc.Update(ctx, f.alice, closed.ID, worksheet.Patch{Revision: closed.UpdatedAt, Status: ptr(worksheet.StatusDone)}); err != nil {
		t.Fatal(err)
	}
	// A private worksheet with a review: schedule one by hand, as a private
	// kind of a later phase would.
	private, err := f.svc.Create(ctx, f.alice, worksheet.NewWorksheet{Kind: worksheettest.Private, Title: "PRIVATE-TITLE-MARKER"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE worksheets SET reviews = '{"day7":{"due":"2026-10-08","earliest":"2026-10-08"}}' WHERE id = $1`, private.ID); err != nil {
		t.Fatal(err)
	}

	// 2026-10-07 23:30 in Hanoi: nothing yet.
	f.now = time.Date(2026, 10, 7, 16, 30, 0, 0, time.UTC)
	if due, err := f.svc.Due(ctx, f.alice); err != nil || len(due) != 0 {
		t.Fatalf("due the day before: %v %v", due, err)
	}
	// 2026-10-08 00:30 in Hanoi, still the 7th in UTC: both open ones are due.
	f.now = time.Date(2026, 10, 7, 17, 30, 0, 0, time.UTC)
	due, err := f.svc.Due(ctx, f.alice)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[uuid.UUID]worksheet.DueReview{}
	for _, d := range due {
		ids[d.ID] = d
	}
	if len(due) != 2 || ids[open.ID].Review != "day7" || ids[open.ID].Label != "Day 7 retest" {
		t.Fatalf("due on the learner's day: %+v", due)
	}
	if _, has := ids[closed.ID]; has {
		t.Error("a done worksheet is listed as due")
	}
	if p := ids[private.ID]; p.Title != worksheet.PrivateTitle || !p.Private {
		t.Errorf("a private worksheet's due entry: %+v", p)
	}
	raw, _ := json.Marshal(due)
	if strings.Contains(string(raw), "PRIVATE-TITLE-MARKER") {
		t.Error("the due list carries a private title")
	}
	if due, _ := f.svc.Due(ctx, f.bob); len(due) != 0 {
		t.Errorf("bob sees alice's due reviews: %v", due)
	}

	// Marking the review done takes it off the list.
	w, _ := f.svc.Get(ctx, f.alice, open.ID)
	if _, err := f.svc.Update(ctx, f.alice, open.ID, worksheet.Patch{Revision: w.UpdatedAt,
		Reviews: map[string]worksheet.ReviewPatch{"day7": {Done: ptr(true)}}}); err != nil {
		t.Fatal(err)
	}
	if due, _ := f.svc.Due(ctx, f.alice); len(due) != 1 {
		t.Errorf("a done review is still due: %+v", due)
	}
}

func TestPrivateWorksheetsAreNeverEvidence(t *testing.T) {
	ctx, f := newWorksheetFixture(t)
	st, c := f.start(t, ctx, f.alice, time.Now().UTC().Add(-time.Hour))
	private := f.create(t, ctx, f.alice, worksheettest.Private, &st.ID)
	public := f.create(t, ctx, f.alice, worksheettest.State, &st.ID)
	elsewhere := f.create(t, ctx, f.alice, worksheettest.State, nil)

	if ok, _ := f.store.OwnsTarget(ctx, f.alice, loop.KindWorksheet, private.ID); ok {
		t.Error("OwnsTarget accepts a private worksheet")
	}
	if ok, _ := f.store.OwnsTarget(ctx, f.bob, loop.KindWorksheet, public.ID); ok {
		t.Error("OwnsTarget accepts another user's worksheet")
	}
	if ok, err := f.store.OwnsTarget(ctx, f.alice, loop.KindWorksheet, public.ID); err != nil || !ok {
		t.Fatalf("OwnsTarget refuses the owner's worksheet: %v %v", ok, err)
	}

	cands, err := f.store.Candidates(ctx, f.alice, st.ID, c.StartedAt, time.Now().UTC().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	var found []uuid.UUID
	for _, cand := range cands {
		if cand.Kind == loop.KindWorksheet {
			found = append(found, cand.RefID)
			if cand.Detail != "Fixture: state" || cand.Link != "/toolkit/"+cand.RefID.String() {
				t.Errorf("worksheet candidate: %+v", cand)
			}
		}
	}
	if len(found) != 1 || found[0] != public.ID {
		t.Fatalf("worksheet candidates = %v, want only %s (private %s, unattached %s)", found, public.ID, private.ID, elsewhere.ID)
	}

	// A ref to a private worksheet that got into the table anyway (a kind
	// turned private, a bug elsewhere) resolves to nothing.
	review, err := f.store.CreateReview(ctx, f.alice, c.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO evidence_refs (user_id, review_id, kind, ref_id, status, suggested_by)
		VALUES ($1, $2, 'worksheet', $3, 'accepted', 'user')`, f.alice, review.ID, private.ID); err != nil {
		t.Fatal(err)
	}
	refs, err := f.store.ListEvidence(ctx, f.alice, &review.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].Target != nil {
		t.Fatalf("a private worksheet resolved as evidence: %+v", refs)
	}
}

func ptr[T any](v T) *T { return &v }

// Phase 6: the grammar error map is kept for a goal or for a document. Both
// are resolved with the owner, and a map on a document goes with it.
func TestTheGrammarErrorMapAttachesToTheOwnersStateOrDocument(t *testing.T) {
	ctx, f := newWorksheetFixture(t)
	kbs := pg.NewKnowledgeStore(f.pool)
	aliceKB, err := kbs.CreateKB(ctx, f.alice, "KB")
	if err != nil {
		t.Fatal(err)
	}
	bobKB, err := kbs.CreateKB(ctx, f.bob, "KB")
	if err != nil {
		t.Fatal(err)
	}
	aliceDoc := seedDocument(t, kbs, f.alice, aliceKB.ID, "essay.pdf")
	bobDoc := seedDocument(t, kbs, f.bob, bobKB.ID, "bob.pdf")
	bobState, _ := f.start(t, ctx, f.bob, time.Now().UTC())
	map_ := func(state, doc *uuid.UUID) (*worksheet.Worksheet, error) {
		return f.svc.Create(ctx, f.alice, worksheet.NewWorksheet{Kind: worksheet.GrammarErrorMapKind, Title: "Map", StateID: state, DocumentID: doc})
	}

	if _, err := map_(nil, &bobDoc.ID); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("a map on bob's document: %v", err)
	}
	if _, err := map_(&bobState.ID, nil); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("a map on bob's state: %v", err)
	}
	aliceState, _ := f.start(t, ctx, f.alice, time.Now().UTC())
	onState, err := map_(&aliceState.ID, nil)
	if err != nil || onState.StateID == nil || *onState.StateID != aliceState.ID {
		t.Fatalf("a map on alice's state: %+v %v", onState, err)
	}
	onDoc, err := map_(nil, &aliceDoc.ID)
	if err != nil || onDoc.DocumentID == nil || *onDoc.DocumentID != aliceDoc.ID {
		t.Fatalf("a map on alice's document: %+v %v", onDoc, err)
	}
	if _, err := map_(nil, nil); err != nil {
		t.Errorf("an unattached map: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `DELETE FROM documents WHERE id = $1`, aliceDoc.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Get(ctx, f.alice, onDoc.ID); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("a map outlived its document: %v", err)
	}
}
