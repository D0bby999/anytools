package worksheet

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/learning"
)

func diagnostic(t *testing.T) *Kind {
	t.Helper()
	k, ok := Lookup("english_diagnostic")
	if !ok {
		t.Fatal("english_diagnostic is not registered")
	}
	return k
}

// AC2 for the diagnostic: §5's barrier options are per skill, and §4's
// scores are 0–2.
func TestTheDiagnosticRefusesAnswersThatDoNotFitIt(t *testing.T) {
	k := diagnostic(t)
	barrier := func(row, value string) error {
		_, err := Validate(k, sections(t, map[string]any{"barriers": map[string]any{"barriers": []any{
			map[string]any{"row": row, "cells": map[string]any{"barrier": value, "sample": "02:14"}}}}}))
		return err
	}
	if err := barrier("listening", "sound"); err != nil {
		t.Fatalf("a listening barrier from the listening list: %v", err)
	}
	if err := barrier("writing", "sentence"); err != nil {
		t.Fatalf("a writing barrier from the writing list: %v", err)
	}
	var fe *FieldError
	if err := barrier("listening", "sentence"); !errors.As(err, &fe) || fe.Field != "barriers.barriers[0].barrier" {
		t.Fatalf("a listening barrier from the writing list: %v", err)
	}

	score := func(v int) error {
		_, err := Validate(k, sections(t, map[string]any{"scores": map[string]any{"scores": []any{
			map[string]any{"row": "speaking", "cells": map[string]any{"task": 2, "accuracy": v, "reason": "rec 1, 00:40"}}}}}))
		return err
	}
	if err := score(0); err != nil {
		t.Fatalf("a score of 0: %v", err)
	}
	if err := score(3); !errors.As(err, &fe) || fe.Field != "scores.scores[0].accuracy" {
		t.Fatalf("a score of 3: %v", err)
	}

	// §2 is help only: its columns are labels and store nothing.
	if _, err := Validate(k, sections(t, map[string]any{"tasks": map[string]any{"tasks": []any{
		map[string]any{"row": "reading", "cells": map[string]any{"suggested": "my own"}}}}})); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a value in a help-only column: %v", err)
	}
	// The CEFR self-check: one of A1–C2 or "not sure" per skill, never a mean.
	if _, err := Validate(k, sections(t, map[string]any{"cefr": map[string]any{"levels": []any{
		map[string]any{"row": "reading", "cells": map[string]any{"level": "B2"}},
		map[string]any{"row": "speaking", "cells": map[string]any{"level": "not sure"}}}}})); err != nil {
		t.Fatalf("per-skill levels: %v", err)
	}
	if _, err := Validate(k, sections(t, map[string]any{"cefr": map[string]any{"levels": []any{
		map[string]any{"row": "reading", "cells": map[string]any{"level": "B1.5"}}}}})); !errors.As(err, &fe) {
		t.Fatalf("a level off the scale: %v", err)
	}
	// "What it did" is a multi of up's options, with up's "other".
	if _, err := Validate(k, sections(t, map[string]any{"feedback": map[string]any{
		"did": []string{"diagnosis", "transcript", "read my draft aloud"}}})); err != nil {
		t.Fatalf("what the tool did: %v", err)
	}
}

// AC4 for the diagnostic: day 7, day 30 and week 12 count from §3's
// first-version date; before it they are not scheduled, and §7's dated rows
// cannot be written before their day (up's delay rule).
func TestTheDiagnosticsReviewsCountFromTheFirstVersion(t *testing.T) {
	k := diagnostic(t)
	s := &Service{}
	created := learning.Day{Year: 2026, Month: time.October, Day: 1}
	w := &Worksheet{Answers: Answers{}, Status: StatusOpen, Reviews: map[string]ReviewDate{}}

	write := func(today learning.Day, raw map[string]any) error {
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

	// Section 1 filled on day 0: nothing is scheduled yet.
	if err := write(created, map[string]any{"boundary": map[string]any{"context": "work", "topic": "Weekly status"}}); err != nil {
		t.Fatal(err)
	}
	if len(w.Reviews) != 0 {
		t.Fatalf("reviews scheduled before the first version: %+v", w.Reviews)
	}
	// A dated row before anything is scheduled is too early too.
	day7Row := map[string]any{"retest": map[string]any{"timeline": []any{
		map[string]any{"row": "day7", "cells": map[string]any{"result": "parallel topic, no captions"}}}}}
	if err := write(created, day7Row); !errors.Is(err, ErrTooEarly) {
		t.Fatalf("a Day 7 row with no first version: %v", err)
	}

	// The first version is recorded on 2026-10-02.
	day2 := learning.Day{Year: 2026, Month: time.October, Day: 2}
	if err := write(day2, map[string]any{"first_version": map[string]any{"first_version_on": "2026-10-02"}}); err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]string{"day7": "2026-10-09", "day30": "2026-11-01", "week12": "2026-12-25"} {
		if r := w.Reviews[key]; r.Due != want || r.Earliest != want {
			t.Errorf("%s = %+v, want %s", key, r, want)
		}
	}

	// Day 3 after the first version: the Day 7 row is refused; Day 1 is not dated.
	day3 := learning.Day{Year: 2026, Month: time.October, Day: 5}
	if err := write(day3, day7Row); !errors.Is(err, ErrTooEarly) {
		t.Fatalf("a Day 7 row on day 3: %v, want ErrTooEarly", err)
	}
	if err := write(day3, map[string]any{"retest": map[string]any{"timeline": []any{
		map[string]any{"row": "day1", "cells": map[string]any{"result": "repaired version"}}}}}); err != nil {
		t.Fatalf("the Day 1 row: %v", err)
	}
	// On its day the Day 7 row is written and its review is done; Day 30 still waits.
	day7 := learning.Day{Year: 2026, Month: time.October, Day: 9}
	withDay1 := map[string]any{"retest": map[string]any{"timeline": []any{
		map[string]any{"row": "day1", "cells": map[string]any{"result": "repaired version"}},
		map[string]any{"row": "day7", "cells": map[string]any{"result": "parallel topic, no captions"}}}}}
	if err := write(day7, withDay1); err != nil {
		t.Fatalf("the Day 7 row on day 7: %v", err)
	}
	if !w.Reviews["day7"].Done || w.Reviews["day30"].Done {
		t.Fatalf("after the Day 7 row: %+v", w.Reviews)
	}
	day30Row := map[string]any{"retest": map[string]any{"timeline": []any{
		map[string]any{"row": "day1", "cells": map[string]any{"result": "repaired version"}},
		map[string]any{"row": "day7", "cells": map[string]any{"result": "parallel topic, no captions"}},
		map[string]any{"row": "day30", "cells": map[string]any{"result": "too soon"}}}}}
	if err := write(day7, day30Row); !errors.Is(err, ErrTooEarly) {
		t.Fatalf("a Day 30 row on day 7: %v", err)
	}
}

