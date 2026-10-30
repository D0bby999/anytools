package mastery

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/google/uuid"
)

// coverage.go marks a proposed point the learner's documents hardly cover
// (the private design notes, phase 4). The English walkthrough's plan
// added "adapting tone to the listener" to a lesson that never mentions it,
// with nothing to say so. The model's own note is not trusted for this; each
// point is measured against the knowledge base.
//
// The measure is relative. Cosine similarity runs on different scales per
// embedding model (OpenAI's small model puts related text near 0.5, nomic
// and Gemini near 0.75), so no single number means "covered". A point is
// marked when its nearest passage is clearly further than the plan's typical
// point's: below coverageRatio of the median and below it by coverageMargin.

// Coverage measures how close each text is to the nearest passage of a
// knowledge base, as a cosine similarity.
type Coverage interface {
	Closeness(ctx context.Context, userID, kbID uuid.UUID, texts []string) ([]float64, error)
}

// ErrCoverageUnknown is Closeness when the base cannot be measured on the
// learner's current embedding route.
var ErrCoverageUnknown = errors.New("mastery: coverage cannot be measured")

// Proposal.Coverage values.
const (
	CoverageChecked = "checked"
	CoverageSkipped = "skipped"
	// CoverageLanguage: not measured, the plan being in another language
	// than the documents.
	CoverageLanguage = "language"
)

const (
	coverageRatio  = 0.8
	coverageMargin = 0.08
	// coverageMinPoints: below this a median says nothing about a typical point.
	coverageMinPoints = 3
)

// markCoverage sets OutsideSource on the points far from the base, and says
// whether it could check.
//
// Names written in another language than the documents are not measured: on
// an embedding model that knows one language, a translated name sits far
// from its own passage while a term kept in the original sits close, so the
// marks would fall on the translated points, which the learner is then
// invited to delete (the private design notes
// M2). planLang is the language the plan was written in ("" for the
// documents' own); docLang the documents', as vocab.DetectLang tells it.
func (s *Service) markCoverage(ctx context.Context, userID, kbID uuid.UUID, modules []ProposedModule, planLang, docLang string) string {
	if s.coverage == nil {
		return CoverageSkipped
	}
	if !sameLanguage(planLang, docLang) {
		return CoverageLanguage
	}
	var texts []string
	for _, m := range modules {
		for _, kp := range m.KnowledgePoints {
			texts = append(texts, kp.Name)
		}
	}
	if len(texts) == 0 {
		return CoverageSkipped
	}
	sims, err := s.coverage.Closeness(ctx, userID, kbID, texts)
	if err != nil || len(sims) != len(texts) {
		return CoverageSkipped
	}
	outside := OutsideSource(sims)
	i := 0
	for m := range modules {
		for k := range modules[m].KnowledgePoints {
			modules[m].KnowledgePoints[k].OutsideSource = outside[i]
			i++
		}
	}
	return CoverageChecked
}

// sameLanguage reports whether names in planLang ("" for the documents'
// own) can be measured against documents in docLang.
func sameLanguage(planLang, docLang string) bool {
	if planLang == "" {
		return true
	}
	base, _, _ := strings.Cut(strings.ToLower(planLang), "-")
	return base == docLang
}

// OutsideSource reports, for each similarity, whether it is clearly below
// the rest (see the file comment).
func OutsideSource(sims []float64) []bool {
	out := make([]bool, len(sims))
	if len(sims) < coverageMinPoints {
		return out
	}
	sorted := append([]float64(nil), sims...)
	sort.Float64s(sorted)
	n := len(sorted)
	median := sorted[n/2]
	if n%2 == 0 {
		median = (sorted[n/2-1] + sorted[n/2]) / 2
	}
	for i, v := range sims {
		out[i] = v < median*coverageRatio && v < median-coverageMargin
	}
	return out
}
