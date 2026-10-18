package research

import (
	"context"
	"fmt"
	"strings"

	"github.com/D0bby999/anytools/internal/capabilities/staged"
	"github.com/D0bby999/anytools/internal/citations"
	researchprompts "github.com/D0bby999/anytools/internal/prompts/research"
	"github.com/D0bby999/anytools/internal/runtime"
)

// verify.go — check each claim of the finished report against what it cites.
//
// Citation validation (internal/citations) already guarantees every marker
// names a source that was gathered. It cannot say whether that source SAYS
// what the sentence claims, and a learner studying the report needs exactly
// that. Postclaw's verifier (internal/research/verify.go) extracts claims and
// has a judge score each against its cited evidence; here one model call does
// both, over the text of the cited sources only.
//
// It is a model checking a model, and the report says so: "supported" means
// the check found the claim in its source, not that the claim is true. It is
// fail-soft: if the check cannot run, the report is delivered with the check
// marked unavailable rather than lost.

// StageVerify is the fifth stage.
const StageVerify = "verify"

// maxClaims bounds one check.
const maxClaims = 25

// maxEvidence bounds the source text handed to the check.
const maxEvidence = 60_000

// Verdicts.
const (
	VerdictSupported   = "supported"
	VerdictPartial     = "partial"
	VerdictUnsupported = "unsupported"
	VerdictUncited     = "uncited"
)

// Claim is one checked statement.
type Claim struct {
	Claim   string   `json:"claim"`
	Cites   []string `json:"cites"`
	Verdict string   `json:"verdict"`
	Note    string   `json:"note,omitempty"`
}

// Verification is the check's result, stored with the report.
type Verification struct {
	// Status is "checked", or "unavailable" when the check could not run.
	Status      string  `json:"status"`
	Total       int     `json:"total"`
	Supported   int     `json:"supported"`
	Partial     int     `json:"partial"`
	Unsupported int     `json:"unsupported"`
	Uncited     int     `json:"uncited"`
	Claims      []Claim `json:"claims"`
}

// verify runs the check over the validated report text.
func (c *Capability) verify(
	ctx context.Context, tc *runtime.TurnContext, model *staged.Model,
	report string, cited []citations.Source, g gathered,
) Verification {
	end := staged.Stage(tc, StageVerify)
	defer end()

	var evidence strings.Builder
	known := map[string]bool{}
	for _, s := range cited {
		key := citations.Key(s.Kind, s.ID)
		known[key] = true
		block := g.blocks[key]
		if block == "" || evidence.Len()+len(block) > maxEvidence {
			continue
		}
		evidence.WriteString(block + "\n\n")
	}

	var out struct {
		Claims []Claim `json:"claims"`
	}
	input := fmt.Sprintf("Check at most %d claims.\n\nThe report:\n\n%s\n\nThe cited sources:\n\n%s",
		maxClaims, report, evidence.String())
	if err := model.JSON(ctx, StageVerify, researchprompts.Verify, input, nil, &out); err != nil {
		c.observeAt(tc, StageVerify, "the claim check could not run, so this report is unchecked")
		return Verification{Status: "unavailable"}
	}

	v := Verification{Status: "checked"}
	for _, cl := range out.Claims {
		if len(v.Claims) == maxClaims {
			break
		}
		cl.Claim = strings.TrimSpace(cl.Claim)
		if cl.Claim == "" {
			continue
		}
		// Only ids the report actually cites count; a judge naming another
		// source is not evidence for this sentence.
		cites := make([]string, 0, len(cl.Cites))
		for _, id := range cl.Cites {
			if id = strings.TrimSpace(id); known[id] {
				cites = append(cites, id)
			}
		}
		cl.Cites = cites
		switch {
		case len(cites) == 0:
			cl.Verdict = VerdictUncited
		case cl.Verdict != VerdictSupported && cl.Verdict != VerdictPartial && cl.Verdict != VerdictUnsupported:
			// An unknown verdict is not counted as support.
			cl.Verdict = VerdictUnsupported
		}
		if r := []rune(cl.Note); len(r) > 300 {
			cl.Note = string(r[:300])
		}
		v.Claims = append(v.Claims, cl)
		switch cl.Verdict {
		case VerdictSupported:
			v.Supported++
		case VerdictPartial:
			v.Partial++
		case VerdictUnsupported:
			v.Unsupported++
		case VerdictUncited:
			v.Uncited++
		}
	}
	v.Total = len(v.Claims)

	tc.Emit(runtime.Event{
		Type: runtime.EvProgress, Stage: StageVerify, Source: c.Name(),
		Content: fmt.Sprintf("%d of %d claims supported by their sources", v.Supported, v.Total),
		Metadata: map[string]any{
			"total": v.Total, "supported": v.Supported, "partial": v.Partial,
			"unsupported": v.Unsupported, "uncited": v.Uncited,
		},
	})
	return v
}
