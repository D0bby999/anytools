package locale

import (
	"context"
	"fmt"
)

// explain.go: what a model writes FOR the learner is in the learner's
// language (the private design notes, phase 4). Before it, only chat
// had a language rule; a study plan, a lesson or a quiz's explanation came
// out in the documents' language, so a Vietnamese learner of English was
// taught in English.

type languageKey struct{}

// WithLanguage attaches the language the learner reads explanations in. The
// API's RequireUser sets the interface language (httpx.WithLanguage); a
// mastery path's own choice replaces it for that path's calls. "" means no
// rule: the model follows its material.
func WithLanguage(ctx context.Context, lang string) context.Context {
	return context.WithValue(ctx, languageKey{}, lang)
}

// FromContext is the language WithLanguage attached, or "".
func FromContext(ctx context.Context) string {
	lang, _ := ctx.Value(languageKey{}).(string)
	return lang
}

// ExplainRule is the section a system prompt gets so that everything written
// for the learner is in lang, while what they are learning stays as it is.
// Empty for "".
func ExplainRule(lang string) string {
	if lang == "" {
		return ""
	}
	name := EnglishName(lang)
	return fmt.Sprintf(`

Language
- The learner reads %[1]s. Write everything addressed to them in %[1]s: explanations, objectives, feedback, reasons, notes and names you make up (a module's or a point's name, unless it is a term from the material).
- Keep what they are learning in its own language: terms, quotations and examples from their documents. When a term is in another language, give its %[1]s sense beside it the first time.
- JSON keys and fixed values (such as "memory" or "correct") stay exactly as specified.`, name)
}

// ExplainIn is ExplainRule for the language on ctx.
func ExplainIn(ctx context.Context) string { return ExplainRule(FromContext(ctx)) }
