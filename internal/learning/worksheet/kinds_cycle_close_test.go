package worksheet

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

func cycleCloseKind(t *testing.T) *Kind {
	t.Helper()
	k, ok := Lookup(CycleCloseKind)
	if !ok {
		t.Fatal("cycle_close is not registered")
	}
	return k
}

// The day-ninety review comes from a second up file, which the outline
// harness cannot read (testdata/deviations.txt), so its shape is pinned
// here: up's seven one-line fields, first. The rest of the kind's frame is
// phase 10 requirement 1.
func TestCycleCloseFollowsUp(t *testing.T) {
	k := cycleCloseKind(t)
	if k.Group != GroupProjects || k.Attach != AttachState || k.Private || !k.ClosesCycle {
		t.Fatalf("group %s, attach %s, private %v, closes a cycle %v", k.Group, k.Attach, k.Private, k.ClosesCycle)
	}
	var keys []string
	for _, s := range k.Sections {
		keys = append(keys, s.Key)
	}
	if got := strings.Join(keys, " "); got != "review books destinations three_lines quarterly handover" {
		t.Fatalf("sections %s", got)
	}
	review := k.Sections[0]
	if len(review.Fields) != 7 || !review.Added {
		t.Fatalf("the day-ninety review has %d fields (added %v), want up's seven", len(review.Fields), review.Added)
	}
	for _, f := range review.Fields {
		if f.Type != Text {
			t.Errorf("review.%s is %s; up's review is seven lines", f.Key, f.Type)
		}
	}

	rows := func(section, field string) string {
		var out []string
		for _, r := range k.field(section, field).Rows {
			out = append(out, r.Key)
		}
		return strings.Join(out, " ")
	}
	if got := rows("books", "ledger"); got != "ability artifact cost unknowns" {
		t.Errorf("the books' rows: %s", got)
	}
	if got := rows("quarterly", "abilities"); got != "honesty responsibility judgment return" {
		t.Errorf("the quarterly rows: %s", got)
	}
	if got := rows("handover", "stages"); got != "days_1_7 days_8_14 days_15_21 days_22_30" {
		t.Errorf("the handover's rows: %s", got)
	}
	questions := 0
	for _, f := range k.Sections[1].Fields {
		if f.Type == Long {
			questions++
		}
	}
	if questions != 6 {
		t.Errorf("%d questions under the books, want up's six", questions)
	}
	results := k.field("destinations", "results")
	if results.MaxRows != 20 || len(results.Rows) != 0 {
		t.Errorf("destinations: %d fixed rows, at most %d free", len(results.Rows), results.MaxRows)
	}
	if got := strings.Join(results.Columns[1].Options, " "); got != "continue transfer repair stop" {
		t.Errorf("destinations: %s", got)
	}
	if c := results.Columns[3]; c.Key != "condition" || c.Type != Text {
		t.Errorf("the changed condition is one line: %+v", c)
	}
	if len(k.Reviews) != 1 || k.Reviews[0].Key != "handover_end" || k.Reviews[0].Days != 30 || !k.Reviews[0].From.IsCreation() {
		t.Errorf("reviews %+v", k.Reviews)
	}
}

func closeDestinations(rows ...map[string]any) map[string]map[string]any {
	table := make([]any, len(rows))
	for i, r := range rows {
		table[i] = map[string]any{"row": "", "cells": r}
	}
	return map[string]map[string]any{"destinations": {"results": table}}
}

func finishClose(t *testing.T, status string, rows ...map[string]any) error {
	t.Helper()
	k := cycleCloseKind(t)
	day := learning.Day{Year: 2026, Month: time.October, Day: 1}
	w := &Worksheet{Answers: Answers{}, Status: StatusOpen, Reviews: map[string]ReviewDate{}}
	write := &Write{Sections: closeDestinations(rows...)}
	if status != "" {
		write.Status = &status
	}
	return (&Service{}).finish(k, w, write, day, day, nil)
}

// up §4: a transfer changes one condition, so a transfer row names it, on
// every write and whatever the status.
func TestATransferNamesItsOneCondition(t *testing.T) {
	transfer := map[string]any{"result": "Explain a tool", "destination": "transfer", "next_step": "To a new team"}
	for _, status := range []string{"", StatusDone} {
		var fe *FieldError
		err := finishClose(t, status, map[string]any{"result": "Keep", "destination": "continue"}, transfer)
		if !errors.As(err, &fe) || fe.Field != "destinations.results[1].condition" {
			t.Fatalf("status %q, a transfer with no condition: %v", status, err)
		}
	}
	transfer["condition"] = "the audience"
	if err := finishClose(t, StatusDone, transfer); err != nil {
		t.Fatalf("a transfer naming its condition: %v", err)
	}
}

