package worksheet

import (
	"errors"
	"fmt"
)

// quick.go is each kind's quick version (the private design notes,
// phase 5): three to five lines that take about five minutes, shown first,
// with the full worksheet one click away. The English walkthrough's
// "5-minute diagnostic" was 58 fields and the listening page 63; a learner
// who meets that on day one does not start.
//
// A quick field is the same stored value as the full worksheet's, never a
// copy. A kind with reviews counted from a field includes that field, so a
// quick worksheet is scheduled like a full one (red team 4); Today pre-fills
// a "this happened on" date with the learner's day. Short kinds (twelve
// fields or fewer) have none: they are quick already.

// QuickField names one field of a kind's quick version.
type QuickField struct {
	Section string `json:"section"`
	Field   string `json:"field"`
	// Today pre-fills an empty date with the learner's local day.
	Today bool `json:"today,omitempty"`
}

// MaxQuick is the most fields a quick version has.
const MaxQuick = 5

func q(section, field string) QuickField { return QuickField{Section: section, Field: field} }

func qToday(section, field string) QuickField {
	return QuickField{Section: section, Field: field, Today: true}
}

var quickSets = map[string][]QuickField{
	// Language.
	"english_diagnostic": {q("boundary", "context"), q("boundary", "topic"), qToday("first_version", "first_version_on"),
		q("cefr", "levels"), q("repair", "barrier")},
	"listening_audit": {q("task", "situation"), q("first_pass", "gist"), q("first_pass", "details"),
		q("first_pass", "uncertain"), q("errors", "top_problems")},
	"reading_evidence": {q("task", "situation"), q("first_pass", "gist"), q("first_pass", "details"),
		q("first_pass", "unresolved"), q("barriers", "top")},
	"speaking_evidence": {q("task", "situation"), q("task", "listener"), q("baselines", "samples"),
		q("baselines", "main_point"), q("baselines", "expected_misunderstanding")},
	"vocabulary_audit": {q("task", "situation"), qToday("task", "first_encounter_date"), q("first", "gist"),
		q("first", "guessed"), q("queue", "learn")},
	"writing_evidence": {q("task", "situation"), q("task", "audience"), q("draft", "draft"),
		q("draft", "weakest_fact"), q("draft", "expected_action")},
	"grammar_evidence": {q("task", "situation"), q("problem", "original"), q("problem", "intended"),
		q("problem", "structure"), q("contrast", "explanation")},
	"interview_evidence": {q("role", "role"), q("role", "deadline"), qToday("baseline", "date"),
		q("language_map", "gap"), q("gates", "smallest_next")},
	// Projects.
	"ai_case_review": {q("source", "experience"), q("judgement", "problem"), q("judgement", "choice"),
		q("result", "happened"), q("principles", "test")},
	"ai_evaluation": {q("scope", "user"), q("scope", "baseline"), q("setup", "change"),
		q("decision", "decision"), q("decision", "retest")},
	"ai_project_scorecard": {q("scorecard", "project"), q("scorecard", "user"), q("decision", "keep"),
		q("decision", "adjust"), q("decision", "next")},
	"ai_trend_radar": {q("signal", "trend"), q("signal", "source"), q("task", "bottleneck"),
		q("experiment", "change"), q("decision", "decision")},
	"artifact_brief": {q("boundary", "name"), q("boundary", "audience"), q("boundary", "smallest"),
		q("boundary", "first_deadline"), q("delivery", "date_version")},
	"consistency_plan": {qToday("cycle", "from"), q("cycle", "to"), q("goal", "outcome"),
		q("start", "first"), q("start", "obstacle")},
	"cycle_close": {q("review", "delivery"), q("review", "changed"), q("review", "keep"),
		q("review", "stop"), q("three_lines", "ability")},
	"startup_experiment": {q("assumption", "assumption"), q("assumption", "users"), q("limits", "continue_if"),
		q("limits", "stop_if"), q("conclusion", "next_review")},
	// Life.
	"life_care_card": {q("person", "subject"), q("person", "their_need"), q("next", "my_action"),
		q("next", "their_action"), q("review", "review_date")},
	"choice_brief": {q("problem", "problem"), q("problem", "deadline"), q("options", "option_a"),
		q("options", "option_b"), q("roles", "review_date")},
	"narrative_case_review": {q("source", "experience"), q("judgement", "problem"), q("result", "happened"),
		q("principles", "test"), q("next_test", "experiment")},
	"recovery_reset": {q("safety", "safety_issue"), q("body", "sleep"), q("today", "task"),
		q("today", "first_action"), q("return", "review_date")},
	"relationship_card": {q("before", "situation"), q("before", "aim"), q("before", "request"),
		q("before", "boundary"), q("after", "review_on")},
	"self_reflection": {q("hypothesis", "hypothesis"), q("hypothesis", "retest_on"), q("observation", "facts"),
		q("observation", "change"), q("decision", "problem")},
}

// checkQuick refuses a quick version that names no field, is too long, sets
// Today on a field that is not a date, or leaves out a review's anchor.
func checkQuick(k *Kind) error {
	if len(k.Quick) == 0 {
		return nil
	}
	if len(k.Quick) > MaxQuick {
		return fmt.Errorf("quick version has %d fields, the most is %d", len(k.Quick), MaxQuick)
	}
	in := map[string]bool{}
	for _, f := range k.Quick {
		field := k.field(f.Section, f.Field)
		if field == nil {
			return fmt.Errorf("quick field %s.%s: no such field", f.Section, f.Field)
		}
		if f.Today && field.Type != Date {
			return fmt.Errorf("quick field %s.%s: only a date is filled with today", f.Section, f.Field)
		}
		in[f.Section+"."+f.Field] = true
	}
	for _, r := range k.Reviews {
		if !r.From.IsCreation() && !in[r.From.Section+"."+r.From.Field] {
			return errors.New("quick version leaves out review " + r.Key + "'s anchor " + r.From.Section + "." + r.From.Field)
		}
	}
	return nil
}
