package loop

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

func day(iso string) learning.Day {
	d, err := dayOf(iso)
	if err != nil {
		panic(err)
	}
	return d
}

func entryIn(tp string) CardEntryInput {
	return CardEntryInput{Timepoint: tp, Body: "an attempt", PromptLevel: PromptUnaided}
}

// TestRetestDueDateComesFromTheKind: the baseline sets retest_due_on to the
// learner's day plus the kind's delay — 14 for a skill, 5 for a field note.
func TestRetestDueDateComesFromTheKind(t *testing.T) {
	now := time.Date(2026, 9, 27, 23, 30, 0, 0, time.UTC)
	for kind, want := range map[string]string{
		CardWriting: "2026-10-12", CardSpeaking: "2026-10-12", CardFieldNote: "2026-10-03",
	} {
		c := SkillCard{Kind: kind, Status: CardOpen}
		ch, err := decideEntry(c, entryIn(TimepointBaseline), day("2026-09-28"), now)
		if err != nil {
			t.Fatalf("%s baseline: %v", kind, err)
		}
		if ch.Status != CardRetestDue || ch.RetestDueOn != want || ch.BaselineAt == nil {
			t.Errorf("%s: change = %+v, want retest_due on %s", kind, ch, want)
		}
	}
}

// TestTheRetestIsRefusedBeforeItsDay is the delay rule, decided on calendar
// days: the day before is refused with ErrRetestNotDue, the day itself is not.
func TestTheRetestIsRefusedBeforeItsDay(t *testing.T) {
	base := time.Date(2026, 9, 27, 8, 0, 0, 0, time.UTC)
	c := SkillCard{Kind: CardReading, Status: CardRetestDue, BaselineAt: &base, RetestDueOn: "2026-10-11"}
	for _, today := range []string{"2026-09-27", "2026-10-10"} {
		if _, err := decideEntry(c, entryIn(TimepointDelayed), day(today), base); !errors.Is(err, ErrRetestNotDue) {
			t.Errorf("retest on %s: err = %v, want ErrRetestNotDue", today, err)
		}
	}
	for _, today := range []string{"2026-10-11", "2026-11-30"} {
		ch, err := decideEntry(c, entryIn(TimepointDelayed), day(today), base)
		if err != nil || ch.Status != CardOpen {
			t.Errorf("retest on %s: %+v, %v — want the card back to open", today, ch, err)
		}
	}
}

func TestTheCardsOrderIsEnforced(t *testing.T) {
	base := time.Now()
	today := day("2026-09-27")
	fresh := SkillCard{Kind: CardGrammar, Status: CardOpen}
	pending := SkillCard{Kind: CardGrammar, Status: CardRetestDue, BaselineAt: &base, RetestDueOn: "2026-10-11"}
	retested := SkillCard{Kind: CardGrammar, Status: CardOpen, BaselineAt: &base, RetestDueOn: "2026-10-11"}
	closed := SkillCard{Kind: CardGrammar, Status: CardClosed, BaselineAt: &base, RetestDueOn: "2026-10-11"}
	cases := []struct {
		name string
		card SkillCard
		tp   string
		ok   bool
	}{
		{"practice before the first attempt", fresh, TimepointImmediate, false},
		{"a transfer before the first attempt", fresh, TimepointTransfer, false},
		{"the first attempt", fresh, TimepointBaseline, true},
		{"a second first attempt", pending, TimepointBaseline, false},
		{"a second first attempt after the retest", retested, TimepointBaseline, false},
		{"practice while the retest is pending", pending, TimepointImmediate, true},
		{"a transfer before the retest", pending, TimepointTransfer, false},
		{"a transfer after the retest", retested, TimepointTransfer, true},
		{"another retest after the retest", retested, TimepointDelayed, true},
		{"anything on a closed card", closed, TimepointImmediate, false},
	}
	for _, tc := range cases {
		_, err := decideEntry(tc.card, entryIn(tc.tp), today, base)
		if (err == nil) != tc.ok {
			t.Errorf("%s: err = %v, want ok=%v", tc.name, err, tc.ok)
		}
		if err != nil && !errors.Is(err, ErrConflict) && !errors.Is(err, ErrRetestNotDue) {
			t.Errorf("%s: err = %v, want a conflict", tc.name, err)
		}
	}
}

