package tools

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/runtime"
)

// ReadSource is `read_source(document_id, page)` — the tool that reads a whole
// page when a retrieved chunk was not enough context.
type ReadSource struct {
	reader SourceReader
	authz  Authorizer
}

// NewReadSource builds the tool.
func NewReadSource(r SourceReader, a Authorizer) *ReadSource { return &ReadSource{reader: r, authz: a} }

// Name implements runtime.Tool.
func (t *ReadSource) Name() string { return "read_source" }

// NeedsNetwork implements runtime.Tool.
func (t *ReadSource) NeedsNetwork() bool { return false }

// Definition implements runtime.Tool.
func (t *ReadSource) Definition() runtime.ToolDefinition {
	return runtime.ToolDefinition{
		Type: "function",
		Function: runtime.ToolFunctionSchema{
			Name: t.Name(),
			Description: "Read one full page of a document the user owns, when a search result was " +
				"too short to answer from. Returns quoted document text.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"document_id": map[string]any{
						"type":        "string",
						"description": "The document id, as it appeared in a search result.",
					},
					"page": map[string]any{
						"type":        "integer",
						"description": "1-based page number.",
					},
				},
				"required": []string{"document_id", "page"},
			},
		},
	}
}

// Execute implements runtime.Tool.
func (t *ReadSource) Execute(ctx context.Context, args map[string]any, in runtime.ToolInput) (runtime.ToolResult, error) {
	raw := stringArg(args, "document_id")
	docID, err := uuid.Parse(raw)
	if err != nil {
		return toolError("%s", noDocumentMessage), nil
	}

	page, ok := intArg(args, "page")
	if !ok || page < 1 {
		return toolError("read_source needs a 1-based page number"), nil
	}

	// THE GATE. A document id is the most guessable resource id in the product
	// — it appears in every citation chip and in the viewer URL — so ownership
	// is checked here even though the reader also scopes by user.
	owns, err := t.authz.OwnsDocument(ctx, in.UserID, docID)
	if err != nil {
		return toolError("could not check access to that document"), nil
	}
	if !owns {
		return toolError("%s", noDocumentMessage), nil
	}

	p, err := t.reader.ReadPage(ctx, in.UserID, docID, page)
	if errors.Is(err, ErrNotFound) {
		return toolError("%s", noDocumentMessage), nil
	}
	if err != nil {
		return runtime.ToolResult{}, fmt.Errorf("read_source: %w", err)
	}
	if p.Text == "" {
		if p.PageCount > 0 {
			return toolError("that page is empty; the document has %d pages", p.PageCount), nil
		}
		return toolError("that page is empty"), nil
	}

	// The separator must stay inside the citation marker's id charset
	// (internal/citations/parse.go, and the identical regex in the UI). `#` is
	// NOT in it: an id built with one produces a marker the parser never
	// matches, so it is never validated, never dropped and never rendered as a
	// chip — it survives as literal `[[cite:chunk:…]]` in the answer AND in the
	// stored transcript. `.` is in the charset, and citations_test.go
	// round-trips every id this package mints.
	id := citations.PageRef(p.DocumentID, p.Page)
	return runtime.ToolResult{
		Retrieved: true,
		Content:   Wrap(fmt.Sprintf("%s p.%d", p.Title, p.Page), id, p.Text),
		Sources: []citations.Source{{
			Kind:       citations.KindChunk,
			ID:         id,
			Title:      p.Title,
			Page:       p.Page,
			DocumentID: p.DocumentID,
		}},
	}, nil
}
