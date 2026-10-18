package loop

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Evidence kinds: what an evidence ref may point at. The list is repeated as a
// CHECK constraint in the migration; EvidenceKinds() is what a test compares
// the two with.
const (
	KindQuestionAttempt = "question_attempt"
	KindKPState         = "kp_state"
	KindNote            = "note"
	// KindResearchReport names phase 9's reports. It is a legal kind from the
	// first migration so that merging phase 9 adds a query, not a schema
	// change; until then nothing proposes it and ownership of one cannot be
	// proven, so the API refuses it (see Store.OwnsTarget).
	KindResearchReport = "research_report"
	KindChatMessage    = "chat_message"
	// KindExplainBack (Mastery's explain-back attempts) and KindCardEntry
	// (skill evidence card entries) arrive with the learning-depth plan. The
	// groundwork migration adds both at once, so the two phases that fill
	// their tables never rewrite the same CHECK. An explain-back ref shows the
	// point it explained and its verdict — the learner's own override is shown
	// as theirs, never as a system pass (internal/store/pg/learning_loop_targets.go).
	KindExplainBack = "explain_back"
	KindCardEntry   = "card_entry"
	// KindWorksheet is one of up's worksheets (internal/learning/worksheet).
	// A private worksheet is never evidence: every query and the ownership
	// check filter on its stored private column.
	KindWorksheet = "worksheet"
)

// EvidenceKinds returns every legal kind, in the migration's order.
func EvidenceKinds() []string {
	return []string{KindQuestionAttempt, KindKPState, KindNote, KindResearchReport, KindChatMessage,
		KindExplainBack, KindCardEntry, KindWorksheet}
}

// Timepoints on an evidence chain. A review's ref may carry one too, and that
// is how a baseline or a delayed check recorded during a week reaches a gate.
const (
	TimepointBaseline  = "baseline"
	TimepointImmediate = "immediate"
	TimepointDelayed   = "delayed"
	TimepointTransfer  = "transfer"
)

// Timepoints returns the four, in the order a chain reads left to right.
func Timepoints() []string {
	return []string{TimepointBaseline, TimepointImmediate, TimepointDelayed, TimepointTransfer}
}

// Evidence statuses. Gates count StatusAccepted only; a dismissed suggestion
// stays so that tomorrow's job does not propose it again.
const (
	StatusSuggested = "suggested"
	StatusAccepted  = "accepted"
	StatusDismissed = "dismissed"
)

// Who put a ref there.
const (
	SuggestedByUser = "user"
	SuggestedByJob  = "job"
)

// DelayedAfter is how long after a first attempt a repeat counts as a delayed
// check rather than an immediate one. Three days is the short end of the
// "days later" window the method asks for; anything sooner is still mostly the
// same session's memory.
const DelayedAfter = 72 * time.Hour

// EvidenceRef is one row of evidence_refs, with its target resolved.
type EvidenceRef struct {
	ID          uuid.UUID  `json:"id"`
	UserID      uuid.UUID  `json:"-"`
	ReviewID    *uuid.UUID `json:"review_id,omitempty"`
	ChainID     *uuid.UUID `json:"chain_id,omitempty"`
	Timepoint   string     `json:"timepoint,omitempty"`
	Kind        string     `json:"kind"`
	RefID       uuid.UUID  `json:"ref_id"`
	Note        string     `json:"note"`
	Status      string     `json:"status"`
	SuggestedBy string     `json:"suggested_by"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`

	// Target is what the ref points at, read with the owner's id. Nil when the
	// target is gone — deleted since, or never this user's — which the UI shows
	// as "the thing this pointed at no longer exists" rather than hiding it.
	Target *Target `json:"target"`
}

// Target is a human-readable view of the row an evidence ref names.
type Target struct {
	Label      string    `json:"label"`
	Detail     string    `json:"detail"`
	OccurredAt time.Time `json:"occurred_at"`
	// Link is an in-app path the UI can open, or "".
	Link string `json:"link,omitempty"`
}

