package worksheet

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/learning"
)

// The eleven cards of up's part 6, in up's order, each led by the chapter it
// comes from (phase 3 requirements 1 and 2).
func TestTheSelfReflectionCardsFollowPartSix(t *testing.T) {
	k, ok := Lookup("self_reflection")
	if !ok {
		t.Fatal("self_reflection is not registered")
	}
	if !k.Private || !IsPrivate(k.Kind) || k.Group != GroupLife || k.Attach != AttachNone {
		t.Errorf("private %v, group %q, attach %q", k.Private, k.Group, k.Attach)
	}
	if !strings.HasPrefix(k.Source, selfReflectionSource) {
		t.Errorf("source %q", k.Source)
	}
	chapters := []struct{ key, chapter string }{
		{"avoidance", "Understanding yourself"},
		{"observation", "Understanding yourself"},
		{"borrowed", "Knowing yourself"},
		{"decision", "Knowing yourself"},
		{"work_note", "Being kind to yourself"},
		{"return", "Being kind to yourself"},
		{"purpose", "Improving yourself"},
		{"ai_check", "Improving yourself"},
		{"hypothesis", "Improving yourself"},
		{"history", "Being your own lifelong friend"},
		{"commitment", "Being your own lifelong friend"},
	}
	if len(k.Sections) != len(chapters) {
		t.Fatalf("%d sections, want one per card (%d)", len(k.Sections), len(chapters))
	}
	for i, c := range chapters {
		s := k.Sections[i]
		if s.Key != c.key {
			t.Errorf("section %d is %s, want %s", i+1, s.Key, c.key)
		}
		lead := "From “" + c.chapter + "”: "
		if !strings.HasPrefix(s.Hint, lead) || len(s.Hint) <= len(lead) {
			t.Errorf("%s: lead %q does not name its chapter and say what the card is for", s.Key, s.Hint)
		}
		if s.Added || s.Continues {
			t.Errorf("%s: every card is its own up section", s.Key)
		}
	}
}

// Every card is optional: a worksheet with one card written validates, and
// exports that card with the rest left blank (phase 3 requirement 2).
func TestOneSelfReflectionCardIsEnough(t *testing.T) {
	k, _ := Lookup("self_reflection")
	clean, err := Validate(k, map[string]json.RawMessage{
		"work_note": json.RawMessage(`{"fact":"Skipped the call on Tuesday","support":"A reminder the night before"}`),
	})
	if err != nil {
		t.Fatalf("one card refused: %v", err)
	}
	w := &Worksheet{Kind: k.Kind, Title: "Tuesday", Status: StatusOpen, Private: true,
		Answers: Answers(clean), Reviews: map[string]ReviewDate{}}
	md := Markdown(k, w)
	for _, want := range []string{
		"\nprivate: true\n",
		"  retest: \"not scheduled\"\n",
		"Fact: what did I do, and where?: Skipped the call on Tuesday",
		"Support: what condition, reminder or help would make next time go better?: A reminder the night before",
	} {
		if !strings.Contains(md, want) {
			t.Errorf("the export lacks %q:\n%s", want, md)
		}
	}
	for _, s := range k.Sections {
		if !strings.Contains(md, "\n## "+s.Title+"\n") {
			t.Errorf("the export lacks the heading of %s", s.Key)
		}
	}
}

// The thirty-day experiment's retest date is the kind's one review: nothing
// is scheduled until it is written, it follows the date, and clearing it
// unschedules (phase 3 requirement 3).
func TestTheRetestDateIsTheSelfReflectionReview(t *testing.T) {
	k, _ := Lookup("self_reflection")
	created := learning.Day{Year: 2026, Month: time.October, Day: 1}
	reviews := map[string]ReviewDate{}
	schedule(k, Answers{"work_note": {"fact": "x"}, "hypothesis": {"baseline": "three sentences"}}, reviews, created, created)
	if len(reviews) != 0 {
		t.Fatalf("scheduled before a retest date was written: %v", reviews)
	}
	schedule(k, Answers{"hypothesis": {"retest_on": "2026-10-31"}}, reviews, created, created)
	if r := reviews["retest"]; r.Due != "2026-10-31" || r.Earliest != "2026-10-31" || len(reviews) != 1 {
		t.Fatalf("reviews %v, want retest on 2026-10-31", reviews)
	}
	schedule(k, Answers{"hypothesis": {"retest_on": "2026-11-07"}}, reviews, created, created)
	if r := reviews["retest"]; r.Due != "2026-11-07" {
		t.Errorf("a rewritten retest date did not move the review: %v", reviews)
	}
	schedule(k, Answers{"hypothesis": {}}, reviews, created, created)
	if len(reviews) != 0 {
		t.Errorf("a cleared retest date is still scheduled: %v", reviews)
	}
}

// up's four day-thirty decisions, and nothing else; the retest is a date.
func TestTheSelfReflectionCardsRefuseAnswersThatDoNotFit(t *testing.T) {
	k, _ := Lookup("self_reflection")
	if _, err := Validate(k, map[string]json.RawMessage{
		"hypothesis": json.RawMessage(`{"decision":"transfer","retest_on":"2026-10-31"}`),
	}); err != nil {
		t.Errorf("up's own answers refused: %v", err)
	}
	for name, raw := range map[string]string{
		"a decision up does not list":     `{"hypothesis":{"decision":"push harder"}}`,
		"a retest that is not a date":     `{"hypothesis":{"retest_on":"in a month"}}`,
		"a line the card does not have":   `{"commitment":{"reward":"cake"}}`,
		"a one-line field over its limit": `{"avoidance":{"intended":"` + strings.Repeat("x", MaxText+1) + `"}}`,
	} {
		var sections map[string]json.RawMessage
		if err := json.Unmarshal([]byte(raw), &sections); err != nil {
			t.Fatal(err)
		}
		_, err := Validate(k, sections)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field == "" {
			t.Errorf("%s: %v, want a FieldError naming the field", name, err)
		}
	}
}
