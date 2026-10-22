package quiz

import (
	"context"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/locale"
	quizprompts "github.com/D0bby999/anytools/internal/prompts/quiz"
)

// A question stays in its passages' language; its explanation and the
// judge's feedback are in the learner's (the private design notes).
func TestAQuestionKeepsItsPassagesLanguage(t *testing.T) {
	vi := locale.WithLanguage(context.Background(), "vi")
	gen := languageRule(vi, quizprompts.Generate)
	if !strings.Contains(gen, "The learner reads Vietnamese") || !strings.Contains(gen, "in the language of the passages") {
		t.Fatalf("generate: %q", gen)
	}
	if judge := languageRule(vi, quizprompts.Judge); strings.Contains(judge, "language of the passages") || !strings.Contains(judge, "Vietnamese") {
		t.Fatalf("judge: %q", judge)
	}
	if languageRule(context.Background(), quizprompts.Generate) != "" {
		t.Fatal("a rule with no language")
	}
}
