package body

import (
	"math"
	"slices"
)

// progression.go — the next target for an exercise, derived from the log.
//
// Nothing here writes back into a finished workout. The log is what
// happened; the next prescription is computed from it every time, so fixing
// a mistyped set or changing a policy gives the right next target at once,
// with no stored counter to drift.
//
// A session is read honestly: a set ticked with at least its target is a
// hit; a set ticked with fewer, a set never ticked, or fewer sets than
// planned is a miss. A session that fell apart never advances the load.

// deloadAfter is how many missed sessions in a row trigger a deload.
const deloadAfter = 3

const deloadFactor = 0.9

// DefaultSecIncrement is the step for a timed hold.
const DefaultSecIncrement = 5

// heavyParts take the bigger load step: a 5 kg jump is normal for a squat or
// a deadlift (both "upper legs" in the library) and brutal for a curl or a
// row. Rows and pull-downs ("back") take the upper body's 2.5 kg.
var heavyParts = []string{"upper legs", "lower legs"}

// PoliciesFor lists the policies that can drive a mode.
func PoliciesFor(mode string) []string {
	switch mode {
	case ModeReps:
		return []string{PolicyOff, PolicyLinear, PolicyDouble}
	case ModeTime:
		return []string{PolicyOff, PolicyTime}
	}
	return []string{PolicyOff}
}

// PolicyFor is the policy in force: the exercise's own, else the routine's,
// else the mode's default — when the mode allows it.
func PolicyFor(ex PlanExercise, routineProg string) string {
	pick := ex.Prog
	if pick == "" {
		pick = routineProg
	}
	if pick == "" {
		switch ex.Mode {
		case ModeReps:
			pick = PolicyLinear
		case ModeTime:
			pick = PolicyTime
		}
	}
	if slices.Contains(PoliciesFor(ex.Mode), pick) {
		return pick
	}
	return PolicyOff
}

// DefaultIncrement is the load step for an exercise in a unit.
func DefaultIncrement(exercise, unit string) float64 {
	e, _ := Lookup(exercise)
	heavy := slices.Contains(heavyParts, e.BodyPart)
	switch {
	case unit == UnitLb && heavy:
		return 10
	case unit == UnitLb:
		return 5
	case heavy:
		return 5
	}
	return 2.5
}

// Prescription is the next target and why. Reason is a code the browser
// turns into a sentence; Step, Stalls and Left are its numbers.
type Prescription struct {
	Policy string   `json:"policy"`
	Kind   string   `json:"kind"` // first | up | hold | deload | off
	Reason string   `json:"reason,omitempty"`
	Weight *float64 `json:"weight,omitempty"`
	Reps   *int     `json:"reps,omitempty"`
	Sec    *int     `json:"sec,omitempty"`
	Step   float64  `json:"step,omitempty"`
	Stalls int      `json:"stalls,omitempty"`
	Left   int      `json:"left,omitempty"`
}

// Session is one past entry, reduced to what a policy judges.
type Session struct {
	Day    string
	Mode   string
	Goal   int
	Weight float64
	Low    int
	OK     bool
}

// ReadSession judges one logged entry against its own target.
func ReadSession(e Entry) Session {
	t := e.Target
	planned := t.Sets
	if planned == 0 {
		planned = len(e.Sets)
	}
	enough := len(e.Sets) >= planned && len(e.Sets) > 0
	s := Session{Mode: t.Mode}
	low := math.MaxInt
	for _, set := range e.Sets {
		got := 0
		if set.Done {
			s.Weight = max(s.Weight, set.Weight)
			got = set.Reps
			if t.Mode == ModeTime {
				got = set.Sec
			}
		}
		low = min(low, got)
	}
	if low == math.MaxInt {
		low = 0
	}
	s.Low = low
	s.Goal = t.Reps
	if t.Mode == ModeTime {
		s.Goal = t.Sec
	}
	s.OK = s.Goal > 0 && enough && low >= s.Goal
	return s
}

// Performed reports whether any set of the entry was done.
func (e Entry) Performed() bool {
	for _, s := range e.Sets {
		if s.Done {
			return true
		}
	}
	return false
}

// SessionsOf reads an exercise's past entries, oldest first, keeping the ones
// performed in the given mode.
func SessionsOf(history []Workout, exercise, mode string) []Session {
	var out []Session
	for _, w := range history {
		for _, e := range w.Entries {
			if e.Exercise != exercise || e.Target.Mode != mode || !e.Performed() {
				continue
			}
			s := ReadSession(e)
			s.Day = w.Day
			out = append(out, s)
		}
	}
	return out
}