// Candidate is a proposed piece of evidence: something the user did this week
// that the suggestion query found.
type Candidate struct {
	Kind  string    `json:"kind"`
	RefID uuid.UUID `json:"ref_id"`
	Target
	// Timepoint is a HINT: the first attempt at a question reads as a
	// baseline, a repeat after DelayedAfter as a delayed check. The person
	// decides; nothing is tagged on their behalf.
	Timepoint string `json:"timepoint,omitempty"`
	// Status is "" for a fresh candidate, or the status of the ref already
	// recorded for it on this review.
	Status string `json:"status,omitempty"`
}

// NewEvidence is the input for adding evidence to a review or a chain.
type NewEvidence struct {
	Kind      string    `json:"kind"`
	RefID     uuid.UUID `json:"ref_id"`
	Timepoint string    `json:"timepoint"`
	Note      string    `json:"note"`
}

// EvidencePatch changes a ref's status, timepoint or note. Kind and target are
// fixed: evidence that now points somewhere else is different evidence.
type EvidencePatch struct {
	Status    *string `json:"status"`
	Timepoint *string `json:"timepoint"`
	Note      *string `json:"note"`
}

func validKind(k string) bool { return contains(EvidenceKinds(), k) }

func validTimepoint(tp string) bool { return tp == "" || contains(Timepoints(), tp) }

func validStatus(s string) bool {
	return s == StatusSuggested || s == StatusAccepted || s == StatusDismissed
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// Chain is one row of evidence_chains: a single question followed through the
// four timepoints.
type Chain struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"-"`
	StateID   uuid.UUID  `json:"state_id"`
	Question  string     `json:"question"`
	Split     ChainSplit `json:"split"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// ChainSplit keeps what was seen apart from what it is taken to mean and from
// what is only suspected. Mixing the three is how a single good day becomes
// "I know this now".
type ChainSplit struct {
	Fact           string `json:"fact"`
	Interpretation string `json:"interpretation"`
	Hypothesis     string `json:"hypothesis"`
}

// ChainInput creates or patches a chain.
type ChainInput struct {
	Question *string     `json:"question"`
	Split    *ChainSplit `json:"split"`
}

// Validate checks a chain input; create requires the question.
func (in ChainInput) Validate(create bool) error {
	if create || in.Question != nil {
		q := ""
		if in.Question != nil {
			q = *in.Question
		}
		if err := requireText("question", q, MaxTaskLen); err != nil {
			return err
		}
	}
	if in.Split != nil {
		for _, v := range []string{in.Split.Fact, in.Split.Interpretation, in.Split.Hypothesis} {
			if len(v) > MaxTextLen {
				return fmt.Errorf("%w: a chain note is too long", ErrInvalid)
			}
		}
	}
	return nil
}

// ChainDetail is a chain with its evidence grouped into the four columns.
type ChainDetail struct {
	Chain
	Columns []ChainColumn `json:"columns"`
	// Complete is true when every timepoint holds at least one accepted ref.
	Complete bool `json:"complete"`
	// CannotProve is what even a complete chain does not show.
	CannotProve string `json:"cannot_prove"`
}

// ChainColumn is one timepoint of a chain.
type ChainColumn struct {
	Timepoint string        `json:"timepoint"`
	Refs      []EvidenceRef `json:"refs"`
}

// GroupChain arranges a chain's refs into its four columns.
func GroupChain(c Chain, refs []EvidenceRef) ChainDetail {
	d := ChainDetail{Chain: c, Complete: true}
	for _, tp := range Timepoints() {
		col := ChainColumn{Timepoint: tp, Refs: []EvidenceRef{}}
		accepted := 0
		for _, r := range refs {
			if r.Timepoint == tp {
				col.Refs = append(col.Refs, r)
				if r.Status == StatusAccepted {
					accepted++
				}
			}
		}
		if accepted == 0 {
			d.Complete = false
		}
		d.Columns = append(d.Columns, col)
	}
	d.CannotProve = "Four points on one question show a trend for that question. " +
		"They cannot show the same holds for questions you did not track."
	return d
}
