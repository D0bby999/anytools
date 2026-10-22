package mastery

import (
	"context"
	"slices"
	"testing"

	"github.com/google/uuid"
)

// A point well below the plan's typical one is marked, on any embedding
// model's scale; a close call is not.
func TestOutsideSourceIsRelativeToThePlan(t *testing.T) {
	// OpenAI text-embedding-3-small's scale.
	if got := OutsideSource([]float64{0.52, 0.48, 0.55, 0.21, 0.5}); !slices.Equal(got, []bool{false, false, false, true, false}) {
		t.Fatalf("small scale: %v", got)
	}
	// nomic or Gemini's scale: the same shape, higher numbers.
	if got := OutsideSource([]float64{0.78, 0.74, 0.8, 0.52, 0.76}); !slices.Equal(got, []bool{false, false, false, true, false}) {
		t.Fatalf("large scale: %v", got)
	}
	// A point a little below the rest is not "outside".
	if got := OutsideSource([]float64{0.78, 0.74, 0.8, 0.69, 0.76}); slices.Contains(got, true) {
		t.Fatalf("a close call was marked: %v", got)
	}
	if got := OutsideSource([]float64{0.9, 0.1}); slices.Contains(got, true) {
		t.Fatalf("two points were judged: %v", got)
	}
}

type fixedCoverage struct {
	sims []float64
	err  error
}

func (c fixedCoverage) Closeness(context.Context, uuid.UUID, uuid.UUID, []string) ([]float64, error) {
	return c.sims, c.err
}

func TestMarkCoverageSaysWhenItCouldNotCheck(t *testing.T) {
	modules := func() []ProposedModule {
		return []ProposedModule{{Name: "m", KnowledgePoints: []ProposedKP{{Name: "a"}, {Name: "b"}, {Name: "c"}, {Name: "d"}}}}
	}
	s := &Service{coverage: fixedCoverage{sims: []float64{0.5, 0.52, 0.2, 0.49}}}
	ms := modules()
	if got := s.markCoverage(context.Background(), uuid.New(), uuid.New(), ms); got != CoverageChecked {
		t.Fatalf("coverage = %q", got)
	}
	if !ms[0].KnowledgePoints[2].OutsideSource || ms[0].KnowledgePoints[0].OutsideSource {
		t.Fatalf("marks = %+v", ms[0].KnowledgePoints)
	}
	s = &Service{coverage: fixedCoverage{err: ErrCoverageUnknown}}
	ms = modules()
	if got := s.markCoverage(context.Background(), uuid.New(), uuid.New(), ms); got != CoverageSkipped || ms[0].KnowledgePoints[2].OutsideSource {
		t.Fatalf("an unmeasured base was marked: %q %+v", got, ms)
	}
	if got := (&Service{}).markCoverage(context.Background(), uuid.New(), uuid.New(), modules()); got != CoverageSkipped {
		t.Fatalf("no coverage = %q", got)
	}
}

func TestExplainLanguageChoices(t *testing.T) {
	for _, ok := range []string{"", "source", "vi", "pt-BR"} {
		if !ValidExplainLang(ok) {
			t.Errorf("%q refused", ok)
		}
	}
	for _, bad := range []string{"Vietnamese", "vi_VN", "x"} {
		if ValidExplainLang(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
}
