package learning

import (
	"sort"
	"time"

	"github.com/google/uuid"
)

// priority.go decides what a mastery session asks next.
//
// The rule from phase-07 is two words long — "due reviews first, then weakest
// module" — and everything below is the tie-breaking that makes those two words
// produce the SAME answer twice in a row. Without deterministic tie-breaks the
// session would serve a different question each time a page was refreshed, and
// a learner cannot tell that apart from the system losing their place.
//
// It is a pure function over rows the store already read, rather than an ORDER
// BY, for one reason: "weakest module" is an aggregate over the module's
// knowledge points, and expressing "due first, else weakest-module-first" in
// one indexable statement produces SQL that nobody can change safely later. The
// store fetches the small candidate set; the policy lives here where it can be
// table-tested.

// Knowledge-point types, exactly as `knowledge_points.type` CHECKs them.
const (
	TypeMemory    = "memory"
	TypeConcept   = "concept"
	TypeProcedure = "procedure"
	TypeDesign    = "design"
)

// ValidKnowledgeType reports whether t is a type the database accepts.
func ValidKnowledgeType(t string) bool {
	switch t {
	case TypeMemory, TypeConcept, TypeProcedure, TypeDesign:
		return true
	}
	return false
}

// TypePriority ranks knowledge types when several are due at the same instant.
// Lower is more urgent.
//
// The numbers are DeepTutor's (scheduler.py:20 — MEMORY 2 … DESIGN 5) and the
// ordering they encode is the defensible part: a forgotten FACT is gone the
// moment it is not recalled, while design judgement degrades slowly and is
// rebuilt by use. An unknown type sorts last rather than first — a row whose
// type nobody recognised should not jump the queue.
func TypePriority(t string) int {
	switch t {
	case TypeMemory:
		return 2
	case TypeConcept:
		return 3
	case TypeProcedure:
		return 4
	case TypeDesign:
		return 5
	}
	return 9
}

// Candidate is one knowledge point the session could serve, with the numbers
// the ordering needs. ModuleMastery is the mean estimate across the module's
// active points — the store computes it once per module, not per row.
type Candidate struct {
	KPID            uuid.UUID `json:"kp_id"`
	KPName          string    `json:"kp_name"`
	Type            string    `json:"type"`
	ModuleID        uuid.UUID `json:"module_id"`
	ModuleName      string    `json:"module_name"`
	ModuleOrd       int       `json:"module_ord"`
	ModuleMastery   float64   `json:"module_mastery"`
	MasteryEstimate float64   `json:"mastery_estimate"`
	DueAt           time.Time `json:"due_at"`
}

// IsDue reports whether this candidate is a review that has come round.
//
// The comparison is `!After`, so a card due at exactly `now` counts as due. The
// alternative loses the card for one whole polling interval, and the case is
// not hypothetical: FSRS's relearning step lands a failed card at a round
// number of minutes from the attempt, which is precisely when a client that
// reloaded on a timer asks.
func (c Candidate) IsDue(now time.Time) bool { return !c.DueAt.After(now) }

// Rank orders candidates into the sequence a session serves them in.
//
// Due reviews come first, oldest due date first: a card that has been waiting
// two days is more at risk than one that came due a minute ago. Nothing due
// means the session is teaching rather than reviewing, and then the weakest
// module leads — a learner who is 30% through module two and 90% through module
// one should be asked about module two.
//
// Rank does not mutate its argument.
func Rank(candidates []Candidate, now time.Time) []Candidate {
	out := make([]Candidate, len(candidates))
	copy(out, candidates)

	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]

		dueA, dueB := a.IsDue(now), b.IsDue(now)
		if dueA != dueB {
			return dueA
		}

		if dueA {
			// Both due: oldest first, then the type that decays fastest.
			if !a.DueAt.Equal(b.DueAt) {
				return a.DueAt.Before(b.DueAt)
			}
			if pa, pb := TypePriority(a.Type), TypePriority(b.Type); pa != pb {
				return pa < pb
			}
			return a.KPID.String() < b.KPID.String()
		}

		// Neither due: weakest module, then earliest module in the path, then
		// the weakest point inside it.
		if a.ModuleMastery != b.ModuleMastery {
			return a.ModuleMastery < b.ModuleMastery
		}
		if a.ModuleOrd != b.ModuleOrd {
			return a.ModuleOrd < b.ModuleOrd
		}
		if a.MasteryEstimate != b.MasteryEstimate {
			return a.MasteryEstimate < b.MasteryEstimate
		}
		if !a.DueAt.Equal(b.DueAt) {
			return a.DueAt.Before(b.DueAt)
		}
		return a.KPID.String() < b.KPID.String()
	})
	return out
}

// Select returns the single next candidate, or false when there is nothing to
// ask. It is Rank's first element, named so that callers read as the product
// reads: "what is next".
func Select(candidates []Candidate, now time.Time) (Candidate, bool) {
	if len(candidates) == 0 {
		return Candidate{}, false
	}
	return Rank(candidates, now)[0], true
}

// ModuleMastery is the mean estimate over a module's active knowledge points.
//
// A module with no active points returns 0, not 1. "Nothing left to measure"
// and "everything measured and known" are different states, and returning 1
// for the first would graduate an empty module — which is exactly what an
// approved-but-not-yet-diagnosed path looks like on its first day.
func ModuleMastery(estimates []float64) float64 {
	if len(estimates) == 0 {
		return 0
	}
	total := 0.0
	for _, e := range estimates {
		total += e
	}
	return total / float64(len(estimates))
}

// Graduated reports whether a module has met its bar: mastery at or above the
// threshold AND nothing in it currently due.
//
// Both halves are required, and the second is the one that is easy to drop. A
// module can average 0.8 while one knowledge point sits overdue and failing;
// graduating it there would retire the card that is actively being forgotten,
// which is the opposite of what the average was measuring.
func Graduated(mastery, threshold float64, dueCount int) bool {
	if dueCount > 0 {
		return false
	}
	if threshold <= 0 {
		threshold = 0.7
	}
	return mastery >= threshold
}
