package loop

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

// resume.go is the AI-resume contract: what a chat linked to a learning state
// is shown, and the one shape of update it may hand back.
//
// A model in a new conversation remembers nothing about the goal, and the
// failure worth designing against is that it pretends otherwise — "last time
// we covered…" about a session it never saw. Two things push against that.
// The prompt (internal/prompts/loop/resume.md) tells it the quoted state is all
// it has. And the paste-back it emits must carry the state's current Revision,
// which it can only have copied from the context it was given: an update
// written from imagination, or against a state that has changed since, is
// refused before it can reach handover_md.

// PasteBackFence is the info string of the fenced block a paste-back lives in.
const PasteBackFence = "anytools-handover"

// MaxRestated is the most bullets a restatement may have.
const MaxRestated = 6

// PasteBack is the structured update a resumed chat emits.
type PasteBack struct {
	Revision   string   `json:"revision"`
	Restated   []string `json:"restated"`
	Exercise   Exercise `json:"exercise"`
	Unknowns   []string `json:"unknowns"`
	NextTask   string   `json:"next_task"`
	HandoverMD string   `json:"handover_md"`
}

// Exercise is the one exercise a resumed chat ran.
type Exercise struct {
	Prompt  string `json:"prompt"`
	Outcome string `json:"outcome"`
}

var pasteBackBlock = regexp.MustCompile("(?s)```" + PasteBackFence + "[ \t]*\r?\n(.*?)\r?\n?```")

// ErrNoPasteBack means the text contains no paste-back block at all.
var ErrNoPasteBack = errors.New("loop: no paste-back block")