// The help texts the page shows come from the kind: §4's anchors and scoring
// meanings, and the CEFR global scale, A1 to C2.
func TestTheDiagnosticCarriesItsHelp(t *testing.T) {
	k := diagnostic(t)
	for _, c := range k.field("scores", "scores").Columns {
		if c.Type == Score && c.Hint == "" {
			t.Errorf("score column %s has no meaning", c.Key)
		}
	}
	for _, anchor := range []string{"0: no evidence", "1: partly", "2: on your own"} {
		if !strings.Contains(k.section("scores").Hint, anchor) {
			t.Errorf("§4's help lacks up's anchor %q", anchor)
		}
	}
	level := k.field("cefr", "levels").Columns[0]
	for _, l := range []string{"A1:", "A2:", "B1:", "B2:", "C1:", "C2:"} {
		if !strings.HasPrefix(level.Hint, l) && !strings.Contains(level.Hint, "\n"+l) {
			t.Errorf("the CEFR column's help lacks %s", l)
		}
	}
	if k.Private || k.Group != GroupLanguage || k.Attach != AttachState {
		t.Errorf("kind flags: private %v, group %s, attach %s", k.Private, k.Group, k.Attach)
	}
}

// Version 2 (plans/261017-1828-up-f13ff2d-upgrade, phase 0): up's §2A sits
// right after §2. Its three rows' sample text is read-only, like §2's; the
// evidence column is the learner's and validates like every written cell.
func TestTheCollaborationDimensionsFollowUp2A(t *testing.T) {
	k := diagnostic(t)
	if k.Version != 2 {
		t.Fatalf("version %d, want 2: §2A changed the kind's structure", k.Version)
	}
	if k.Sections[1].Key != "tasks" || k.Sections[2].Key != "collaboration" || k.Sections[3].Key != "first_version" {
		t.Fatalf("§2A is not between §2 and §3: %s, %s, %s", k.Sections[1].Key, k.Sections[2].Key, k.Sections[3].Key)
	}
	table := k.field("collaboration", "dimensions")
	var rows []string
	for _, r := range table.Rows {
		rows = append(rows, r.Key)
		if table.Columns[0].Text[r.Key] == "" {
			t.Errorf("row %s has no sample text", r.Key)
		}
	}
	if strings.Join(rows, " ") != "mediation online repair" || table.Columns[0].Type != Label || table.Columns[1].Type != Long {
		t.Fatalf("rows %v, columns %s/%s", rows, table.Columns[0].Type, table.Columns[1].Type)
	}
	if k.section("collaboration").Hint == "" || table.Hint == "" {
		t.Error("§2A says neither when it applies nor what a score cannot replace")
	}

	write := func(cells map[string]any, row string) error {
		_, err := Validate(k, sections(t, map[string]any{"collaboration": map[string]any{"dimensions": []any{
			map[string]any{"row": row, "cells": cells}}}}))
		return err
	}
	if err := write(map[string]any{"evidence": "Slack thread 14 Oct; picked up without a call"}, "online"); err != nil {
		t.Fatalf("an evidence cell: %v", err)
	}
	var fe *FieldError
	if err := write(map[string]any{"sample": "my own sample"}, "online"); !errors.As(err, &fe) || fe.Field != "collaboration.dimensions[0].sample" {
		t.Fatalf("a value in the read-only sample column: %v", err)
	}
	if err := write(map[string]any{"evidence": strings.Repeat("x", MaxLong+1)}, "repair"); !errors.As(err, &fe) || fe.Field != "collaboration.dimensions[0].evidence" {
		t.Fatalf("an over-long evidence cell: %v", err)
	}
	if err := write(map[string]any{"evidence": 3}, "repair"); !errors.As(err, &fe) || fe.Field != "collaboration.dimensions[0].evidence" {
		t.Fatalf("a number in the evidence cell: %v", err)
	}
	if err := write(map[string]any{"evidence": "x"}, "presenting"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a row up does not have: %v", err)
	}
}
