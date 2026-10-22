package locale

import (
	"context"
	"strings"
	"testing"
)

func TestTheExplainRuleNamesTheLearnersLanguage(t *testing.T) {
	if ExplainIn(context.Background()) != "" {
		t.Fatal("a rule with no language")
	}
	rule := ExplainIn(WithLanguage(context.Background(), "pt-BR"))
	if !strings.Contains(rule, "The learner reads Portuguese") || !strings.Contains(rule, "Keep what they are learning in its own language") {
		t.Fatalf("rule = %q", rule)
	}
	if !strings.Contains(ExplainRule("tl"), `BCP 47 code "tl"`) {
		t.Fatal("an unnamed language is not named by its code")
	}
}