func TestTheFirstAttemptIsTheUnaidedOne(t *testing.T) {
	in := entryIn(TimepointBaseline)
	in.PromptLevel = PromptLightCue
	if err := in.validate(); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cued baseline: err = %v, want ErrInvalid", err)
	}
	in = entryIn(TimepointDelayed)
	in.PromptLevel = PromptHeavyCue
	if err := in.validate(); err != nil {
		t.Fatalf("cued retest: %v", err)
	}
	in.Body = strings.Repeat("é", MaxEntryChars) // characters, not bytes
	if err := in.validate(); err != nil {
		t.Fatalf("20,000 characters: %v", err)
	}
	in.Body += "x"
	if err := in.validate(); !errors.Is(err, ErrInvalid) {
		t.Fatalf("20,001 characters: err = %v", err)
	}
}

func TestLinksAreValidatedBeforeTheyAreResolved(t *testing.T) {
	in := entryIn(TimepointImmediate)
	for name, l := range map[string]CardLink{
		"unknown kind":    {Kind: "chat", ID: uuid.New()},
		"no id":           {Kind: LinkNote},
		"a page on notes": {Kind: LinkNote, ID: uuid.New(), Page: 2},
	} {
		in.Links = []CardLink{l}
		if err := in.validate(); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
	in.Links = []CardLink{{Kind: LinkDocument, ID: uuid.New(), Page: 3}, {Kind: LinkQuizAttempt, ID: uuid.New()}}
	if err := in.validate(); err != nil {
		t.Fatalf("valid links: %v", err)
	}
}

// TestWithholdHidesAPendingBaselineOnly — mutation-checked: returning entries
// unchanged fails the first assertion.
func TestWithholdHidesAPendingBaselineOnly(t *testing.T) {
	entries := func() []CardEntry {
		return []CardEntry{
			{Timepoint: TimepointBaseline, Body: "my first try", Links: []CardLink{{Kind: LinkNote, ID: uuid.New()}}},
			{Timepoint: TimepointImmediate, Body: "practice"},
		}
	}
	got := withhold(SkillCard{Status: CardRetestDue}, entries())
	if got[0].Body != "" || len(got[0].Links) != 0 || !got[0].Withheld {
		t.Fatalf("pending baseline shown: %+v", got[0])
	}
	if got[1].Body != "practice" || got[1].Withheld {
		t.Fatalf("practice withheld: %+v", got[1])
	}
	for _, status := range []string{CardOpen, CardClosed} {
		if got := withhold(SkillCard{Status: status}, entries()); got[0].Body != "my first try" || got[0].Withheld {
			t.Errorf("%s card: baseline withheld: %+v", status, got[0])
		}
	}
}

func TestNewCardSetupIsTheKindsOwn(t *testing.T) {
	ok := NewCard{Kind: CardFieldNote, Title: "Chapter 3", Setup: map[string]string{
		"situation": "Team retro", "source": "Chapter 3", "standard": "Run one retro with it"}}
	if _, setup, err := ok.validate(); err != nil || setup["source"] != "Chapter 3" {
		t.Fatalf("valid card: %v %v", setup, err)
	}
	for name, in := range map[string]NewCard{
		"unknown kind":     {Kind: "juggling", Title: "x"},
		"no title":         {Kind: CardReading, Title: " ", Setup: ok.Setup},
		"missing required": {Kind: CardFieldNote, Title: "x", Setup: map[string]string{"situation": "s"}},
		"a foreign field":  {Kind: CardFieldNote, Title: "x", Setup: map[string]string{"listener": "x"}},
	} {
		if _, _, err := in.validate(); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
}

// TestEveryKindHasPromptsForEveryTimepoint: the page renders prompts from
// this table, so a missing one is a blank step.
func TestEveryKindHasPromptsForEveryTimepoint(t *testing.T) {
	if len(CardKinds()) != 7 {
		t.Fatalf("%d kinds, want 7", len(CardKinds()))
	}
	for _, k := range CardKinds() {
		want := SkillRetestDays
		if k.Kind == CardFieldNote {
			want = FieldNoteRetestDays
		}
		if k.RetestDelayDays != want {
			t.Errorf("%s: delay %d, want %d", k.Kind, k.RetestDelayDays, want)
		}
		for _, tp := range Timepoints() {
			if len(k.Prompts[tp]) == 0 {
				t.Errorf("%s: no prompt for %s", k.Kind, tp)
			}
		}
		if len(k.Setup) == 0 || k.Name == "" || k.Summary == "" {
			t.Errorf("%s: incomplete definition", k.Kind)
		}
	}
}
