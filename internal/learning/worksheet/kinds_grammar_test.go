package worksheet

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

func mustKind(t *testing.T, id string) *Kind {
	t.Helper()
	k, ok := Lookup(id)
	if !ok {
		t.Fatalf("%s is not registered", id)
	}
	return k
}

func validateSection(k *Kind, section string, fields map[string]any) error {
	raw, _ := json.Marshal(fields)
	_, err := Validate(k, map[string]json.RawMessage{section: raw})
	return err
}

// Requirement 3: the six decisions and five impacts are one list each, and
// every place that classifies by them uses it.
func TestBothGrammarKindsShareTheChaptersLists(t *testing.T) {
	if len(GrammarDecisions) != 6 || len(GrammarImpacts) != 5 {
		t.Fatalf("decisions %d, impacts %d; the chapter has six and five", len(GrammarDecisions), len(GrammarImpacts))
	}
	same := func(where string, got []string, want []string) {
		t.Helper()
		if strings.Join(got, "|") != strings.Join(want, "|") {
			t.Errorf("%s: options %q, want the shared %q", where, got, want)
		}
	}
	ev, m := mustKind(t, GrammarEvidenceKind), mustKind(t, GrammarErrorMapKind)
	same("grammar_evidence §2 impact", ev.field("problem", "impact").Options, GrammarImpacts)
	for _, c := range ev.field("problem", "samples").Columns {
		if c.Key == "choice" {
			same("grammar_evidence §2 structural choice", c.Options, GrammarDecisions)
		}
	}
	for _, c := range m.field(GrammarMapSection, GrammarMapErrors).Columns {
		switch c.Key {
		case "decision":
			same("error map decision", c.Options, GrammarDecisions)
		case "impact":
			same("error map impact", c.Options, GrammarImpacts)
		}
	}
	if len(m.field("decisions", "decisions").Rows) != 6 || len(m.field(GrammarMapSection, "impacts").Rows) != 5 {
		t.Error("the reference tables lost a row of the chapter's lists")
	}
}

// AC2: an impact outside the five is refused, on both kinds.
func TestAnImpactOutsideTheFiveIsRefused(t *testing.T) {
	ev, m := mustKind(t, GrammarEvidenceKind), mustKind(t, GrammarErrorMapKind)
	if err := validateSection(ev, "problem", map[string]any{"impact": "meaning-changing"}); err != nil {
		t.Fatalf("one of the five: %v", err)
	}
	var fe *FieldError
	if err := validateSection(ev, "problem", map[string]any{"impact": "spelling"}); !errors.As(err, &fe) || fe.Field != "problem.impact" {
		t.Fatalf("grammar_evidence with impact %q: %v", "spelling", err)
	}
	row := func(cells map[string]any) map[string]any {
		return map[string]any{GrammarMapErrors: []TableRow{{Cells: cells}}}
	}
	if err := validateSection(m, GrammarMapSection, row(map[string]any{
		"sample": "I work here since 2024", "decision": "time and state", "impact": "recurring"})); err != nil {
		t.Fatalf("a well-formed error row: %v", err)
	}
	if err := validateSection(m, GrammarMapSection, row(map[string]any{"impact": "minor"})); !errors.Is(err, ErrInvalid) {
		t.Fatalf("an error row with impact %q: %v", "minor", err)
	}
	if err := validateSection(m, GrammarMapSection, row(map[string]any{"decision": "word order"})); !errors.Is(err, ErrInvalid) {
		t.Fatalf("an error row with decision %q: %v", "word order", err)
	}
	// Priority is derived from the impact, never written.
	if err := validateSection(m, GrammarMapSection, row(map[string]any{"impact": "recurring", "priority": "Highest"})); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a written priority: %v", err)
	}
	// The reference tables hold nothing of the learner's.
	if err := validateSection(m, "decisions", map[string]any{"decisions": []TableRow{
		{Row: "time", Cells: map[string]any{"question": "mine"}}}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a write into the decisions reference table: %v", err)
	}
}

// AC2: the error map holds at most 40 rows.
func TestTheErrorMapHoldsFortyRows(t *testing.T) {
	m := mustKind(t, GrammarErrorMapKind)
	rows := make([]TableRow, 40)
	for i := range rows {
		rows[i] = TableRow{Cells: map[string]any{"sample": "s"}}
	}
	if err := validateSection(m, GrammarMapSection, map[string]any{GrammarMapErrors: rows}); err != nil {
		t.Fatalf("40 rows: %v", err)
	}
	rows = append(rows, TableRow{Cells: map[string]any{"sample": "s"}})
	if err := validateSection(m, GrammarMapSection, map[string]any{GrammarMapErrors: rows}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("41 rows: %v", err)
	}
}

