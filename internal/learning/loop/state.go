// Package loop is the learning loop: a learning state per goal, a 90-day cycle
// with three evidence-gated phases, weekly reviews scored 0–2, evidence chains
// with four timepoints, and the AI task brief / AI learning log pair.
//
// The method's STRUCTURE comes from byoungd/up; none of its wording does. That
// material is CC BY-NC, so every string in this package — including the ones a
// user reads — is written for this product.
//
// The rule the whole package is built around: a gate opens on evidence, and
// evidence is a pointer to something the product already recorded (an attempt,
// a card, a note, a message), never a sentence typed into a box. The person
// still decides what counts — suggestions are accepted or dismissed by hand —
// but what they accept is a thing that happened.
package loop

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// ErrNotFound is the single answer to "no such row for this user". It is
// returned identically for a row that does not exist and a row that belongs to
// someone else, so no endpoint is an existence oracle.
var ErrNotFound = errors.New("loop: not found")

// ErrInvalid marks a caller mistake the API answers with 400.
var ErrInvalid = errors.New("loop: invalid")

// ErrConflict marks a request that lost a race or repeats a one-shot action:
// advancing a cycle that already moved, a second review for the same week.
var ErrConflict = errors.New("loop: conflict")

// NotReadyError is a refusal with reasons: a gate that is shut, a review that
// cannot be written back yet. The API answers 409 with the list, because the
// request was well-formed and the state of the world is what said no.
type NotReadyError struct {
	Problems []string
	// Gate is set when a cycle gate is what refused.
	Gate *GateResult
}

func (e *NotReadyError) Error() string {
	return "loop: not ready: " + strings.Join(e.Problems, " ")
}

// Field limits, repeated from the migration's CHECKs so the person gets a
// sentence rather than a constraint violation.
const (
	MaxGoalLen     = 500
	MaxTextLen     = 2000
	MaxTaskLen     = 1000
	MaxHandoverLen = 20000
	maxListItems   = 50
	// MaxContractLen bounds each answer of the minimum contract, and each line
	// of an interruption record, in characters.
	MaxContractLen = 1000
)

// Hypothesis sources.
const (
	HypothesisFromError  = "error"
	HypothesisFromChange = "change"
	HypothesisFromUser   = "user"
)

