package research

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/zotero"
)

type fakeZotero struct {
	mu        sync.Mutex
	connected bool
	queries   []string
}

func (f *fakeZotero) Connected(context.Context, uuid.UUID) (bool, error) { return f.connected, nil }

func (f *fakeZotero) SearchZotero(_ context.Context, _ uuid.UUID, q string, _ int) ([]zotero.Item, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.queries = append(f.queries, q)
	n := len(f.queries)
	return []zotero.Item{{Key: fmt.Sprintf("ITEM%04d", n), ItemType: "journalArticle", Title: "Library item for " + q,
		Year: "2021", DOI: fmt.Sprintf("10.9/%d", n), Abstract: "From the learner's library."}}, nil
}

// Up-methods phase 20: with a Zotero library connected, research searches it
// for the first sub-questions, whatever the question, and its items enter the
// report as sources.
func TestAConnectedZoteroLibraryIsSearched(t *testing.T) {
	s := newSetup()
	fz := &fakeZotero{connected: true}
	s.zotero = fz
	if _, _, err := s.run(t); err != nil {
		t.Fatal(err)
	}
	if len(fz.queries) != 2 {
		t.Fatalf("zotero searches = %v, want the first two sub-questions", fz.queries)
	}
	found := 0
	for _, src := range s.reports.reports[0].Sources {
		if strings.HasPrefix(src.URL, "https://doi.org/10.9/") {
			found++
		}
	}
	if found == 0 {
		t.Fatal("no library item reached the report's sources")
	}
}

func TestNoZoteroLibraryNoCall(t *testing.T) {
	s := newSetup()
	fz := &fakeZotero{}
	s.zotero = fz
	if _, _, err := s.run(t); err != nil {
		t.Fatal(err)
	}
	if len(fz.queries) != 0 {
		t.Fatalf("searched a library that is not connected: %v", fz.queries)
	}
}

// The egress gate holds for the library as for the web.
func TestZoteroSearchIsGatedLikeTheWeb(t *testing.T) {
	s := newSetup()
	s.kbs = true
	fz := &fakeZotero{connected: true}
	s.zotero = fz
	if _, _, err := s.run(t); err != nil {
		t.Fatal(err)
	}
	if len(fz.queries) != 0 {
		t.Fatalf("the library was searched after the learner's documents were read: %v", fz.queries)
	}
}
