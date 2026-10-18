package solve

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/learning/ownversion"
	"github.com/D0bby999/anytools/internal/runtime"
)

// The learner's own version (up-methods phase 11) reaches the reason and write
// stages under its heading, and a solve without it sends no heading at all.
func TestOwnVersionReachesReasonAndWrite(t *testing.T) {
	lines, _ := json.Marshal(ownversion.Lines{Understanding: "UNDERSTAND-MARK", Uncertain: "UNSURE-MARK", Proof: "PROOF-MARK"})
	for _, withLines := range []bool{true, false} {
		provider := &stageProvider{requests: map[string]runtime.ChatRequest{}, reason: reasonJSON, write: "**Answer:** $x = 4$"}
		params := map[string]string{"variant": VariantSolve}
		if withLines {
			params[ParamOwnVersion] = string(lines)
		}
		tc, _, msgs, _ := build(t, provider, params, nil, false)
		tc.Input = "2x + 3 = 11"
		if err := New(msgs).Run(context.Background(), tc); err != nil {
			t.Fatalf("Run: %v", err)
		}
		for _, stage := range []string{StageReason, StageWrite} {
			input := provider.requests[stage].Messages[1].Content
			head := strings.Index(input, ownversion.Heading)
			if !withLines {
				if head >= 0 {
					t.Errorf("%s: a heading with no lines: %q", stage, input)
				}
				continue
			}
			if head < 0 {
				t.Fatalf("%s: no heading: %q", stage, input)
			}
			for _, mark := range []string{"UNDERSTAND-MARK", "UNSURE-MARK", "PROOF-MARK"} {
				if i := strings.Index(input, mark); i < head {
					t.Errorf("%s: %s is not under the heading", stage, mark)
				}
			}
		}
	}
}
