package tools

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Documents the learner pointed at (`@`, plan 261021-1100 phase 2): a search
// returns only their passages, still in rank order and up to the limit.
func TestRAGSearchKeepsOnlyTheDocumentsPointedAt(t *testing.T) {
	f := newFixture()
	other := uuid.New()
	f.retriever.chunks = []Chunk{
		{ID: "c1", DocumentID: other.String(), DocumentTitle: "Other.pdf", Text: "first"},
		{ID: "c2", DocumentID: f.ownDoc.String(), DocumentTitle: "Mine.pdf", Text: "second"},
		{ID: "c3", DocumentID: other.String(), DocumentTitle: "Other.pdf", Text: "third"},
		{ID: "c4", DocumentID: f.ownDoc.String(), DocumentTitle: "Mine.pdf", Text: "fourth"},
	}
	in := f.input()
	in.DocumentIDs = []uuid.UUID{f.ownDoc}
	res, err := NewRAGSearch(f.retriever, f.authz).Execute(context.Background(), map[string]any{"query": "x", "limit": 1}, in)
	if err != nil || res.IsError {
		t.Fatalf("Execute: %v %+v", err, res)
	}
	if len(res.Sources) != 1 || res.Sources[0].ID != "c2" {
		t.Fatalf("sources = %+v, want only c2", res.Sources)
	}

	in.DocumentIDs = []uuid.UUID{uuid.New()}
	res, _ = NewRAGSearch(f.retriever, f.authz).Execute(context.Background(), map[string]any{"query": "x"}, in)
	if len(res.Sources) != 0 || !strings.Contains(res.Content, "documents the learner pointed at") {
		t.Fatalf("no passage of the picked documents must say so, not fall back: %+v", res)
	}
}
