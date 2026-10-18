package tools

import (
	"context"
	"fmt"
	"strings"

	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/runtime"
)

// defaultSearchLimit and maxSearchLimit bound how much text one call can pull
// into context. The cap is not politeness: every chunk is untrusted text the
// model reads, so a model that asks for 200 chunks is asking to be steered by
// whichever document has the most aggressive instructions in it.
const (
	defaultSearchLimit = 8
	maxSearchLimit     = 20
)

// RAGSearch is `rag_search(kb_ids, query)` — the grounding tool.
type RAGSearch struct {
	retriever Retriever
	authz     Authorizer
}

// NewRAGSearch builds the tool.
func NewRAGSearch(r Retriever, a Authorizer) *RAGSearch {
	return &RAGSearch{retriever: r, authz: a}
}

// Name implements runtime.Tool.
func (t *RAGSearch) Name() string { return "rag_search" }

// NeedsNetwork implements runtime.Tool: retrieval is local to this deployment.
func (t *RAGSearch) NeedsNetwork() bool { return false }

// Definition implements runtime.Tool.
func (t *RAGSearch) Definition() runtime.ToolDefinition {
	return runtime.ToolDefinition{
		Type: "function",
		Function: runtime.ToolFunctionSchema{
			Name: t.Name(),
			Description: "Search the user's knowledge bases for passages relevant to a question. " +
				"Returns quoted document text, each with a citation id. " +
				"Quote nothing you did not receive here, and cite every claim you take from it.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{
						"type":        "string",
						"description": "What to look for, in the user's own words where possible.",
					},
					"kb_ids": map[string]any{
						"type":        "array",
						"items":       map[string]any{"type": "string"},
						"description": "Knowledge bases to search. Omit to search every knowledge base attached to this conversation.",
					},
					"limit": map[string]any{
						"type":        "integer",
						"description": fmt.Sprintf("How many passages to return (default %d, max %d).", defaultSearchLimit, maxSearchLimit),
					},
				},
				"required": []string{"query"},
			},
		},
	}
}

// Execute implements runtime.Tool.
func (t *RAGSearch) Execute(ctx context.Context, args map[string]any, in runtime.ToolInput) (runtime.ToolResult, error) {
	query := stringArg(args, "query")
	if query == "" {
		return toolError("rag_search needs a query"), nil
	}

	requested, err := uuidListArg(args, "kb_ids")
	if err != nil {
		return toolError("%s", err.Error()), nil
	}

	// THE GATE. Nothing below this line runs for an id the user does not own.
	kbIDs, refusal := authorizeKBs(ctx, t.authz, in, requested)
	if refusal != nil {
		return *refusal, nil
	}

	limit := defaultSearchLimit
	if n, ok := intArg(args, "limit"); ok && n > 0 {
		limit = min(n, maxSearchLimit)
	}

	chunks, err := t.retriever.Search(ctx, in.UserID, kbIDs, query, limit)
	if err != nil {
		return runtime.ToolResult{}, fmt.Errorf("rag_search: %w", err)
	}
	if len(chunks) == 0 {
		return runtime.ToolResult{
			Content: "No passage in the attached knowledge bases matched that query. " +
				"Say so plainly rather than answering from memory.",
		}, nil
	}

	parts := make([]string, 0, len(chunks))
	sources := make([]citations.Source, 0, len(chunks))
	for _, c := range chunks {
		label := c.DocumentTitle
		switch {
		case c.Seconds != nil:
			// A video: the time is the reference a learner can use.
			label = fmt.Sprintf("%s %s", c.DocumentTitle, clock(*c.Seconds))
		case c.Lines && c.Page > 0:
			// A repository's code file: its path and line range.
			label = fmt.Sprintf("%s lines %d-%d", c.DocumentTitle, c.Page, max(c.PageEnd, c.Page))
		case c.Sheet != "" && c.Page > 0:
			// A spreadsheet: the sheet is what a learner looks for.
			label = fmt.Sprintf("%s, Sheet: %s, p.%d", c.DocumentTitle, c.Sheet, c.Page)
		case c.Page > 0:
			label = fmt.Sprintf("%s p.%d", c.DocumentTitle, c.Page)
		}
		marker := citations.Format(citations.KindChunk, c.ID)
		body := c.Text + "\n\nCite this passage as " + marker
		parts = append(parts, Wrap(label, citations.KindChunk+":"+c.ID, body))

		sources = append(sources, citations.Source{
			Kind:         citations.KindChunk,
			ID:           c.ID,
			Title:        c.DocumentTitle,
			Page:         c.Page,
			DocumentID:   c.DocumentID,
			Seconds:      c.Seconds,
			AITranscript: c.AITranscript,
			LineEnd:      lineEnd(c),
			Sheet:        c.Sheet,
			PhotoModel:   c.PhotoModel,
		})
	}

	return runtime.ToolResult{
		Retrieved: true,
		Content: strings.Join([]string{
			fmt.Sprintf("%d passages, quoted verbatim from the user's documents:", len(parts)),
			WrapAll(parts),
		}, "\n\n"),
		Sources: sources,
	}, nil
}

// clock renders seconds as MM:SS, or H:MM:SS from an hour on.
func clock(sec int) string {
	if sec < 0 {
		sec = 0
	}
	if sec >= 3600 {
		return fmt.Sprintf("%d:%02d:%02d", sec/3600, sec%3600/60, sec%60)
	}
	return fmt.Sprintf("%02d:%02d", sec/60, sec%60)
}

// lineEnd is a code passage's last line for its citation, 0 otherwise.
func lineEnd(c Chunk) int {
	if !c.Lines || c.Page <= 0 {
		return 0
	}
	return max(c.PageEnd, c.Page)
}
