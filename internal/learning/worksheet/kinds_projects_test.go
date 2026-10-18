package worksheet

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/learning"
)

// Phase 8: the artifact brief, the interview evidence card, the two case
// reviews and the scorecard.

func lookupKind(t *testing.T, id string) *Kind {
	t.Helper()
	k, ok := Lookup(id)
	if !ok {
		t.Fatalf("%s is not registered", id)
	}
	return k
}

// writer applies validated section writes to one worksheet the way the store
// does, on the day given, so a test can follow its reviews.
func writer(t *testing.T, k *Kind, created learning.Day) (*Worksheet, func(today learning.Day, raw map[string]any) error) {
	t.Helper()
	s := &Service{}
	w := &Worksheet{Answers: Answers{}, Status: StatusOpen, Reviews: map[string]ReviewDate{}}
	return w, func(today learning.Day, raw map[string]any) error {
		clean, err := Validate(k, sections(t, raw))
		if err != nil {
			return err
		}
		wr := &Write{Sections: map[string]map[string]any{}}
		for key, fields := range clean {
			wr.Sections[key] = merge(w.Answers[key], fields)
		}
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
}

// §2's versions are up's help table, read only (red team AS-7); §3's gates
// keep the check question as text and store only the evidence location and
// the owner/date.
func TestTheArtifactBriefsTablesKeepUpsShape(t *testing.T) {
	k := lookupKind(t, ArtifactBriefKind)
	versions := map[string]any{"versions": map[string]any{"versions": []any{
		map[string]any{"row": "independent", "cells": map[string]any{"condition": "my own rule"}}}}}
	if _, err := Validate(k, sections(t, versions)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a value written into the read-only versions table: %v", err)
	}
	gate := func(cells map[string]any) error {
		_, err := Validate(k, sections(t, map[string]any{ArtifactGatesSection: map[string]any{ArtifactGatesField: []any{
			map[string]any{"row": "accurate", "cells": cells}}}}))
		return err
	}
	if err := gate(map[string]any{"evidence": "tests/report.md", "owner": "me, 2026-10-02"}); err != nil {
		t.Fatalf("a gate with evidence: %v", err)
	}
	if err := gate(map[string]any{"check": "rewritten question"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("the check question written over: %v", err)
	}
	f := k.field(ArtifactGatesSection, ArtifactGatesField)
	var rows []string
	for _, r := range f.Rows {
		rows = append(rows, r.Label)
	}
	if got := strings.Join(rows, ", "); got != "Clear, Accurate, Usable, Maintainable, Accountable" {
		t.Fatalf("gates = %s", got)
	}
	// up's rule (artifact-brief.md:56) is shown under the table: the
	// evidence column's help says an empty one is unverified.
	if c := f.Columns[1]; c.Key != "evidence" || !strings.Contains(c.Hint, "unverified") {
		t.Fatalf("the evidence column does not carry up's unverified rule: %+v", c)
	}
}

// AC4: the parallel test is five days after delivery (up's "3–7 days"),
// counted from the day §5's delivery line is first filled.
func TestTheArtifactBriefsRetestCountsFromDelivery(t *testing.T) {
	k := lookupKind(t, ArtifactBriefKind)
	created := learning.Day{Year: 2026, Month: time.October, Day: 1}
	w, write := writer(t, k, created)
	if err := write(created, map[string]any{"boundary": map[string]any{"name": "Status page"}}); err != nil {
		t.Fatal(err)
	}
	if len(w.Reviews) != 0 {
		t.Fatalf("scheduled before delivery: %+v", w.Reviews)
	}
	delivered := learning.Day{Year: 2026, Month: time.October, Day: 9}
	if err := write(delivered, map[string]any{ArtifactDelivery: map[string]any{ArtifactDeliveredOn: "2026-10-09, v1.0"}}); err != nil {
		t.Fatal(err)
	}
	if r := w.Reviews["parallel_test"]; r.Due != "2026-10-14" || r.Earliest != "2026-10-14" {
		t.Fatalf("parallel test = %+v, want 2026-10-14", r)
	}
	// Rewriting the line later does not move it: the anchor is the first fill.
	later := learning.Day{Year: 2026, Month: time.October, Day: 12}
	if err := write(later, map[string]any{ArtifactDelivery: map[string]any{ArtifactDeliveredOn: "2026-10-12, v1.1"}}); err != nil {
		t.Fatal(err)
	}
	if r := w.Reviews["parallel_test"]; r.Due != "2026-10-14" {
		t.Fatalf("the retest moved with a rewrite: %+v", r)
	}
}

// AC2: the story bank holds twelve stories and refuses a thirteenth, both in
// a section write and through the row append route's validation.
func TestTheStoryBankRefusesAThirteenthStory(t *testing.T) {
	k := lookupKind(t, InterviewEvidenceKind)
	bank := func(n int) error {
		rows := make([]any, n)
		for i := range rows {
			rows[i] = map[string]any{"row": "", "cells": map[string]any{
				"name": fmt.Sprintf("Story %d", i+1), "answers": []string{"failure", "decision"}, "holds": "yes"}}
		}
		_, err := Validate(k, sections(t, map[string]any{"stories": map[string]any{"stories": rows}}))
		return err
	}
	if err := bank(12); err != nil {
		t.Fatalf("twelve stories: %v", err)
	}
	var fe *FieldError
	if err := bank(13); !errors.As(err, &fe) || fe.Field != "stories.stories" {
		t.Fatalf("a thirteenth story: %v", err)
	}
	if f := k.field("stories", "stories"); f.MaxRows != 12 {
		t.Fatalf("the story bank holds %d rows; the append route caps on MaxRows", f.MaxRows)
	}
	// up's option lists: a question type and a support decision outside them
	// are refused.
	if _, err := Validate(k, sections(t, map[string]any{"stories": map[string]any{"stories": []any{
		map[string]any{"row": "", "cells": map[string]any{"answers": []string{"ambition"}}}}}})); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a question type outside up's list: %v", err)
	}
	if _, err := Validate(k, sections(t, map[string]any{"gates": map[string]any{"support": "apply anyway"}})); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a current-support decision outside up's three: %v", err)
	}
	if _, err := Validate(k, sections(t, map[string]any{"comparison": map[string]any{"comparison": []any{
		map[string]any{"row": "day_1", "cells": map[string]any{"completion": 3}}}}})); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a score of 3: %v", err)
	}
}

