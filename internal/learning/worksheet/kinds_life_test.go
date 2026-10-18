package worksheet

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/learning"
)

// lifeKinds are phase 9's five kinds and the care card up added at f13ff2d
// (plans/261017-1828-up-f13ff2d-upgrade, phase 1).
var lifeKinds = []string{"choice_brief", "attention_audit", "relationship_card", "recovery_reset", "life_weekly_review",
	"life_care_card"}

// Every life kind is private, in the life group and attached to nothing
// (plan principle 5, phase 9 requirement 1).
func TestLifeKindsArePrivateAndStandAlone(t *testing.T) {
	for _, id := range lifeKinds {
		k, ok := Lookup(id)
		if !ok {
			t.Fatalf("%s is not registered", id)
		}
		if !k.Private || !IsPrivate(id) || k.Group != GroupLife || k.Attach != AttachNone {
			t.Errorf("%s: private %v, group %q, attach %q", id, k.Private, k.Group, k.Attach)
		}
		if !strings.HasPrefix(k.Source, lifeSource) {
			t.Errorf("%s: source %q", id, k.Source)
		}
	}
}

// Each kind's review: the date the learner writes for the choice brief, the
// relationship card and the recovery reset; a week after creation for the
// attention audit and the weekly questions.
func TestLifeKindReviews(t *testing.T) {
	created := learning.Day{Year: 2026, Month: time.October, Day: 1}
	for id, c := range map[string]struct {
		answers Answers
		key     string
	}{
		"choice_brief":      {Answers{"roles": {"review_date": "2026-10-20"}}, "review"},
		"relationship_card": {Answers{"after": {"review_on": "2026-10-20"}}, "next_review"},
		"recovery_reset":    {Answers{"return": {"review_date": "2026-10-20"}}, "review"},
		"life_care_card":    {Answers{"review": {"review_date": "2026-10-20"}}, "review"},
	} {
		k, _ := Lookup(id)
		reviews := map[string]ReviewDate{}
		schedule(k, Answers{}, reviews, created, created)
		if len(reviews) != 0 {
			t.Errorf("%s: scheduled before its date was written: %v", id, reviews)
		}
		schedule(k, c.answers, reviews, created, created)
		if r := reviews[c.key]; r.Due != "2026-10-20" || r.Earliest != "2026-10-20" || len(reviews) != 1 {
			t.Errorf("%s: %v, want %s on 2026-10-20", id, reviews, c.key)
		}
	}
	for _, id := range []string{"attention_audit", "life_weekly_review"} {
		k, _ := Lookup(id)
		reviews := map[string]ReviewDate{}
		schedule(k, Answers{}, reviews, created, created)
		if r := reviews["next_week"]; r.Due != "2026-10-08" || len(reviews) != 1 {
			t.Errorf("%s: %v, want next_week on 2026-10-08", id, reviews)
		}
	}
}

// The recovery reset starts with safety, as up orders it, and its support
// agreement and return-to-work gates are their own sections; the
// relationship card's "after the talk" is its own section.
func TestLifeKindSectionOrder(t *testing.T) {
	keys := func(id string) string {
		k, _ := Lookup(id)
		var out []string
		for _, s := range k.Sections {
			out = append(out, s.Key)
		}
		return strings.Join(out, ",")
	}
	if got := keys("recovery_reset"); got != "safety,body,today,support,return" {
		t.Errorf("recovery_reset sections %s", got)
	}
	if got := keys("relationship_card"); got != "before,after" {
		t.Errorf("relationship_card sections %s", got)
	}
	k, _ := Lookup("recovery_reset")
	if f := k.Sections[0].Fields[0]; f.Key != "safety_issue" {
		t.Errorf("recovery_reset opens with %s, want the safety issue", f.Key)
	}
}

