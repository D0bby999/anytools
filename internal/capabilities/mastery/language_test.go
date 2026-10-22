package mastery

import (
	"context"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/locale"
)

// A lesson is written in the learner's language, a path may choose another
// or its documents', "Explain in …" asks once, and each language is its own
// cache entry (the private design notes, phase 4).
func TestALessonIsWrittenInThePathsLanguage(t *testing.T) {
	svc, store, model := newTestService(t, "concept", learnReply)
	vi := locale.WithLanguage(context.Background(), "vi")

	if _, err := svc.Learn(vi, store.user, store.point.ID, LearnRequest{}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(model.systems[0], "The learner reads Vietnamese") {
		t.Fatalf("no Vietnamese rule:\n%s", model.systems[0])
	}

	// Once in English: a new lesson, not the Vietnamese one served again.
	e, err := svc.Learn(vi, store.user, store.point.ID, LearnRequest{Lang: "en"})
	if err != nil || e.Lang != "en" || model.calls != 2 || !strings.Contains(model.systems[1], "The learner reads English") {
		t.Fatalf("explain in English: %+v %v, %d calls", e, err, model.calls)
	}

	// The path follows its documents: no rule.
	if _, err := svc.SetExplainLang(context.Background(), store.user, store.path.ID, ExplainSource); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Learn(vi, store.user, store.point.ID, LearnRequest{}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(model.systems[2], "The learner reads") {
		t.Fatalf("a path following its documents got a language rule:\n%s", model.systems[2])
	}
	if _, err := svc.Learn(vi, store.user, store.point.ID, LearnRequest{Lang: "Vietnamese"}); err == nil {
		t.Fatal("a language name was accepted as a code")
	}
}
