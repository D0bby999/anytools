package tools

import (
	"context"
	"strings"
	"testing"
)

// Up-methods phase 18: a passage of a repository's code file is labelled and
// cited by its path and line range, not by a page.
func TestACodePassageIsCitedByLineRange(t *testing.T) {
	f := newFixture()
	f.retriever.chunks = []Chunk{{
		ID: "chunk-code", DocumentID: f.ownDoc.String(), DocumentTitle: "internal/app/wire.go",
		Page: 40, PageEnd: 72, Lines: true, Text: "func Build() {}",
	}}
	res, err := NewRAGSearch(f.retriever, f.authz).Execute(context.Background(),
		map[string]any{"query": "build"}, f.input())
	if err != nil || res.IsError {
		t.Fatalf("search: %+v %v", res, err)
	}
	if !strings.Contains(res.Content, "internal/app/wire.go lines 40-72") {
		t.Fatalf("label: %s", res.Content)
	}
	if len(res.Sources) != 1 || res.Sources[0].Page != 40 || res.Sources[0].LineEnd != 72 {
		t.Fatalf("source: %+v", res.Sources)
	}
	// A page passage carries no line range.
	f.retriever.chunks[0].Lines = false
	res, _ = NewRAGSearch(f.retriever, f.authz).Execute(context.Background(), map[string]any{"query": "build"}, f.input())
	if res.Sources[0].LineEnd != 0 || !strings.Contains(res.Content, "p.40") {
		t.Fatalf("page passage: %+v", res.Sources[0])
	}
}