// StallCount is how many sessions in a row, counting back from the latest,
// missed their target.
func StallCount(sessions []Session) int {
	n := 0
	for i := len(sessions) - 1; i >= 0 && !sessions[i].OK; i-- {
		n++
	}
	return n
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

// snap lands on a loadable multiple of the step.
func snap(v, step float64) float64 {
	if step <= 0 {
		return round1(v)
	}
	return round1(math.Round(v/step) * step)
}

// deloadTo backs off by deloadFactor onto something loadable. On a small
// weight the nearest step can be the weight itself, so a deload that took
// nothing off takes one step instead; never below one step.
func deloadTo(cur, step float64) float64 {
	next := snap(cur*deloadFactor, step)
	if next >= cur {
		next = snap(cur-step, step)
	}
	return max(step, next)
}

func ptr[T any](v T) *T { return &v }

// Next is the prescription for an exercise's next session, from its past
// sessions (oldest first, all in the exercise's mode).
func Next(ex PlanExercise, routineProg string, sessions []Session, unit string) Prescription {
	policy := PolicyFor(ex, routineProg)
	if policy == PolicyOff {
		return Prescription{Policy: policy, Kind: "off"}
	}
	inc := ex.Inc
	if inc <= 0 {
		if ex.Mode == ModeTime {
			inc = DefaultSecIncrement
		} else {
			inc = DefaultIncrement(ex.Exercise, unit)
		}
	}
	if len(sessions) == 0 {
		return Prescription{Policy: policy, Kind: "first", Reason: "first"}
	}
	last := sessions[len(sessions)-1]
	stalls := StallCount(sessions)

	if ex.Mode == ModeTime {
		goal := last.Goal
		if goal == 0 {
			goal = ex.Sec
		}
		switch {
		case last.OK:
			return Prescription{Policy: policy, Kind: "up", Reason: "time_up", Sec: ptr(goal + int(inc)), Step: inc}
		case stalls >= deloadAfter:
			return Prescription{Policy: policy, Kind: "deload", Reason: "time_deload",
				Sec: ptr(int(deloadTo(float64(goal), DefaultSecIncrement))), Stalls: stalls}
		}
		return Prescription{Policy: policy, Kind: "hold", Reason: "time_hold", Sec: ptr(goal)}
	}

	w := last.Weight
	// No external load: there is nothing to add or take away, so progress
	// in reps. True for every policy, so it comes first.
	if w <= 0 {
		goal := last.Goal
		if goal == 0 {
			goal = ex.Reps
		}
		if last.OK && goal > 0 {
			return Prescription{Policy: policy, Kind: "up", Reason: "bodyweight_up", Weight: ptr(0.0), Reps: ptr(goal + 1)}
		}
		p := Prescription{Policy: policy, Kind: "hold", Reason: "bodyweight_hold", Weight: ptr(0.0)}
		if goal > 0 {
			p.Reps = ptr(goal)
		}
		return p
	}

	if policy == PolicyDouble {
		top := ex.Reps
		if top == 0 {
			top = max(last.Goal, 10)
		}
		bottom := ex.RepsMin
		if bottom == 0 {
			bottom = max(1, top-2)
		}
		bottom = min(bottom, top)
		switch {
		case last.OK:
			return Prescription{Policy: policy, Kind: "up", Reason: "range_up", Weight: ptr(snap(w+inc, inc)), Reps: ptr(bottom), Step: inc}
		case stalls >= deloadAfter:
			return Prescription{Policy: policy, Kind: "deload", Reason: "range_deload", Weight: ptr(deloadTo(w, inc)), Reps: ptr(bottom), Stalls: stalls}
		}
		aim := min(top, max(bottom, last.Low+1))
		return Prescription{Policy: policy, Kind: "hold", Reason: "range_hold", Weight: ptr(w), Reps: ptr(aim)}
	}

	switch {
	case last.OK:
		return Prescription{Policy: policy, Kind: "up", Reason: "up", Weight: ptr(snap(w+inc, inc)), Step: inc}
	case stalls >= deloadAfter:
		return Prescription{Policy: policy, Kind: "deload", Reason: "deload", Weight: ptr(deloadTo(w, inc)), Stalls: stalls}
	}
	return Prescription{Policy: policy, Kind: "hold", Reason: "hold", Weight: ptr(w), Left: deloadAfter - stalls}
}

// BuildSets lays out an entry's sets from its target with the prescription
// applied: only what the policy decided changes.
func BuildSets(t PlanExercise, p Prescription) []Set {
	n := max(1, t.Sets)
	sets := make([]Set, n)
	for i := range sets {
		s := Set{Weight: t.Weight, Reps: t.Reps, Sec: t.Sec, Min: t.Min, Speed: t.Speed}
		if p.Weight != nil {
			s.Weight = *p.Weight
		}
		if p.Reps != nil {
			s.Reps = *p.Reps
		}
		if p.Sec != nil {
			s.Sec = *p.Sec
		}
		sets[i] = s
	}
	return sets
}

// Applied is the target with the prescription folded in, so the entry is
// later judged against what was actually asked for.
func Applied(t PlanExercise, p Prescription) PlanExercise {
	if p.Weight != nil {
		t.Weight = *p.Weight
	}
	if p.Reps != nil {
		t.Reps = *p.Reps
	}
	if p.Sec != nil {
		t.Sec = *p.Sec
	}
	return t
}
