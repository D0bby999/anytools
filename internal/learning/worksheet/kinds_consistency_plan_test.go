package worksheet

import (
	"errors"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/learning"
)

// The consistency plan (phase 2 of 261017-1828-up-f13ff2d-upgrade): up's
// three versions as a fixed table, the cycle review on the cycle's last day,
// and the cells a learning state prefills (ui/web/app/lib/consistency-plan.ts
// names the same keys).

func TestTheConsistencyPlansThreeVersionsKeepUpsShape(t *testing.T) {
	k := lookupKind(t, ConsistencyPlanKind)
	if k.Group != GroupProjects || k.Private || k.Attach != AttachState {
		t.Fatalf("group %s, private %v, attach %s; want a project kind on an optional goal", k.Group, k.Private, k.Attach)
	}
	f := k.field(ConsistencyVersions, ConsistencyVersionsTable)
	if f == nil || len(f.Rows) != 3 || f.Rows[0].Key != ConsistencyMinimum || f.Rows[1].Key != ConsistencyStandard ||
		f.Rows[2].Key != "extended" {
		t.Fatalf("the three versions table: %+v", f)
	}
	var action *Field
	for i := range f.Columns {
		if f.Columns[i].Key == ConsistencyVersionsAction {
			action = &f.Columns[i]
		}
	}
	// A state's next task may be up to 1000 bytes: the cell it lands in is
	// long, so a prefill is never cut.
	if action == nil || action.Type != Long {
		t.Fatalf("the action column: %+v", action)
	}
	prefill := map[string]any{ConsistencyVersions: map[string]any{ConsistencyVersionsTable: []any{
		map[string]any{"row": ConsistencyMinimum, "cells": map[string]any{ConsistencyVersionsAction: "Write three sentences"}},
		map[string]any{"row": ConsistencyStandard, "cells": map[string]any{ConsistencyVersionsAction: "Revise the outline and record it"}},
	}}}
	if _, err := Validate(k, sections(t, prefill)); err != nil {
		t.Fatalf("the prefill a learning state gives: %v", err)
	}
	if _, err := Validate(k, sections(t, map[string]any{ConsistencyVersions: map[string]any{ConsistencyVersionsTable: []any{
		map[string]any{"row": "heroic", "cells": map[string]any{ConsistencyVersionsAction: "Everything"}}}}})); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a fourth version: %v", err)
	}
}

func TestTheCycleReviewFallsOnTheCyclesLastDay(t *testing.T) {
	k := lookupKind(t, ConsistencyPlanKind)
	created := learning.Day{Year: 2026, Month: time.September, Day: 21}
	w, write := writer(t, k, created)
	if err := write(created, map[string]any{"cycle": map[string]any{"from": "2026-09-21"}}); err != nil {
		t.Fatal(err)
	}
	if len(w.Reviews) != 0 {
		t.Fatalf("a review before the cycle has an end: %+v", w.Reviews)
	}
	if err := write(created, map[string]any{"cycle": map[string]any{"to": "2026-10-18"}}); err != nil {
		t.Fatal(err)
	}
	if r := w.Reviews["cycle_review"]; r.Due != "2026-10-18" {
		t.Fatalf("cycle review = %+v, want 2026-10-18", r)
	}
	// Moving the end moves the review.
	if err := write(created, map[string]any{"cycle": map[string]any{"to": "2026-10-25"}}); err != nil {
		t.Fatal(err)
	}
	if r := w.Reviews["cycle_review"]; r.Due != "2026-10-25" {
		t.Fatalf("cycle review after moving the end = %+v", r)
	}
	// The log is a free table of sessions with a date each.
	if _, err := Validate(k, sections(t, map[string]any{"log": map[string]any{"entries": []any{
		map[string]any{"row": "", "cells": map[string]any{"date": "22 September"}}}}})); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a log date that is not a date: %v", err)
	}
}
