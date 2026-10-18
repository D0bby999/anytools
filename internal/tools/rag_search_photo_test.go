package tools

import (
	"context"
	"testing"
)

// A passage read from a photo carries the model that read it on its source,
// for the chip (up-methods phase 16).
func TestRAGSearchCarriesThePhotoReader(t *testing.T) {
	f := newFixture()
	f.retriever.chunks = []Chunk{
		{ID: "c1", DocumentID: f.ownDoc.String(), DocumentTitle: "IMG_2041.jpg", Page: 2, PhotoModel: "gemini-3.6-flash", Text: "notes"},
		{ID: "c2", DocumentID: f.ownDoc.String(), DocumentTitle: "Notes.pdf", Page: 4, Text: "prose"},
	}
	res, err := NewRAGSearch(f.retriever, f.authz).Execute(
		context.Background(), map[string]any{"query": "notes"}, f.input())
	if err != nil || res.IsError {
		t.Fatalf("Execute: %v %+v", err, res)
	}
	if len(res.Sources) != 2 || res.Sources[0].PhotoModel != "gemini-3.6-flash" || res.Sources[1].PhotoModel != "" {
		t.Fatalf("sources = %+v; the chip needs the photo's reader on photo passages only", res.Sources)
	}
}
