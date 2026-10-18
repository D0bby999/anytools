package worksheet

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/learning"
)

// The unaided draft holds up to 20,000 characters; every other long line of
// the card keeps the engine's 5,000 (AC2).
func TestTheWritingDraftHoldsTwentyThousandCharacters(t *testing.T) {
	k, ok := Lookup(WritingEvidenceKind)
	if !ok {
		t.Fatal("writing_evidence is not registered")
	}
	send := func(section, field, value string) error {
		raw, _ := json.Marshal(map[string]string{field: value})
		_, err := Validate(k, map[string]json.RawMessage{section: raw})
		return err
	}
	if err := send(WritingDraftSection, WritingDraftField, strings.Repeat("é", MaxLongCeiling)); err != nil {
		t.Fatalf("a 20,000-character draft: %v", err)
	}
	var fe *FieldError
	if err := send(WritingDraftSection, WritingDraftField, strings.Repeat("a", MaxLongCeiling+1)); !errors.As(err, &fe) || fe.Field != "draft.draft" {
		t.Fatalf("a draft over 20,000 characters: %v", err)
	}
	if err := send("ai", "verification", strings.Repeat("a", MaxLong+1)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("another long line over %d characters: %v", MaxLong, err)
	}
	// up's option lists, AC2: a wrong option is refused.
	if err := send(WritingTaskSection, "task", "persuade"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a task outside up's list: %v", err)
	}
	if len(WritingPasses) != 5 || k.field(WritingPassesSection, WritingPassesField) == nil {
		t.Fatal("§6 lost its five passes")
	}
	for _, p := range WritingPasses {
		if !k.field(WritingPassesSection, WritingPassesField).hasRow(p) {
			t.Fatalf("pass %q is not a row of §6", p)
		}
	}
}

// AC4: the retests count from the day the draft is first saved, and §10's
// later rows cannot be written before their dates (up's delay rule).
func TestWritingRetestsCountFromTheDraft(t *testing.T) {
	k, _ := Lookup(WritingEvidenceKind)
	s := &Service{}
	created := learning.Day{Year: 2026, Month: time.October, Day: 1}
	w := &Worksheet{Answers: Answers{}, Status: StatusOpen, Reviews: map[string]ReviewDate{}}
	// write applies a section write the way the store does.
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
	if err := write(created, map[string]map[string]any{"task": {"situation": "a status email"}}); err != nil {
		t.Fatal(err)
	}
	if len(w.Reviews) != 0 {
		t.Fatalf("scheduled before any draft: %v", w.Reviews)
	}
	drafted := learning.Day{Year: 2026, Month: time.October, Day: 3}
	if err := write(drafted, map[string]map[string]any{"draft": {"draft": "My first draft."}}); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"days_3_7": "2026-10-08", "day_14": "2026-10-17", "day_30": "2026-11-02"}
	for key, due := range want {
		if w.Reviews[key].Due != due {
			t.Errorf("%s due %q, want %q", key, w.Reviews[key].Due, due)
		}
	}
	early := learning.Day{Year: 2026, Month: time.October, Day: 6}
	err := write(early, map[string]map[string]any{"retest": {"timeline": []TableRow{
		{Row: "days_3_7", Cells: map[string]any{"result": "a parallel text"}}}}})
	if !errors.Is(err, ErrTooEarly) {
		t.Fatalf("the days 3–7 row on day 3 after the draft: %v", err)
	}
	// Day 1's row has no gate.
	if err := write(early, map[string]map[string]any{"retest": {"timeline": []TableRow{
		{Row: "day_1", Cells: map[string]any{"result": "delivered"}}}}}); err != nil {
		t.Fatalf("the day 1 row: %v", err)
	}
}