// AC2 for the life kinds: up's option lists, the attention table's five
// areas, and nothing else.
func TestLifeKindsRefuseAnswersThatDoNotFit(t *testing.T) {
	ok := map[string]map[string]json.RawMessage{
		"choice_brief":    {"facts": json.RawMessage(`{"problem_type":"values in conflict"}`), "gates": json.RawMessage(`{"on_trigger":"roll back"}`)},
		"attention_audit": {"week": json.RawMessage(`{"from":"2026-10-01","to":"2026-10-07","areas":[{"row":"body","cells":{"facts":"slept six hours"}}]}`)},
		"recovery_reset":  {"safety": json.RawMessage(`{"mode":"reduced load"}`), "today": json.RawMessage(`{"floor":["food","necessary care"]}`)},
	}
	for id, sections := range ok {
		k, _ := Lookup(id)
		if _, err := Validate(k, sections); err != nil {
			t.Errorf("%s: up's own answers refused: %v", id, err)
		}
	}
	for name, c := range map[string]struct {
		kind     string
		sections map[string]json.RawMessage
	}{
		"a problem type up does not list":   {"choice_brief", map[string]json.RawMessage{"facts": json.RawMessage(`{"problem_type":"bad luck"}`)}},
		"a trigger action up does not list": {"choice_brief", map[string]json.RawMessage{"gates": json.RawMessage(`{"on_trigger":"ignore it"}`)}},
		"a sixth attention area":            {"attention_audit", map[string]json.RawMessage{"week": json.RawMessage(`{"areas":[{"row":"money","cells":{"facts":"x"}}]}`)}},
		"a mode up does not list":           {"recovery_reset", map[string]json.RawMessage{"safety": json.RawMessage(`{"mode":"push through"}`)}},
		"a floor item up does not list":     {"recovery_reset", map[string]json.RawMessage{"today": json.RawMessage(`{"floor":["exercise"]}`)}},
		"a date that is not a date":         {"relationship_card", map[string]json.RawMessage{"after": json.RawMessage(`{"review_on":"next week"}`)}},
		"a sixth weekly question":           {"life_weekly_review", map[string]json.RawMessage{"questions": json.RawMessage(`{"mood":"x"}`)}},
	} {
		k, _ := Lookup(c.kind)
		_, err := Validate(k, c.sections)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field == "" {
			t.Errorf("%s: %v, want a FieldError naming the field", name, err)
		}
	}
}

// The export is the learner's own download, and says it is private.
func TestALifeExportSaysItIsPrivate(t *testing.T) {
	k, _ := Lookup("recovery_reset")
	w := &Worksheet{Kind: k.Kind, Title: "A slow week", Status: StatusOpen, Private: true,
		Answers: Answers{"safety": {"mode": "safety"}}, Reviews: map[string]ReviewDate{}}
	md := Markdown(k, w)
	front, _, _ := strings.Cut(strings.TrimPrefix(md, "---\n"), "---\n")
	if !strings.Contains(front, "\nprivate: true\n") {
		t.Fatalf("front matter without private: true:\n%s", front)
	}
	if strings.Index(md, "## Safety first") > strings.Index(md, "## Body") {
		t.Errorf("the export does not open with safety:\n%s", md)
	}
	public, _ := Lookup("vocabulary_audit")
	if strings.Contains(Markdown(public, &Worksheet{Kind: public.Kind, Title: "x", Reviews: map[string]ReviewDate{}}), "private:") {
		t.Error("a public worksheet's export says private")
	}
}

// At f13ff2d up inserted the care card as §5, so the weekly review is §6.
// Only the section it follows moved: a weekly review exports the headings
// and lines it did before (plans/261017-1828-up-f13ff2d-upgrade, phase 0).
func TestTheWeeklyReviewExportsAsBefore(t *testing.T) {
	k, _ := Lookup("life_weekly_review")
	if k.Version != 1 {
		t.Errorf("version %d: its fields did not change, so it stays version 1", k.Version)
	}
	w := &Worksheet{Kind: k.Kind, Title: "Week 41", Status: StatusOpen, Private: true,
		Answers: Answers{"questions": {"fact": "a", "result": "b", "repeated": "c", "boundary": "d", "experiment": "e"}},
		Reviews: map[string]ReviewDate{"next_week": {Due: "2026-10-24", Earliest: "2026-10-24"}}}
	var structure []string
	for _, line := range strings.Split(Markdown(k, w), "\n") {
		if strings.HasPrefix(line, "#") || strings.Contains(line, "?: ") {
			structure = append(structure, line)
		}
	}
	want := []string{
		"# Week 41",
		"## This week",
		"Which fact changed how I judged something?: a  ",
		"Which action left a result I can look at?: b  ",
		"Which mistake came back, and what might be behind it?: c  ",
		"Which boundary needs clearer words or firmer follow-through?: d  ",
		"Which one small experiment will I keep next week?: e",
	}
	if strings.Join(structure, "\n") != strings.Join(want, "\n") {
		t.Fatalf("export structure:\n%s\nwant:\n%s", strings.Join(structure, "\n"), strings.Join(want, "\n"))
	}
}

