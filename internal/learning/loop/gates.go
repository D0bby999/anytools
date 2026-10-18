package loop

import (
	"fmt"

	"github.com/google/uuid"
)

// gates.go decides whether a cycle may move to its next phase.
//
// It is pure — no database, no clock — for the reason the rules exist at all:
// a gate is a claim about evidence, and a claim that depends on hidden state
// cannot be checked by the person it is gating. The store gathers the inputs
// (accepted evidence refs in the cycle's scope, and the count of reviews that
// were written back) and this file does nothing but read them.
//
// Every result carries CannotProve, including an open gate. Passing a gate
// says the minimum was recorded; it does not say the method works, and the UI
// is required to say so next to every metric (the vitest guard in
// ui/web/app/test/loop-cannot-prove.test.ts).

// Phases of a cycle, in order.
const (
	PhaseCalibrate = "calibrate"
	PhaseStack     = "stack"
	PhaseDeliver   = "deliver"
)

// Phases returns the three, in order.
func Phases() []string { return []string{PhaseCalibrate, PhaseStack, PhaseDeliver} }

// NextPhase returns the phase after p, or "" when p is the last (or unknown).
func NextPhase(p string) string {
	switch p {
	case PhaseCalibrate:
		return PhaseStack
	case PhaseStack:
		return PhaseDeliver
	}
	return ""
}

// Gate thresholds.
const (
	// CalibrateBaselines is how many accepted baseline refs leave calibrate.
	CalibrateBaselines = 1
	// CalibrateReviews is how many written-back weekly reviews leave calibrate.
	CalibrateReviews = 2
	// StackDelayed and StackTransfer are what leave stack.
	StackDelayed  = 1
	StackTransfer = 1
)

// GateRef is the part of an evidence ref a gate reads.
type GateRef struct {
	ID        uuid.UUID
	Kind      string
	Timepoint string
	Status    string
}

// GateInput is everything a gate decision is allowed to see.
type GateInput struct {
	Phase string
	// Refs are the evidence refs in the cycle's scope: those on its weekly
	// reviews and those on its state's evidence chains. Non-accepted refs may be
	// passed; they are ignored here rather than trusted to have been filtered.
	Refs []GateRef
	// WrittenBackReviews counts the cycle's weekly reviews whose writeback is
	// done. Writeback itself requires accepted evidence (weekly.go), so this
	// count is evidence-backed too.
	WrittenBackReviews int
}

// GateResult is the decision, with its reasons.
type GateResult struct {
	From string `json:"from"`
	// To is "" when From is the last phase.
	To   string `json:"to"`
	Open bool   `json:"open"`
	// Final is true when there is no next phase to open.
	Final bool `json:"final"`
	// Missing lists, in plain words, what is still needed. Empty when Open.
	Missing []string `json:"missing"`
	// CannotProve lists what even a satisfied gate does not show.
	CannotProve []string `json:"cannot_prove"`
	// Counted are the refs the decision rests on, frozen into gate_evidence
	// when the cycle advances.
	Counted []uuid.UUID `json:"counted"`
	// Progress is the per-requirement tally the UI draws: have / need.
	Progress []GateProgress `json:"progress"`
}

// GateProgress is one requirement of a gate.
type GateProgress struct {
	Requirement string `json:"requirement"`
	Have        int    `json:"have"`
	Need        int    `json:"need"`
}

// EvaluateGate decides whether a cycle in in.Phase may advance.
func EvaluateGate(in GateInput) GateResult {
	res := GateResult{From: in.Phase, To: NextPhase(in.Phase), Missing: []string{}, Counted: []uuid.UUID{}}

	byTimepoint := map[string][]uuid.UUID{}
	for _, r := range in.Refs {
		if r.Status != StatusAccepted || r.Timepoint == "" {
			continue
		}
		byTimepoint[r.Timepoint] = append(byTimepoint[r.Timepoint], r.ID)
	}

	switch in.Phase {
	case PhaseCalibrate:
		baselines := byTimepoint[TimepointBaseline]
		res.Progress = []GateProgress{
			{Requirement: "baseline", Have: len(baselines), Need: CalibrateBaselines},
			{Requirement: "weekly_reviews", Have: in.WrittenBackReviews, Need: CalibrateReviews},
		}
		if len(baselines) < CalibrateBaselines {
			res.Missing = append(res.Missing,
				"Record where you started: accept at least one piece of evidence tagged as a baseline.")
		}
		if in.WrittenBackReviews < CalibrateReviews {
			res.Missing = append(res.Missing, fmt.Sprintf(
				"Finish %d weekly reviews with evidence and write them back (%d done so far).",
				CalibrateReviews, in.WrittenBackReviews))
		}
		res.Counted = append(res.Counted, baselines...)
		res.CannotProve = []string{
			"A baseline and two reviews show that you measured a starting point and kept a rhythm. " +
				"They cannot show that the method is working rather than time simply passing.",
		}

	case PhaseStack:
		delayed := byTimepoint[TimepointDelayed]
		transfer := byTimepoint[TimepointTransfer]
		res.Progress = []GateProgress{
			{Requirement: "delayed", Have: len(delayed), Need: StackDelayed},
			{Requirement: "transfer", Have: len(transfer), Need: StackTransfer},
		}
		if len(delayed) < StackDelayed {
			res.Missing = append(res.Missing,
				"Show it lasted: accept evidence from a check done days after you learned it, tagged as delayed.")
		}
		if len(transfer) < StackTransfer {
			res.Missing = append(res.Missing,
				"Show it travels: accept evidence of using it somewhere new, tagged as transfer.")
		}
		res.Counted = append(res.Counted, delayed...)
		res.Counted = append(res.Counted, transfer...)
		res.CannotProve = []string{
			"One delayed check and one transfer are single observations. " +
				"They cannot show the skill holds under pressure, at scale, or months from now.",
		}

	case PhaseDeliver:
		res.Final = true
		res.Missing = append(res.Missing,
			"This is the last phase of the cycle. Write the 90-day review, then start a new cycle.")
		res.CannotProve = []string{
			"Reaching the last phase records that the gates were passed. " +
				"It cannot show that the twelve-week outcome was reached; only the real scenario can.",
		}

	default:
		res.Missing = append(res.Missing, fmt.Sprintf("Unknown phase %q.", in.Phase))
		res.CannotProve = []string{"Nothing can be concluded about a cycle in an unknown phase."}
	}

	res.Open = !res.Final && res.To != "" && len(res.Missing) == 0
	return res
}