// up §3: a stop is finished by three actions. While the close is open the
// row may wait for them; it cannot be marked done without them, and the
// refusal says what is missing.
func TestAStopNeedsItsThreeActionsBeforeTheCloseIsDone(t *testing.T) {
	stop := map[string]any{"result": "Side project", "destination": "stop", "basis": "No users after 90 days"}
	if err := finishClose(t, "", stop); err != nil {
		t.Fatalf("an open close may hold an unfinished stop: %v", err)
	}
	var fe *FieldError
	err := finishClose(t, StatusDone, stop)
	if !errors.As(err, &fe) || fe.Field != "destinations.results[0]" ||
		!strings.Contains(fe.Reason, "where the material is archived, who was told") ||
		strings.Contains(fe.Reason, "the grounds") {
		t.Fatalf("done with two actions missing: %v", err)
	}
	if got := MissingStopActions(stop); len(got) != 2 {
		t.Fatalf("missing %v", got)
	}
	stop["archived"], stop["told"] = "Drive/archive", "  "
	if err := finishClose(t, StatusDone, stop); !errors.As(err, &fe) || !strings.HasSuffix(fe.Reason, "who was told") {
		t.Fatalf("a blank \"who was told\": %v", err)
	}
	stop["told"] = "The two testers"
	if err := finishClose(t, StatusDone, stop); err != nil {
		t.Fatalf("a finished stop: %v", err)
	}
	if MissingStopActions(map[string]any{"destination": "repair"}) != nil {
		t.Fatal("only a stop has stop actions")
	}
}

// closesStore answers CycleCloses only.
type closesStore struct {
	Store
	previous *Worksheet
}

func (s closesStore) CycleCloses(context.Context, uuid.UUID, uuid.UUID) (*Summary, *Worksheet, error) {
	return nil, s.previous, nil
}

// The next cycle starts from the continue and transfer rows that name a next
// step; repair rows are "reduce first"; stop rows are never offered.
func TestTheNextCycleIsOfferedContinueAndTransferRowsOnly(t *testing.T) {
	prev := &Worksheet{ID: uuid.New(), Title: "Close", Answers: Answers{
		"destinations": closeDestinations(
			map[string]any{"result": "Stopped", "destination": "stop", "next_step": "Hand over"},
			map[string]any{"result": "Reading", "destination": "continue", "next_step": "Longer articles"},
			map[string]any{"result": "Health", "destination": "repair", "next_step": "Sleep by eleven"},
			map[string]any{"result": "Talks", "destination": "transfer", "next_step": "Present to a new team", "condition": "audience"},
			map[string]any{"result": "Undecided", "destination": "continue"},
			map[string]any{"result": "No destination"},
		)["destinations"],
	}}
	got, err := NewService(closesStore{previous: prev}, nil, nil).CycleClose(context.Background(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	p := got.Previous
	if p == nil || len(p.Offers) != 2 || len(p.ReduceFirst) != 1 {
		t.Fatalf("previous %+v", p)
	}
	if p.Offers[0].Row != 1 || p.Offers[0].NextStep != "Longer articles" ||
		p.Offers[1].Row != 3 || p.Offers[1].Condition != "audience" {
		t.Errorf("offers %+v", p.Offers)
	}
	if p.ReduceFirst[0].Row != 2 || p.ReduceFirst[0].NextStep != "Sleep by eleven" {
		t.Errorf("reduce first %+v", p.ReduceFirst)
	}

	none, err := NewService(closesStore{}, nil, nil).CycleClose(context.Background(), uuid.New(), uuid.New())
	if err != nil || none.Previous != nil || none.Close != nil {
		t.Fatalf("no closes: %+v %v", none, err)
	}
}

// Only a kind attached to a learning state may close a cycle: the cycle's
// state becomes the worksheet's.
func TestOnlyAStateKindClosesACycle(t *testing.T) {
	k := Kind{Kind: "close_probe", Name: "C", Group: GroupProjects, Source: "s", Version: 1, ClosesCycle: true,
		Sections: []Section{{Key: "s", Title: "S", Fields: []Field{{Key: "f", Label: "F", Type: Text}}}}}
	if err := checkKind(&k); err == nil {
		t.Fatal("a kind with no state closes a cycle")
	}
}