// The priority column shows the chapter's priority for the row's impact,
// in the export as on the page.
func TestTheErrorMapsPriorityFollowsTheImpact(t *testing.T) {
	m := mustKind(t, GrammarErrorMapKind)
	var priority Field
	for _, c := range m.field(GrammarMapSection, GrammarMapErrors).Columns {
		if c.Key == "priority" {
			priority = c
		}
	}
	want := map[string]string{
		"meaning-changing": "Highest", "task-blocking": "Highest", "recurring": "High",
		"register mismatch": "Medium", "low-impact": "Later", "": "",
	}
	for impact, p := range want {
		if got := priority.LabelText("", map[string]any{"impact": impact}); got != p {
			t.Errorf("impact %q: priority %q, want %q", impact, got, p)
		}
	}
	w := &Worksheet{Kind: GrammarErrorMapKind, Title: "Map", Answers: Answers{GrammarMapSection: {GrammarMapErrors: []any{
		map[string]any{"row": "", "cells": map[string]any{"sample": "I work here since 2024", "impact": "register mismatch"}},
	}}}}
	out := Markdown(m, w)
	if !strings.Contains(out, "| I work here since 2024 |  | register mismatch | Medium |") {
		t.Fatalf("the export does not show the derived priority:\n%s", out)
	}
}

// A label column that follows another column is checked when it registers.
func TestRegisterRefusesABrokenDerivedLabel(t *testing.T) {
	table := func(cols ...Field) Kind {
		return Kind{Kind: "derived_probe", Name: "D", Group: GroupLanguage, Source: "s", Version: 1,
			Sections: []Section{{Key: "s", Title: "S", Fields: []Field{
				{Key: "t", Label: "T", Type: Table, MaxRows: 5, Columns: cols}}}}}
	}
	impact := Field{Key: "impact", Label: "Impact", Type: Choice, Options: []string{"a", "b"}}
	good := Field{Key: "p", Label: "P", Type: Label, TextFrom: "impact", Text: map[string]string{"a": "1", "b": "2"}}
	k := table(impact, good)
	if err := checkKind(&k); err != nil {
		t.Fatalf("a well-formed derived label: %v", err)
	}
	for name, col := range map[string]Field{
		"a missing option":  {Key: "p", Label: "P", Type: Label, TextFrom: "impact", Text: map[string]string{"a": "1"}},
		"an unknown option": {Key: "p", Label: "P", Type: Label, TextFrom: "impact", Text: map[string]string{"a": "1", "c": "2"}},
		"an extra text":     {Key: "p", Label: "P", Type: Label, TextFrom: "impact", Text: map[string]string{"a": "1", "b": "2", "c": "3"}},
		"no such column":    {Key: "p", Label: "P", Type: Label, TextFrom: "nope", Text: map[string]string{"a": "1", "b": "2"}},
		"not a label":       {Key: "p", Label: "P", Type: Text, TextFrom: "impact"},
	} {
		k := table(impact, col)
		if err := checkKind(&k); err == nil {
			t.Errorf("%s: registered", name)
		}
	}
	notChoice := Field{Key: "impact", Label: "Impact", Type: Text}
	k = table(notChoice, good)
	if err := checkKind(&k); err == nil {
		t.Error("a label derived from a text column: registered")
	}
}