// LearningState is one goal and what anyone picking it up would need.
type LearningState struct {
	ID               uuid.UUID    `json:"id"`
	UserID           uuid.UUID    `json:"-"`
	Goal             string       `json:"goal"`
	RealScenario     string       `json:"real_scenario"`
	Outcome12w       string       `json:"outcome_12w"`
	AIBoundaries     AIBoundaries `json:"ai_boundaries"`
	Baselines        []Baseline   `json:"baselines"`
	ValidatedMethods []Method     `json:"validated_methods"`
	Hypotheses       []Hypothesis `json:"hypotheses"`
	HandoverMD       string       `json:"handover_md"`
	NextTask         string       `json:"next_task"`
	NextTaskMinimum  string       `json:"next_task_minimum"`
	// MinimumContract is written before a bad day, for the bad day.
	MinimumContract MinimumContract `json:"minimum_contract"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

// MinimumContract is the bad-day contract: three answers written while the
// day is good, so the bad day does not have to decide anything.
//
// Structure: up, docs/en/threads/part-4/rhythm-and-compounding.md §6 "A
// Minimum Contract for Bad Days" — its three questions, in its order. The
// concrete minimum task is still LearningState.NextTaskMinimum; the second
// answer says why that minimum is worth keeping, or what else is.
//
// AskForHelpWhen is private (plan principle 5): it can hold health and safety
// triggers, so RenderState — sent with every turn of a state-linked chat —
// never reads it. Nothing else that reaches a model does either.
type MinimumContract struct {
	DownshiftWhen     string `json:"downshift_when"`
	StillWorthKeeping string `json:"still_worth_keeping"`
	AskForHelpWhen    string `json:"ask_for_help_when"`
}

// Validate checks each answer's length. All three may be empty: a contract is
// written when the learner is ready to write it.
func (c MinimumContract) Validate() error {
	for name, v := range map[string]string{
		"answer on when to downshift":           c.DownshiftWhen,
		"answer on what is still worth keeping": c.StillWorthKeeping,
		"answer on when to ask for help":        c.AskForHelpWhen,
	} {
		if utf8.RuneCountInString(v) > MaxContractLen {
			return fmt.Errorf("%w: the %s is too long", ErrInvalid, name)
		}
	}
	return nil
}

// trimmed returns the contract with each answer trimmed.
func (c MinimumContract) trimmed() MinimumContract {
	return MinimumContract{
		DownshiftWhen:     strings.TrimSpace(c.DownshiftWhen),
		StillWorthKeeping: strings.TrimSpace(c.StillWorthKeeping),
		AskForHelpWhen:    strings.TrimSpace(c.AskForHelpWhen),
	}
}

// AIBoundaries says what a model may do on this goal and what a human must
// confirm. It is guidance written for the model in a resumed chat and for the
// person themselves; nothing enforces it, and the UI does not claim otherwise.
type AIBoundaries struct {
	AIMay            []string `json:"ai_may"`
	HumanMustConfirm []string `json:"human_must_confirm"`
}

// Baseline describes a starting measurement in words. It does not open a gate;
// an accepted evidence ref tagged `baseline` does.
type Baseline struct {
	What    string `json:"what"`
	Measure string `json:"measure"`
	At      string `json:"at"`
}

// Method is a way of working that evidence has supported.
type Method struct {
	Method   string `json:"method"`
	Evidence string `json:"evidence"`
}

// Hypothesis is something suspected and not yet shown, with the test that
// would show it and the point at which to give up on it.
type Hypothesis struct {
	Claim         string `json:"claim"`
	Evidence      string `json:"evidence,omitempty"`
	NextTest      string `json:"next_test,omitempty"`
	StopCondition string `json:"stop_condition,omitempty"`
	Confidence    string `json:"confidence,omitempty"`
	Week          int    `json:"week,omitempty"`
	Source        string `json:"source"`
}

// StateSummary is a state as the Loop home lists it.
type StateSummary struct {
	LearningState
	CycleID    *uuid.UUID `json:"cycle_id"`
	Phase      string     `json:"phase"`
	CycleStart *time.Time `json:"cycle_started_at"`
}

// MinimalStart is the four-field start: enough to begin, nothing more. A long
// onboarding form is where a plan goes to die before its first week.
type MinimalStart struct {
	Goal         string `json:"goal"`
	RealScenario string `json:"real_scenario"`
	Outcome12w   string `json:"outcome_12w"`
	FirstTask    string `json:"first_task"`
}

// Validate checks a start request.
func (m MinimalStart) Validate() error {
	if err := requireText("goal", m.Goal, MaxGoalLen); err != nil {
		return err
	}
	if err := requireText("real scenario", m.RealScenario, MaxTextLen); err != nil {
		return err
	}
	if err := requireText("12-week outcome", m.Outcome12w, MaxTextLen); err != nil {
		return err
	}
	return requireText("first small task", m.FirstTask, MaxTaskLen)
}

// StatePatch carries the fields a state update may change. A nil field means
// "leave it alone". HandoverMD is here because the person may always edit
// their own handover; a model's paste-back reaches it only through
// AcceptHandover, which validates it first.
type StatePatch struct {
	Goal             *string       `json:"goal"`
	RealScenario     *string       `json:"real_scenario"`
	Outcome12w       *string       `json:"outcome_12w"`
	AIBoundaries     *AIBoundaries `json:"ai_boundaries"`
	Baselines        *[]Baseline   `json:"baselines"`
	ValidatedMethods *[]Method     `json:"validated_methods"`
	Hypotheses       *[]Hypothesis `json:"hypotheses"`
	HandoverMD       *string       `json:"handover_md"`
	NextTask         *string       `json:"next_task"`
	NextTaskMinimum  *string       `json:"next_task_minimum"`
	// MinimumContract replaces all three answers at once.
	MinimumContract *MinimumContract `json:"minimum_contract"`
}

// Validate checks a patch.
func (p StatePatch) Validate() error {
	if p.Goal != nil {
		if err := requireText("goal", *p.Goal, MaxGoalLen); err != nil {
			return err
		}
	}
	for name, v := range map[string]*string{
		"real scenario": p.RealScenario, "12-week outcome": p.Outcome12w,
	} {
		if v != nil && len(*v) > MaxTextLen {
			return fmt.Errorf("%w: the %s is too long", ErrInvalid, name)
		}
	}
	for name, v := range map[string]*string{"next task": p.NextTask, "minimum task": p.NextTaskMinimum} {
		if v != nil && len(*v) > MaxTaskLen {
			return fmt.Errorf("%w: the %s is too long", ErrInvalid, name)
		}
	}
	if p.HandoverMD != nil && len(*p.HandoverMD) > MaxHandoverLen {
		return fmt.Errorf("%w: the handover note is too long", ErrInvalid)
	}
	if p.AIBoundaries != nil &&
		(len(p.AIBoundaries.AIMay) > maxListItems || len(p.AIBoundaries.HumanMustConfirm) > maxListItems) {
		return fmt.Errorf("%w: too many AI boundary entries", ErrInvalid)
	}
	if (p.Baselines != nil && len(*p.Baselines) > maxListItems) ||
		(p.ValidatedMethods != nil && len(*p.ValidatedMethods) > maxListItems) ||
		(p.Hypotheses != nil && len(*p.Hypotheses) > 4*maxListItems) {
		return fmt.Errorf("%w: too many entries", ErrInvalid)
	}
	if p.MinimumContract != nil {
		return p.MinimumContract.Validate()
	}
	return nil
}

// Main resistances an interruption can name. The list is up's, in up's order:
// docs/en/templates/90-day-cycle.md §6 "Interruption and recovery".
const (
	ResistanceTime           = "time"
	ResistanceDifficulty     = "difficulty"
	ResistanceEnergy         = "energy"
	ResistanceEnvironment    = "environment"
	ResistanceResponsibility = "responsibility"
)

// Resistances lists the resistances in up's order.
var Resistances = []string{
	ResistanceTime, ResistanceDifficulty, ResistanceEnergy, ResistanceEnvironment, ResistanceResponsibility,
}

// RepeatAfter is how many interruptions in a row with the same resistance
// stop being bad luck. up: "when the same barrier appears three times".
const RepeatAfter = 3

// Interruption is one "I got interrupted", logged on the current cycle.
//
// Its lines are up's interruption record, docs/en/templates/90-day-cycle.md §6:
// the fact, the main resistance, what the task was reduced to, the smallest
// output within 24 hours, the work that will not be repaid, and a review date.
// "Task reduced to" is ReducedTo, a copy of the minimum the protocol swapped
// in — the same value, recorded so the entry still reads after the state's
// minimum changes; there is no separate input for it.
//
// Entries written before these lines existed carry only Note (and PriorTask);
// Note is shown as their fact.
type Interruption struct {
	At          time.Time `json:"at"`
	Fact        string    `json:"fact,omitempty"`
	Note        string    `json:"note,omitempty"`
	Resistance  string    `json:"resistance,omitempty"`
	ReducedTo   string    `json:"reduced_to,omitempty"`
	Within24h   string    `json:"within_24h,omitempty"`
	NotRepaying string    `json:"not_repaying,omitempty"`
	// ReviewOn is a date on the learner's own calendar, YYYY-MM-DD.
	ReviewOn  string `json:"review_on,omitempty"`
	PriorTask string `json:"prior_task"`
}

// InterruptRequest is the input for the interruption protocol.
type InterruptRequest struct {
	// Fact is what happened, as facts and without judging anyone's character.
	Fact string `json:"fact"`
	// Resistance is one of Resistances, or empty.
	Resistance string `json:"resistance"`
	// Minimum is "task reduced to". When given, it sets the minimum version
	// first. It is required when the state has none: shrinking a task to a
	// minimum nobody wrote down is just dropping it.
	Minimum string `json:"minimum"`
	// Within24h is the smallest output possible within 24 hours.
	Within24h string `json:"within_24h"`
	// NotRepaying is the missed work deliberately left unrepaid.
	NotRepaying string `json:"not_repaying"`
	// ReviewOn is the date to look at this again, YYYY-MM-DD, or empty.
	ReviewOn string `json:"review_on"`
}

// PlanInterruption applies the interruption protocol to a state: the next task
// becomes its minimum version, and the interruption is logged with what the
// task was, so it can be restored.
//
// It shrinks the plan rather than abandoning it. That is the whole protocol.
func PlanInterruption(st LearningState, req InterruptRequest, now time.Time) (nextTask, minimum string, entry Interruption, err error) {
	invalid := func(msg string) (string, string, Interruption, error) {
		return "", "", Interruption{}, fmt.Errorf("%w: %s", ErrInvalid, msg)
	}
	fact := strings.TrimSpace(req.Fact)
	within := strings.TrimSpace(req.Within24h)
	notRepaying := strings.TrimSpace(req.NotRepaying)
	reviewOn := strings.TrimSpace(req.ReviewOn)
	switch {
	case fact == "":
		return invalid("write what happened, as plain facts")
	case within == "":
		return invalid("write the smallest output you can still make within 24 hours")
	}
	for name, v := range map[string]string{
		"fact": fact, "24-hour output": within, "work you will not repay": notRepaying,
	} {
		if utf8.RuneCountInString(v) > MaxContractLen {
			return invalid("the " + name + " is too long")
		}
	}
	if req.Resistance != "" && !slices.Contains(Resistances, req.Resistance) {
		return invalid("unknown resistance")
	}
	if reviewOn != "" {
		if _, err := time.Parse(time.DateOnly, reviewOn); err != nil {
			return invalid("the review date must be a date (YYYY-MM-DD)")
		}
	}

	minimum = strings.TrimSpace(req.Minimum)
	if minimum == "" {
		minimum = strings.TrimSpace(st.NextTaskMinimum)
	}
	if minimum == "" {
		return invalid("write the smallest version of your next task first, so there is something to shrink to")
	}
	if len(minimum) > MaxTaskLen {
		return invalid("the minimum task is too long")
	}
	return minimum, minimum, Interruption{
		At: now.UTC(), Fact: fact, Resistance: req.Resistance, ReducedTo: minimum,
		Within24h: within, NotRepaying: notRepaying, ReviewOn: reviewOn, PriorTask: st.NextTask,
	}, nil
}

// RepeatedResistance returns the resistance named by each of the RepeatAfter
// most recent interruptions, or "" when they differ, one names none, or there
// are fewer of them. recent is ordered most recent first.
//
// up's advice for that case is to change the conditions rather than push
// harder; the state page shows it when this is non-empty.
func RepeatedResistance(recent []Interruption) string {
	if len(recent) < RepeatAfter {
		return ""
	}
	first := recent[0].Resistance
	if first == "" {
		return ""
	}
	for _, it := range recent[1:RepeatAfter] {
		if it.Resistance != first {
			return ""
		}
	}
	return first
}

// Revision is a short fingerprint of a state's current version.
//
// A resumed chat is told it, and a paste-back must echo it. That is how "the
// model did not invent this" becomes checkable: a paste-back written against a
// state that has since changed — or against no state at all — carries a
// revision that does not match, and is refused.
func Revision(st LearningState) string {
	sum := sha256.Sum256([]byte(st.ID.String() + "|" + st.UpdatedAt.UTC().Format(time.RFC3339Nano)))
	return hex.EncodeToString(sum[:])[:12]
}

func requireText(name, v string, max int) error {
	if strings.TrimSpace(v) == "" {
		return fmt.Errorf("%w: the %s is required", ErrInvalid, name)
	}
	if len(v) > max {
		return fmt.Errorf("%w: the %s is too long", ErrInvalid, name)
	}
	return nil
}
