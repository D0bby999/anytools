package mastery

import (
	"context"
	"fmt"
	"regexp"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/locale"
)

// language.go: the language a path's lessons, plans and feedback are written
// in (the private design notes, phase 4). The request carries the
// learner's interface language (locale.FromContext); a path may choose
// another, or the documents' own.

// ExplainSource is the path choice that follows the documents' language.
const ExplainSource = "source"

var languageCode = regexp.MustCompile(`^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$`)

// ValidExplainLang accepts "", "source" or a language code, as the
// migration's CHECK does.
func ValidExplainLang(lang string) bool {
	return lang == "" || lang == ExplainSource || languageCode.MatchString(lang)
}

// inLanguage is ctx with a path's choice applied: "" keeps the learner's,
// "source" drops the rule.
func inLanguage(ctx context.Context, choice string) context.Context {
	switch choice {
	case "":
		return ctx
	case ExplainSource:
		return locale.WithLanguage(ctx, "")
	default:
		return locale.WithLanguage(ctx, choice)
	}
}

// SetExplainLang changes the language a path is explained in.
func (s *Service) SetExplainLang(ctx context.Context, userID, pathID uuid.UUID, lang string) (*Path, error) {
	if !ValidExplainLang(lang) {
		return nil, fmt.Errorf("%w: that is not a language code", ErrBadRequest)
	}
	return s.store.SetExplainLang(ctx, userID, pathID, lang)
}