// ParsePasteBack extracts and structurally validates the paste-back in text.
//
// It accepts either a whole assistant message containing one fenced block, or
// the bare JSON object a user copied out of it. Unknown fields are refused, not
// ignored: a field this code does not know is a field it cannot validate, and
// the model inventing one is itself a signal.
//
// Revision is NOT checked here; that needs the state (see CheckRevision).
func ParsePasteBack(text string) (*PasteBack, []string, error) {
	raw := strings.TrimSpace(text)
	blocks := pasteBackBlock.FindAllStringSubmatch(raw, -1)
	switch {
	case len(blocks) > 1:
		return nil, []string{"There is more than one handover block; paste exactly one."}, nil
	case len(blocks) == 1:
		raw = strings.TrimSpace(blocks[0][1])
	case !strings.HasPrefix(raw, "{"):
		return nil, nil, ErrNoPasteBack
	}

	var pb PasteBack
	dec := json.NewDecoder(bytes.NewReader([]byte(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&pb); err != nil {
		return nil, []string{"The handover block is not valid JSON of the expected shape: " + trimErr(err)}, nil
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, []string{"The handover block must contain exactly one JSON object."}, nil
	}

	var problems []string
	if strings.TrimSpace(pb.Revision) == "" {
		problems = append(problems, "The revision is missing.")
	}
	switch n := len(pb.Restated); {
	case n == 0:
		problems = append(problems, "The restatement is missing.")
	case n > MaxRestated:
		problems = append(problems, fmt.Sprintf("The restatement has %d bullets; at most %d are allowed.", n, MaxRestated))
	}
	for i, b := range pb.Restated {
		if strings.TrimSpace(b) == "" {
			problems = append(problems, fmt.Sprintf("Restated bullet %d is empty.", i+1))
		}
		if len(b) > 400 {
			problems = append(problems, fmt.Sprintf("Restated bullet %d is too long.", i+1))
		}
	}
	if strings.TrimSpace(pb.Exercise.Prompt) == "" {
		problems = append(problems, "The exercise that was run is missing.")
	}
	if strings.TrimSpace(pb.HandoverMD) == "" {
		problems = append(problems, "The handover note is empty.")
	}
	if len(pb.HandoverMD) > MaxHandoverLen {
		problems = append(problems, "The handover note is too long.")
	}
	if len(pb.NextTask) > MaxTaskLen {
		problems = append(problems, "The suggested next task is too long.")
	}
	if len(pb.Unknowns) > maxListItems {
		problems = append(problems, "Too many unknowns listed.")
	}
	if len(problems) > 0 {
		return &pb, problems, nil
	}
	return &pb, nil, nil
}

// CheckRevision compares a paste-back's revision with the state's current one.
func CheckRevision(pb *PasteBack, st LearningState) []string {
	if pb.Revision != Revision(st) {
		return []string{"This handover was written against a different version of the state — " +
			"it changed since, or the revision was not copied from it. Start a new resume chat to get a fresh one."}
	}
	return nil
}

// HandoverRequest is the body of POST /v1/learning/states/{id}/handover.
type HandoverRequest struct {
	// Text is the assistant message, or the block copied out of it.
	Text string `json:"text"`
	// Accept writes it; without it the request only validates.
	Accept bool `json:"accept"`
	// AcceptNextTask also replaces the state's next task with the suggested one.
	AcceptNextTask bool `json:"accept_next_task"`
}

// HandoverResult is what validation found, and whether it was written.
type HandoverResult struct {
	Valid     bool           `json:"valid"`
	Problems  []string       `json:"problems"`
	PasteBack *PasteBack     `json:"paste_back,omitempty"`
	Accepted  bool           `json:"accepted"`
	State     *LearningState `json:"state,omitempty"`
}

// RenderState writes a state as the Markdown a resumed chat is shown.
//
// Empty fields are written as "(empty)" rather than omitted: the prompt tells
// the model to say a field is empty, and it can only do that if it can see the
// field exists.
func RenderState(st LearningState, cycle *Cycle) string {
	var b strings.Builder
	field := func(name, v string) {
		v = strings.TrimSpace(v)
		if v == "" {
			v = "(empty)"
		}
		fmt.Fprintf(&b, "%s: %s\n", name, v)
	}
	list := func(name string, items []string) {
		fmt.Fprintf(&b, "%s:\n", name)
		if len(items) == 0 {
			b.WriteString("- (empty)\n")
			return
		}
		for _, it := range items {
			fmt.Fprintf(&b, "- %s\n", strings.TrimSpace(it))
		}
	}

	field("Goal", st.Goal)
	field("Real scenario", st.RealScenario)
	field("Twelve-week outcome", st.Outcome12w)
	field("Next task", st.NextTask)
	field("Minimum version of the next task", st.NextTaskMinimum)
	// Two of the minimum contract's three answers. The third, when to ask for
	// help, is private (plan principle 5) and is never written here: this text
	// goes to the learner's model with every turn of a state-linked chat.
	field("Downshift instead of forcing it when", st.MinimumContract.DownshiftWhen)
	field("Still worth keeping on a bad day", st.MinimumContract.StillWorthKeeping)
	list("AI may", st.AIBoundaries.AIMay)
	list("A human must confirm", st.AIBoundaries.HumanMustConfirm)

	var methods []string
	for _, m := range st.ValidatedMethods {
		methods = append(methods, m.Method)
	}
	list("Methods with evidence behind them", methods)

	var hyps []string
	for _, h := range st.Hypotheses {
		hyps = append(hyps, h.Claim)
	}
	if len(hyps) > 10 {
		hyps = hyps[len(hyps)-10:]
	}
	list("Open hypotheses (most recent)", hyps)

	if cycle != nil {
		field("Cycle phase", cycle.Phase)
		fmt.Fprintf(&b, "Cycle started: %s\n", cycle.StartedAt.UTC().Format("2006-01-02"))
		if n := len(cycle.Interruptions); n > 0 {
			last := cycle.Interruptions[n-1]
			fmt.Fprintf(&b, "Last interruption: %s — the next task was shrunk to its minimum\n",
				last.At.UTC().Format("2006-01-02"))
		}
	} else {
		b.WriteString("Cycle: (none)\n")
	}
	b.WriteString("Handover note:\n")
	if h := strings.TrimSpace(st.HandoverMD); h != "" {
		b.WriteString(h)
		b.WriteString("\n")
	} else {
		b.WriteString("(empty)\n")
	}
	return b.String()
}

func trimErr(err error) string {
	// Rune boundary: the message can quote a field name the model made up.
	r := []rune(err.Error())
	if len(r) > 160 {
		r = r[:160]
	}
	return string(r)
}

// ResumeContext is what a chat linked to a state is shown on one turn.
type ResumeContext struct {
	State    LearningState
	Cycle    *Cycle
	Revision string
}

// ResumeContext reads a state and its current cycle for a resumed chat. It is
// read afresh on every turn, so a handover accepted mid-conversation changes
// the revision the model sees next.
func (s *Service) ResumeContext(ctx context.Context, userID, stateID uuid.UUID) (*ResumeContext, error) {
	st, err := s.store.GetState(ctx, userID, stateID)
	if err != nil {
		return nil, err
	}
	rc := &ResumeContext{State: *st, Revision: Revision(*st)}
	cycle, err := s.store.CurrentCycle(ctx, userID, stateID)
	switch {
	case err == nil:
		rc.Cycle = cycle
	case !errors.Is(err, ErrNotFound):
		return nil, err
	}
	return rc, nil
}
