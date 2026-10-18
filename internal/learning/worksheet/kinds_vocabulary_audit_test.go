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

// The vocabulary card's retests (§10) count from the first-encounter date the
// learner writes in §1, at +1, +5, +14 and +30; until it is written they are
// not scheduled.
func TestVocabularyAuditRetestsCountFromTheFirstEncounter(t *testing.T) {
	k, ok := Lookup("vocabulary_audit")
	if !ok {
		t.Fatal("vocabulary_audit is not registered")
	}
	if k.Private || k.Group != GroupLanguage || k.Attach != AttachState {
		t.Fatalf("private %v, group %q, attach %q", k.Private, k.Group, k.Attach)
	}
	created := learning.Day{Year: 2026, Month: time.October, Day: 1}
	reviews := map[string]ReviewDate{}
	schedule(k, Answers{}, reviews, created, created)
	if len(reviews) != 0 {
		t.Fatalf("scheduled with no first-encounter date: %v", reviews)
	}
	schedule(k, Answers{"task": {"first_encounter_date": "2026-10-03"}}, reviews, created, created)
	want := map[string]string{"day_1": "2026-10-04", "days_3_7": "2026-10-08", "day_14": "2026-10-17", "day_30": "2026-11-02"}
	for key, due := range want {
		if reviews[key].Due != due || reviews[key].Earliest != due {
			t.Errorf("%s: %+v, want %s", key, reviews[key], due)
		}
	}
	if len(reviews) != len(want) {
		t.Errorf("reviews %v", reviews)
	}
}

// up's delay rule on §10: the same-day row is written any time, a dated row
// only on or after its date.
func TestVocabularyAuditRetestRowsOpenOnTheirDay(t *testing.T) {
	k, _ := Lookup("vocabulary_audit")
	s := &Service{}
	created := learning.Day{Year: 2026, Month: time.October, Day: 1}
	w := &Worksheet{Answers: Answers{"task": {"first_encounter_date": "2026-10-01"}}, Status: StatusOpen,
		Reviews: map[string]ReviewDate{}}
	schedule(k, w.Answers, w.Reviews, created, created)

	row := func(key string) *Write {
		return &Write{Sections: map[string]map[string]any{"retest": {"timeline": []any{
			map[string]any{"row": key, "cells": map[string]any{"result": "recalled it"}}}}}}
	}
	if err := s.finish(k, w, row("same_day"), created, created, nil); err != nil {
		t.Fatalf("the same-day row on day 0: %v", err)
	}
	if err := s.finish(k, w, row("day_1"), created, created, nil); !errors.Is(err, ErrTooEarly) {
		t.Fatalf("the Day 1 row on day 0: %v, want ErrTooEarly", err)
	}
	day2 := learning.Day{Year: 2026, Month: time.October, Day: 2}
	write := row("day_1")
	if err := s.finish(k, w, write, created, day2, nil); err != nil {
		t.Fatalf("the Day 1 row on its day: %v", err)
	}
	if !write.Reviews["day_1"].Done {
		t.Errorf("writing the Day 1 row did not close its review: %+v", write.Reviews)
	}
	if err := s.finish(k, w, row("days_3_7"), created, day2, nil); !errors.Is(err, ErrTooEarly) {
		t.Fatalf("the Days 3–7 row on day 1: %v, want ErrTooEarly", err)
	}
}

// AC2 for the kind: a wrong option, a score outside 0–2, a row past the
// queue's 30, or a row label that is not one of §5's are refused, naming the
// field.
func TestVocabularyAuditRefusesAnswersThatDoNotFit(t *testing.T) {
	k, _ := Lookup("vocabulary_audit")
	queue := func(n int, decision string) string {
		rows := make([]string, n)
		for i := range rows {
			rows[i] = fmt.Sprintf(`{"row":"","cells":{"item":"w%d","impact":"minor","decision":%q}}`, i, decision)
		}
		return `{"items":[` + strings.Join(rows, ",") + `]}`
	}
	ok := map[string]json.RawMessage{"queue": json.RawMessage(queue(30, "quick lookup"))}
	if _, err := Validate(k, ok); err != nil {
		t.Fatalf("a full queue of up's options: %v", err)
	}
	for name, sections := range map[string]map[string]json.RawMessage{
		"a decision up does not have": {"queue": json.RawMessage(queue(1, "memorise"))},
		"a 31st queue row":            {"queue": json.RawMessage(queue(31, "learn"))},
		"a task outside up's six":     {"task": json.RawMessage(`{"task":"translate"}`)},
		"a score of 3":                {"score": json.RawMessage(`{"scores":[{"row":"recognise","cells":{"day_7":3}}]}`)},
		"a §5 row that is not up's":   {"verify": json.RawMessage(`{"checks":[{"row":"spelling","cells":{"result":"x"}}]}`)},
		"an unknown field":            {"chunk": json.RawMessage(`{"etymology":"x"}`)},
	} {
		_, err := Validate(k, sections)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field == "" {
			t.Errorf("%s: %v, want a FieldError naming the field", name, err)
		}
	}
}
