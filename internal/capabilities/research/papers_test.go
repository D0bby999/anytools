package research

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/rag/papers"
)

type fakePapers struct {
	mu      sync.Mutex
	queries []string
}

func (f *fakePapers) SearchPapers(_ context.Context, _ uuid.UUID, q string, _ int) ([]papers.Paper, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.queries = append(f.queries, q)
	n := len(f.queries)
	return []papers.Paper{{ID: fmt.Sprintf("W%d", n), Source: "openalex", Title: "Paper for " + q, Year: 2024,
		URL: fmt.Sprintf("https://doi.org/10.1/%d", n), Abstract: "An abstract."}}, nil
}

// A scholarly question searches papers for the first two sub-questions in
// quick mode; papers enter the report as academic sources.
func TestAScholarlyQuestionSearchesPapers(t *testing.T) {
	s := newSetup()
	s.model.scholarly = true
	fp := &fakePapers{}
	s.papers = fp
	if _, _, err := s.run(t); err != nil {
		t.Fatal(err)
	}
	if len(fp.queries) != 2 {
		t.Fatalf("paper searches = %v, want the first two sub-questions", fp.queries)
	}
	found := 0
	for _, src := range s.reports.reports[0].Sources {
		if strings.HasPrefix(src.URL, "https://doi.org/") {
			found++
		}
	}
	if found == 0 {
		t.Fatal("no paper reached the report's sources")
	}
}

func TestAnEverydayQuestionDoesNotSearchPapers(t *testing.T) {
	s := newSetup()
	fp := &fakePapers{}
	s.papers = fp
	if _, _, err := s.run(t); err != nil {
		t.Fatal(err)
	}
	if len(fp.queries) != 0 {
		t.Fatalf("an unscholarly question searched papers: %v", fp.queries)
	}
}

// The egress gate holds for papers as for the web.
func TestPaperSearchIsGatedLikeTheWeb(t *testing.T) {
	s := newSetup()
	s.kbs = true
	s.model.scholarly = true
	fp := &fakePapers{}
	s.papers = fp
	if _, _, err := s.run(t); err != nil {
		t.Fatal(err)
	}
	if len(fp.queries) != 0 {
		t.Fatalf("papers were searched after the learner's documents were read: %v", fp.queries)
	}
}

// Red team AS-5: six papers whose links all resolve through doi.org survive
// the per-site cap, and rank as academic whatever their host.
func TestPapersAreEachTheirOwnSiteAndAcademic(t *testing.T) {
	pool := newCandidatePool()
	var results []citations.Source
	for i := 0; i < 6; i++ {
		results = append(results, citations.Source{Kind: citations.KindURL, ID: fmt.Sprint(i + 1),
			URL: fmt.Sprintf("https://doi.org/10.1/%d", i), Authority: AuthAcademic, Site: fmt.Sprintf("openalex:W%d", i)})
	}
	results = append(results, citations.Source{Kind: citations.KindURL, ID: "7",
		URL: "https://www.mdpi.com/x", Authority: AuthAcademic, Site: "openalex:W9"})
	pool.add(results, nil)
	best := pool.best(20)
	if len(best) != 7 {
		t.Fatalf("%d of 7 papers survived the per-site cap", len(best))
	}
	for _, c := range best {
		if c.authority != AuthAcademic {
			t.Fatalf("%s ranked %s", c.source.URL, c.authority)
		}
	}
}
