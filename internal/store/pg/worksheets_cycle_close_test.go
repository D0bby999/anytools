package pg_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/learning/worksheet/worksheettest"
)

func (f *worksheetFixture) closeCycle(t *testing.T, ctx context.Context, user uuid.UUID, cycle uuid.UUID, state *uuid.UUID) (*worksheet.Worksheet, error) {
	t.Helper()
	return f.svc.Create(ctx, user, worksheet.NewWorksheet{
		Kind: worksheet.CycleCloseKind, Title: "Close", StateID: state, CycleID: &cycle})
}

// Up methods, phase 10: one close per cycle, of the caller's own cycle, of
// the worksheet's own learning state, and only by the kind that closes
// cycles.
func TestACycleHasOneCloseOfItsOwnState(t *testing.T) {
	ctx, f := newWorksheetFixture(t)
	st, cyc := f.start(t, ctx, f.alice, time.Now().UTC())

	// With no state named, the cycle's state is the worksheet's.
	w, err := f.closeCycle(t, ctx, f.alice, cyc.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if w.CycleID == nil || *w.CycleID != cyc.ID || w.StateID == nil || *w.StateID != st.ID {
		t.Fatalf("created %+v", w)
	}
	got, err := f.svc.Get(ctx, f.alice, w.ID)
	if err != nil || got.CycleID == nil || *got.CycleID != cyc.ID {
		t.Fatalf("read back %+v %v", got, err)
	}
	list, err := f.svc.List(ctx, f.alice, worksheet.Filter{StateID: &st.ID})
	if err != nil || len(list) != 1 || list[0].CycleID == nil || *list[0].CycleID != cyc.ID {
		t.Fatalf("listed %+v %v", list, err)
	}

	// A second close of the same cycle, with the state named this time.
	if _, err := f.closeCycle(t, ctx, f.alice, cyc.ID, &st.ID); !errors.Is(err, worksheet.ErrCycleClosed) {
		t.Fatalf("a second close: %v", err)
	}
	// Bob's cycle answers like a missing one, named alone or with his state.
	bobState, bobCycle := f.start(t, ctx, f.bob, time.Now().UTC())
	if _, err := f.closeCycle(t, ctx, f.alice, bobCycle.ID, nil); !errors.Is(err, worksheet.ErrNotFound) {
		t.Fatalf("bob's cycle: %v", err)
	}
	if _, err := f.closeCycle(t, ctx, f.alice, bobCycle.ID, &bobState.ID); !errors.Is(err, worksheet.ErrNotFound) {
		t.Fatalf("bob's cycle and state: %v", err)
	}
	// Alice's cycle of another of her states is refused, naming the field.
	_, otherCycle := f.start(t, ctx, f.alice, time.Now().UTC())
	var fe *worksheet.FieldError
	if _, err := f.closeCycle(t, ctx, f.alice, otherCycle.ID, &st.ID); !errors.As(err, &fe) || fe.Field != "cycle_id" {
		t.Fatalf("a cycle of another state: %v", err)
	}
	// Only the kind that closes cycles names one, even its own state's
	// cycle with no close yet…
	freshState, freshCycle := f.start(t, ctx, f.alice, time.Now().UTC())
	if _, err := f.svc.Create(ctx, f.alice, worksheet.NewWorksheet{Kind: worksheettest.State, Title: "x",
		StateID: &freshState.ID, CycleID: &freshCycle.ID}); !errors.As(err, &fe) || fe.Field != "cycle_id" ||
		!strings.Contains(fe.Reason, "does not close a cycle") {
		t.Fatalf("another kind naming a cycle: %v", err)
	}
	// …and the database says so too, should a caller skip the service.
	if _, err := f.sheets.Create(ctx, worksheet.Worksheet{UserID: f.alice, Kind: worksheettest.State, KindVersion: 1,
		Title: "x", Answers: worksheet.Answers{}, StateID: &freshState.ID, CycleID: &freshCycle.ID,
		Status: worksheet.StatusOpen, Reviews: map[string]worksheet.ReviewDate{}}); err == nil {
		t.Fatal("the database stored another kind's cycle")
	}
	// The store resolves the cycle with the owner even without the service.
	if _, err := f.sheets.Create(ctx, worksheet.Worksheet{UserID: f.alice, Kind: worksheet.CycleCloseKind, KindVersion: 1,
		Title: "x", Answers: worksheet.Answers{}, CycleID: &bobCycle.ID, Status: worksheet.StatusOpen,
		Reviews: map[string]worksheet.ReviewDate{}}); !errors.Is(err, worksheet.ErrNotFound) {
		t.Fatalf("the store with bob's cycle: %v", err)
	}

	// Deleting the state deletes its cycles; the close stays, unattached.
	if _, err := f.pool.Exec(ctx, `DELETE FROM learning_states WHERE id = $1`, st.ID); err != nil {
		t.Fatal(err)
	}
	kept, err := f.svc.Get(ctx, f.alice, w.ID)
	if err != nil || kept.CycleID != nil || kept.StateID != nil {
		t.Fatalf("after the state went: %+v %v", kept, err)
	}
}

// A cycle's page reads its own close and the previous cycle's close: the
// cycle that started just before it in the same state, not any earlier one.
func TestACycleReadsItsCloseAndThePreviousCyclesClose(t *testing.T) {
	ctx, f := newWorksheetFixture(t)
	t0 := time.Now().UTC().Add(-200 * 24 * time.Hour)
	st, first := f.start(t, ctx, f.alice, t0)
	second, err := f.store.CreateCycle(ctx, f.alice, st.ID, t0.Add(95*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	third, err := f.store.CreateCycle(ctx, f.alice, st.ID, t0.Add(190*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	firstClose, err := f.closeCycle(t, ctx, f.alice, first.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	results := []any{
		map[string]any{"row": "", "cells": map[string]any{"result": "Reading", "destination": "continue", "next_step": "Longer articles"}},
		map[string]any{"row": "", "cells": map[string]any{"result": "Side project", "destination": "stop"}},
	}
	if _, err := f.svc.Update(ctx, f.alice, firstClose.ID, worksheet.Patch{Revision: firstClose.UpdatedAt,
		Answers: map[string]json.RawMessage{"destinations": section(t, map[string]any{"results": results})}}); err != nil {
		t.Fatal(err)
	}
	// Another state's cycle, started between the first two and closed, is
	// never "previous".
	_, between := f.start(t, ctx, f.alice, t0.Add(50*24*time.Hour))
	if _, err := f.closeCycle(t, ctx, f.alice, between.ID, nil); err != nil {
		t.Fatal(err)
	}

	got, err := f.svc.CycleClose(ctx, f.alice, second.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Close != nil || got.Previous == nil || got.Previous.ID != firstClose.ID {
		t.Fatalf("second cycle: %+v", got)
	}
	if len(got.Previous.Offers) != 1 || got.Previous.Offers[0].NextStep != "Longer articles" {
		t.Fatalf("offers %+v", got.Previous.Offers)
	}
	got, err = f.svc.CycleClose(ctx, f.alice, first.ID)
	if err != nil || got.Close == nil || got.Close.ID != firstClose.ID || got.Previous != nil {
		t.Fatalf("first cycle: %+v %v", got, err)
	}
	// The second cycle has no close, so the third has nothing to start from.
	got, err = f.svc.CycleClose(ctx, f.alice, third.ID)
	if err != nil || got.Close != nil || got.Previous != nil {
		t.Fatalf("third cycle: %+v %v", got, err)
	}
	if _, err := f.svc.CycleClose(ctx, f.bob, second.ID); !errors.Is(err, worksheet.ErrNotFound) {
		t.Fatalf("bob reading alice's cycle: %v", err)
	}
}