// AC4: the day-seven and day-fourteen retests follow §3's baseline date, and
// §9's rows for them cannot be written before their dates.
func TestTheInterviewRetestsFollowTheBaselineDate(t *testing.T) {
	k := lookupKind(t, InterviewEvidenceKind)
	created := learning.Day{Year: 2026, Month: time.October, Day: 1}
	w, write := writer(t, k, created)
	day7 := map[string]any{"comparison": map[string]any{"comparison": []any{
		map[string]any{"row": "day_7", "cells": map[string]any{"completion": 2}}}}}
	if err := write(created, day7); !errors.Is(err, ErrTooEarly) {
		t.Fatalf("the day-seven row with no baseline: %v", err)
	}
	if err := write(created, map[string]any{"baseline": map[string]any{"date": "2026-10-03"}}); err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]string{"day_7": "2026-10-10", "day_14": "2026-10-17"} {
		if r := w.Reviews[key]; r.Due != want {
			t.Errorf("%s = %+v, want %s", key, r, want)
		}
	}
	// The day-one row has no gate.
	if err := write(created, map[string]any{"comparison": map[string]any{"comparison": []any{
		map[string]any{"row": "day_1", "cells": map[string]any{"completion": 1}}}}}); err != nil {
		t.Fatalf("the day-one row: %v", err)
	}
	if err := write(learning.Day{Year: 2026, Month: time.October, Day: 9}, day7); !errors.Is(err, ErrTooEarly) {
		t.Fatalf("the day-seven row on day six: %v", err)
	}
	if err := write(learning.Day{Year: 2026, Month: time.October, Day: 10}, day7); err != nil {
		t.Fatalf("the day-seven row on its date: %v", err)
	}
}

// The scorecard's gates are yes/no, as up writes them.
func TestTheScorecardsGatesAreYesOrNo(t *testing.T) {
	k := lookupKind(t, "ai_project_scorecard")
	if _, err := Validate(k, sections(t, map[string]any{"gates": map[string]any{"facts": true, "tests": false}})); err != nil {
		t.Fatalf("yes/no gates: %v", err)
	}
	if _, err := Validate(k, sections(t, map[string]any{"gates": map[string]any{"facts": "yes"}})); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a gate written as text: %v", err)
	}
	if _, err := Validate(k, sections(t, map[string]any{"release": map[string]any{"release": []any{
		map[string]any{"row": "launch", "cells": map[string]any{"pass": true}}}}})); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a release gate up does not list: %v", err)
	}
}

// AC3: the narrative case review is private, because it is about the
// learner's own life and other people. The engine's privacy test seeds every
// private kind with worksheettest.Fill, so the kind must accept that fill.
func TestTheNarrativeCaseReviewIsPrivate(t *testing.T) {
	k := lookupKind(t, NarrativeCaseReviewKind)
	if !k.Private || !IsPrivate(NarrativeCaseReviewKind) {
		t.Fatal("the narrative case review is not private")
	}
	if k.Attach != AttachNone {
		t.Fatalf("attach = %s, want none", k.Attach)
	}
	for _, file := range []string{"narrative-and-evidence.md", "ai-case-review.md"} {
		if !strings.Contains(k.Source, file) {
			t.Errorf("Source %q does not name %s", k.Source, file)
		}
	}
	// Every text field and table cell carries the marker, as the privacy
	// test fills it.
	filled := map[string]json.RawMessage{}
	for _, s := range k.Sections {
		fields := map[string]any{}
		for _, f := range s.Fields {
			if f.Type == Text || f.Type == Long {
				fields[f.Key] = "MARKER " + f.Key
			}
		}
		filled[s.Key], _ = json.Marshal(fields)
	}
	if _, err := Validate(k, filled); err != nil {
		t.Fatalf("a filled narrative review: %v", err)
	}
	// The case review sections are the AI case review's, and the AI case
	// review itself is not private.
	if IsPrivate("ai_case_review") || len(k.Sections) != len(caseReviewSections())+3 {
		t.Fatalf("sections = %d", len(k.Sections))
	}
}