// AC4: grammar_evidence's retests count from the day §2's first sample is
// written, and §7's later rows cannot be written before their dates.
func TestGrammarRetestsCountFromTheFirstSample(t *testing.T) {
	k := mustKind(t, GrammarEvidenceKind)
	s := &Service{}
	created := learning.Day{Year: 2026, Month: time.October, Day: 1}
	w := &Worksheet{Answers: Answers{}, Status: StatusOpen, Reviews: map[string]ReviewDate{}}
	write := func(today learning.Day, sections map[string]map[string]any) error {
		wr := &Write{Sections: sections}
		if err := s.finish(k, w, wr, created, today, nil); err != nil {
			return err
		}
		for key, fields := range wr.Sections {
			w.Answers[key] = fields
		}
		if wr.Reviews != nil {
			w.Reviews = wr.Reviews
		}
		return nil
	}
	if err := write(created, map[string]map[string]any{"task": {"audience": "my team lead"}}); err != nil {
		t.Fatal(err)
	}
	if len(w.Reviews) != 0 {
		t.Fatalf("scheduled before any sample: %v", w.Reviews)
	}
	sampled := learning.Day{Year: 2026, Month: time.October, Day: 4}
	if err := write(sampled, map[string]map[string]any{"problem": {"original": "I work here since 2024."}}); err != nil {
		t.Fatal(err)
	}
	for key, due := range map[string]string{"days_3_7": "2026-10-09", "day_14": "2026-10-18"} {
		if w.Reviews[key].Due != due {
			t.Errorf("%s due %q, want %q", key, w.Reviews[key].Due, due)
		}
	}
	early := learning.Day{Year: 2026, Month: time.October, Day: 6}
	err := write(early, map[string]map[string]any{"retest": {"timeline": []TableRow{
		{Row: "days_3_7", Cells: map[string]any{"result": "chose the perfect"}}}}})
	if !errors.Is(err, ErrTooEarly) {
		t.Fatalf("the days 3–7 row two days after the sample: %v", err)
	}
	err = write(learning.Day{Year: 2026, Month: time.October, Day: 17}, map[string]map[string]any{"retest": {"timeline": []TableRow{
		{Row: "day_14", Cells: map[string]any{"result": "held"}}}}})
	if !errors.Is(err, ErrTooEarly) {
		t.Fatalf("the day 14 row a day early: %v", err)
	}
	if err := write(early, map[string]map[string]any{"retest": {"timeline": []TableRow{
		{Row: "day_1", Cells: map[string]any{"result": "first try"}}}}}); err != nil {
		t.Fatalf("the day 1 row: %v", err)
	}
	if err := write(learning.Day{Year: 2026, Month: time.October, Day: 9}, map[string]map[string]any{"retest": {"timeline": []TableRow{
		{Row: "day_1", Cells: map[string]any{"result": "first try"}},
		{Row: "days_3_7", Cells: map[string]any{"result": "chose the perfect"}}}}}); err != nil {
		t.Fatalf("the days 3–7 row on its date: %v", err)
	}
}

// attachStore answers the attachment lookups Create makes; nothing else.
type attachStore struct {
	Store
	created *Worksheet
}

func (s *attachStore) StateExists(context.Context, uuid.UUID, uuid.UUID) (bool, error) {
	return true, nil
}

func (s *attachStore) DocumentSource(context.Context, uuid.UUID, uuid.UUID) (string, error) {
	return "upload", nil
}

func (s *attachStore) Create(_ context.Context, w Worksheet) (*Worksheet, error) {
	s.created = &w
	return &w, nil
}

type utcZones struct{}

func (utcZones) Timezone(context.Context, uuid.UUID) (string, error) { return "UTC", nil }

// The error map is kept for a goal or for a document, either one optional;
// the grammar card only for a goal.
func TestTheErrorMapAttachesToAStateOrADocument(t *testing.T) {
	store := &attachStore{}
	s := NewService(store, utcZones{}, nil)
	ctx, user, id := context.Background(), uuid.New(), uuid.New()
	for name, in := range map[string]NewWorksheet{
		"unattached": {Kind: GrammarErrorMapKind, Title: "Map"},
		"a state":    {Kind: GrammarErrorMapKind, Title: "Map", StateID: &id},
		"a document": {Kind: GrammarErrorMapKind, Title: "Map", DocumentID: &id},
		"a card":     {Kind: GrammarEvidenceKind, Title: "Card", StateID: &id},
	} {
		if _, err := s.Create(ctx, user, in); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
	var fe *FieldError
	_, err := s.Create(ctx, user, NewWorksheet{Kind: GrammarEvidenceKind, Title: "Card", DocumentID: &id})
	if !errors.As(err, &fe) || fe.Field != "document_id" {
		t.Fatalf("a grammar card on a document: %v", err)
	}
	_, err = s.Create(ctx, user, NewWorksheet{Kind: GrammarErrorMapKind, Title: "Map", StateID: &id, DocumentID: &id})
	if !errors.As(err, &fe) || fe.Field != "document_id" {
		t.Fatalf("an error map on a state and a document at once: %v", err)
	}
}
