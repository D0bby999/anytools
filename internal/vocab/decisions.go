package vocab

// decisions.go is up's "five decisions about an unknown word"
// (docs/en/threads/part-1/2-vocabulary.md §3; structure only, wording written
// fresh) and the production card (§6 and §8), plans/260930-0915-up-methods
// phase 3.
//
// Not every unknown word deserves review. Each saved term carries one of five
// decisions and that decision's minimum record, and only "learn" owns review
// cards. What is decided here and not by the client: a decision is one of the
// five, its record has exactly its own fields, each filled, and a confidence
// is low, medium or high.

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/D0bby999/anytools/internal/learning"
)

// The five decisions, in up's order.
const (
	DecisionSkip   = "skip"
	DecisionInfer  = "infer"
	DecisionLookup = "lookup"
	DecisionLearn  = "learn"
	DecisionVerify = "verify"
)

// Decisions returns the five decisions in up's order.
func Decisions() []string {
	return []string{DecisionSkip, DecisionInfer, DecisionLookup, DecisionLearn, DecisionVerify}
}

// KindProduction is the production card: a situational cue → the expression,
// typed. It is not in CardKinds(), so no note is given one on save; only the
// learner's "Practise using it" creates it.
const KindProduction = "production"

// recordFields are each decision's minimum record (chapter §3's last column),
// in up's order:
//
//   - skip: why it can wait;
//   - infer: the candidate sense and the confidence in it;
//   - lookup: the source of the current sense (the sense itself is the note's
//     meaning, required for a lookup);
//   - learn: sound, collocation and the retrieval cue (the retest is the
//     cards' schedule);
//   - verify: the primary definition, its scope and the accountable owner.
var recordFields = map[string][]string{
	DecisionSkip:   {"why"},
	DecisionInfer:  {"sense", "confidence"},
	DecisionLookup: {"source"},
	DecisionLearn:  {"sound", "collocation", "cue"},
	DecisionVerify: {"definition", "scope", "owner"},
}

// RecordFields returns a decision's record fields in up's order, or nil for
// an unknown decision.
func RecordFields(decision string) []string {
	return append([]string(nil), recordFields[decision]...)
}

// Confidences are an inference's confidence levels.
func Confidences() []string { return []string{"low", "medium", "high"} }

// TaskImpacts are up's task impact options (the vocabulary card's §3 queue).
func TaskImpacts() []string { return []string{"blocking", "important", "minor", "none"} }

// Limits of the decision fields, matching the migration's CHECKs where one
// exists.
const (
	MaxRecordLen     = 300
	MaxScenarioLen   = 300
	MaxConfusableLen = 200
)

// ValidDecision reports whether d is one of the five.
func ValidDecision(d string) bool {
	_, ok := recordFields[d]
	return ok
}

// NeedsMeaning reports whether a decision needs the note's meaning: a word to
// learn, and a quick lookup, whose meaning is the current sense.
func NeedsMeaning(decision string) bool {
	return decision == DecisionLearn || decision == DecisionLookup
}

// HasCards reports whether a decision owns review cards. Only "learn" does.
func HasCards(decision string) bool { return decision == DecisionLearn }

// CheckRecord returns a decision's record trimmed, or ErrInvalid naming what
// is wrong: an unknown decision, a field the decision does not have, a
// missing or over-long field, or a confidence that is not low, medium or
// high.
func CheckRecord(decision string, rec map[string]string) (map[string]string, error) {
	fields, ok := recordFields[decision]
	if !ok {
		return nil, fmt.Errorf("%w: the decision is skip, infer, lookup, learn or verify", ErrInvalid)
	}
	allowed := map[string]bool{}
	for _, f := range fields {
		allowed[f] = true
	}
	for k := range rec {
		if !allowed[k] {
			return nil, fmt.Errorf("%w: %q is not part of a %s record", ErrInvalid, k, decision)
		}
	}
	out := make(map[string]string, len(fields))
	for _, f := range fields {
		v := strings.TrimSpace(strings.ReplaceAll(rec[f], "\x00", ""))
		switch {
		case v == "":
			return nil, fmt.Errorf("%w: a %s decision needs its %s", ErrInvalid, decision, f)
		case utf8.RuneCountInString(v) > MaxRecordLen:
			return nil, fmt.Errorf("%w: the %s is over %d characters", ErrInvalid, f, MaxRecordLen)
		case f == "confidence" && !oneOf(v, Confidences()):
			return nil, fmt.Errorf("%w: the confidence is low, medium or high", ErrInvalid)
		}
		out[f] = v
	}
	return out, nil
}

// CheckTaskImpact accepts one of up's four task impacts, or "" for not said.
func CheckTaskImpact(v string) (string, error) {
	v = strings.TrimSpace(v)
	if v != "" && !oneOf(v, TaskImpacts()) {
		return "", fmt.Errorf("%w: the task impact is blocking, important, minor or none", ErrInvalid)
	}
	return v, nil
}

func oneOf(v string, set []string) bool {
	for _, s := range set {
		if v == s {
			return true
		}
	}
	return false
}

// ─────────────────────────────────────────────── five to eight per cycle

// Week notices (chapter §3: select only five to eight chunks for deliberate
// learning in one cycle). Neither blocks a save: up says "select only", not
// "refuse".
const (
	// NoticeSelect is the sixth to eighth "learn" of the week: the guidance.
	NoticeSelect = "select"
	// NoticeOver is the ninth and later: the stronger notice.
	NoticeOver = "over"
)

// Week is how many words the learner chose to learn in their current week.
type Week struct {
	Learning int    `json:"learning"`
	Notice   string `json:"notice,omitempty"`
}

// WeekNotice is the notice for n "learn" choices in a week.
func WeekNotice(n int) string {
	switch {
	case n >= 9:
		return NoticeOver
	case n >= 6:
		return NoticeSelect
	}
	return ""
}

// WeekStart is the instant the learner's week (Monday to Sunday, local days)
// that contains now began.
func WeekStart(now time.Time, zone string) time.Time {
	d := learning.LocalDay(now, zone)
	day := time.Date(d.Year, d.Month, d.Day, 0, 0, 0, 0, time.UTC)
	monday := day.AddDate(0, 0, -((int(day.Weekday()) + 6) % 7))
	return learning.StartOf(learning.Day{Year: monday.Year(), Month: monday.Month(), Day: monday.Day()}, zone)
}
