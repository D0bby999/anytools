package byok

import (
	"strconv"
	"strings"

	"github.com/D0bby999/anytools/internal/rag/embed"
)

// unsupported is the refusal for a connection routed to a function its
// provider has no endpoint for, in words: "Anthropic cannot be used for
// indexing documents", not "anthropic cannot serve embed". The provider is
// named as the catalog names it, and the task by functionSentence, which the
// catalog translates as an argument of the sentence.
func unsupported(provider string, fn Function) error {
	return invalid("%s cannot be used for %s", providerLabel(provider), functionSentence(fn))
}

// providerLabel is the catalog's name for a provider, else its id.
func providerLabel(provider string) string {
	for _, row := range catalogRows {
		if row.Type == provider {
			return row.Label
		}
	}
	return provider
}

// functionSentence names a function as the task a learner knows it by, to sit
// inside a sentence. internal/locale's catalog test reads these returns.
func functionSentence(fn Function) string {
	switch fn {
	case FunctionChat:
		return "answering questions"
	case FunctionParse:
		return "reading documents"
	case FunctionEmbed:
		return "indexing documents"
	case FunctionQuiz:
		return "writing quizzes"
	case FunctionMastery:
		return "planning study paths"
	case FunctionReading:
		return "the reading tutor"
	case FunctionSolve:
		return "solving problems"
	case FunctionResearch:
		return "research reports"
	case FunctionRerank:
		return "ranking passages"
	case FunctionTTS:
		return "reading aloud"
	case FunctionSTT:
		return "turning speech into text"
	}
	return string(fn)
}

// supportedWidths lists embed.SupportedDims for a sentence: "256, 384, … 3072".
func supportedWidths() string {
	parts := make([]string, len(embed.SupportedDims))
	for i, d := range embed.SupportedDims {
		parts[i] = strconv.Itoa(d)
	}
	return strings.Join(parts, ", ")
}