// The care card follows up's §5 block in its four groups, with the review
// date last; its one review is the date the learner writes, and only that
// (plans/261017-1828-up-f13ff2d-upgrade, phase 1).
func TestTheCareCardFollowsUpsFourGroups(t *testing.T) {
	k, ok := Lookup("life_care_card")
	if !ok {
		t.Fatal("life_care_card is not registered")
	}
	var sections []string
	fields := 0
	for i, s := range k.Sections {
		sections = append(sections, s.Key)
		if s.Continues != (i > 0) {
			t.Errorf("%s: continues %v; the four groups are one up section", s.Key, s.Continues)
		}
		fields += len(s.Fields)
	}
	if got := strings.Join(sections, ","); got != "person,carry,next,review" {
		t.Errorf("sections %s", got)
	}
	if fields != 19 {
		t.Errorf("%d fields, want up's 19 lines", fields)
	}
	if len(k.Reviews) != 1 || k.Reviews[0].From != (Anchor{Section: "review", Field: "review_date"}) {
		t.Errorf("reviews %+v, want one, from the next review date", k.Reviews)
	}
	if !strings.Contains(k.Summary, "threads/part-2/care-and-carry-on.md") {
		t.Errorf("the summary does not link the chapter: %q", k.Summary)
	}
	for _, s := range k.Sections {
		if s.Key == "next" && !strings.Contains(s.Hint, "agreed") {
			t.Errorf("the next step's hint does not say the other person's part needs their agreement: %q", s.Hint)
		}
	}

	// The review is the date written, moves when it moves, and is gone
	// when it is cleared.
	created := learning.Day{Year: 2026, Month: time.October, Day: 1}
	reviews := map[string]ReviewDate{}
	schedule(k, Answers{"person": {"subject": "Weekly shopping for Mum"}}, reviews, created, created)
	if len(reviews) != 0 {
		t.Fatalf("scheduled with no review date: %v", reviews)
	}
	schedule(k, Answers{"review": {"review_date": "2026-10-15"}}, reviews, created, created)
	if r := reviews["review"]; r.Due != "2026-10-15" || r.Earliest != "2026-10-15" {
		t.Errorf("review %v, want 2026-10-15", reviews)
	}
	schedule(k, Answers{"review": {"review_date": "2026-10-29"}}, reviews, created, created)
	if r := reviews["review"]; r.Due != "2026-10-29" {
		t.Errorf("review %v after the date moved, want 2026-10-29", reviews)
	}
	schedule(k, Answers{"review": {"review_date": ""}}, reviews, created, created)
	if len(reviews) != 0 {
		t.Errorf("review %v after the date was cleared", reviews)
	}

	// AC2: up's lines and nothing else; a date is a date.
	if _, err := Validate(k, map[string]json.RawMessage{
		"person": json.RawMessage(`{"their_need":"unknown"}`),
		"next":   json.RawMessage(`{"my_action":"Book the Thursday lift by 2026-10-09"}`),
		"review": json.RawMessage(`{"review_date":"2026-10-15"}`),
	}); err != nil {
		t.Errorf("up's own answers refused: %v", err)
	}
	for name, sections := range map[string]map[string]json.RawMessage{
		"a review date that is not a date": {"review": json.RawMessage(`{"review_date":"in two weeks"}`)},
		"a line up does not have":          {"carry": json.RawMessage(`{"love_score":"8"}`)},
		"an over-long line":                {"person": json.RawMessage(`{"subject":"` + strings.Repeat("x", MaxText+1) + `"}`)},
	} {
		_, err := Validate(k, sections)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field == "" {
			t.Errorf("%s: %v, want a FieldError naming the field", name, err)
		}
	}
}
