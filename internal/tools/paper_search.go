package tools

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/rag/papers"
	"github.com/D0bby999/anytools/internal/runtime"
)

// PaperSearcher finds scholarly works for a user: their own OpenAlex key, or
// their share of the keyless budget (internal/app).
type PaperSearcher interface {
	SearchPapers(ctx context.Context, userID uuid.UUID, query string, limit int) ([]papers.Paper, error)
}

// ErrPaperBudget is a user's keyless paper searches spent for the day.
var ErrPaperBudget = errors.New("the free paper-search budget for today is used up")

const maxPaperResults = 10

// PaperSearch is `paper_search(query)` (learning-depth phase 6).
//
// Like web_search it is a NETWORK tool, gated the same way, and registered
// for research only. Its results are cited as `url` sources pointing at the
// paper's landing page (the DOI or the arXiv abstract), marked academic and
// each its own site, so the report's ranker treats them as papers rather
// than as pages of doi.org.
type PaperSearch struct{ searcher PaperSearcher }

// NewPaperSearch builds the tool.
func NewPaperSearch(s PaperSearcher) *PaperSearch { return &PaperSearch{searcher: s} }

// Name implements runtime.Tool.
func (t *PaperSearch) Name() string { return "paper_search" }

// NeedsNetwork implements runtime.Tool.
func (t *PaperSearch) NeedsNetwork() bool { return true }

// Definition implements runtime.Tool.
func (t *PaperSearch) Definition() runtime.ToolDefinition {
	return runtime.ToolDefinition{
		Type: "function",
		Function: runtime.ToolFunctionSchema{
			Name: t.Name(),
			Description: "Search scholarly papers (OpenAlex, then arXiv). Returns each paper's title, authors, " +
				"year and abstract, each with a citation id. Cite every claim you take from a paper.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{"type": "string", "description": "The search query."},
					"limit": map[string]any{"type": "integer", "description": fmt.Sprintf("How many papers (max %d).", maxPaperResults)},
				},
				"required": []string{"query"},
			},
		},
	}
}

// Execute implements runtime.Tool.
func (t *PaperSearch) Execute(ctx context.Context, args map[string]any, in runtime.ToolInput) (runtime.ToolResult, error) {
	query := stringArg(args, "query")
	if query == "" {
		return toolError("paper_search needs a query"), nil
	}
	limit := 5
	if n, ok := intArg(args, "limit"); ok && n > 0 {
		limit = min(n, maxPaperResults)
	}
	found, err := t.searcher.SearchPapers(ctx, in.UserID, query, limit)
	switch {
	case errors.Is(err, ErrPaperBudget), errors.Is(err, papers.ErrLimited):
		return toolError("the free paper-search budget is used up; a free OpenAlex key in Settings raises it"), nil
	case err != nil:
		if ctx.Err() != nil {
			return runtime.ToolResult{}, ctx.Err()
		}
		return toolError("the paper search failed; continue with what you have"), nil
	}

	book := in.URLs
	if book == nil {
		book = citations.NewURLBook()
	}
	parts := make([]string, 0, len(found))
	sources := make([]citations.Source, 0, len(found))
	for _, p := range found {
		link, ok := webURL(p.URL)
		if !ok {
			continue
		}
		id := book.ID(link)
		marker := citations.Format(citations.KindURL, id)
		var body strings.Builder
		if len(p.Authors) > 0 {
			fmt.Fprintf(&body, "Authors: %s\n", strings.Join(p.Authors, ", "))
		}
		if p.Year > 0 {
			fmt.Fprintf(&body, "Year: %d · cited %d times\n", p.Year, p.Citations)
		}
		if p.Abstract != "" {
			fmt.Fprintf(&body, "Abstract: %s\n", p.Abstract)
		}
		body.WriteString("\nCite this paper as " + marker)
		label := p.Title
		if p.Year > 0 {
			label = fmt.Sprintf("%s (%d)", p.Title, p.Year)
		}
		parts = append(parts, Wrap(label, citations.KindURL+":"+id, body.String()))
		sources = append(sources, citations.Source{
			Kind: citations.KindURL, ID: id, Title: p.Title, URL: link,
			Authority: "academic", Site: p.Source + ":" + p.ID,
		})
	}
	if len(parts) == 0 {
		return runtime.ToolResult{Content: "The paper search returned nothing for that query."}, nil
	}
	return runtime.ToolResult{
		Content: fmt.Sprintf("%d papers, with their abstracts as the sources give them:", len(parts)) + "\n\n" + WrapAll(parts),
		Sources: sources,
	}, nil
}
