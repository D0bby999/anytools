package tools

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Web search result bounds. Every result is untrusted text the model reads, and
// the research pipeline is the only caller, so the cap is about how much of the
// open web one call may put in front of the model.
const (
	defaultWebResults = 5
	maxWebResults     = 10
)

// WebSearch is `web_search(query)` over the user's own Tavily or Brave key.
//
// It is a NETWORK tool, so the runtime's gate applies: it is not mounted in a
// turn whose context already holds retrieved document text unless the session
// allows the web. It is also registered for the research capability ONLY
// (runtime.OrchestratorDeps.CapabilityTools), so a chat turn never has it.
type WebSearch struct {
	searcher WebSearcher
}

// NewWebSearch builds the tool.
func NewWebSearch(s WebSearcher) *WebSearch { return &WebSearch{searcher: s} }

// Name implements runtime.Tool.
func (t *WebSearch) Name() string { return "web_search" }

// NeedsNetwork implements runtime.Tool.
func (t *WebSearch) NeedsNetwork() bool { return true }

// Definition implements runtime.Tool.
func (t *WebSearch) Definition() runtime.ToolDefinition {
	return runtime.ToolDefinition{
		Type: "function",
		Function: runtime.ToolFunctionSchema{
			Name: t.Name(),
			Description: "Search the web with the user's own search key. Returns quoted result snippets, " +
				"each with a citation id. Cite every claim you take from a result.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{"type": "string", "description": "The search query."},
					"limit": map[string]any{
						"type":        "integer",
						"description": fmt.Sprintf("How many results (default %d, max %d).", defaultWebResults, maxWebResults),
					},
				},
				"required": []string{"query"},
			},
		},
	}
}

// Execute implements runtime.Tool.
func (t *WebSearch) Execute(ctx context.Context, args map[string]any, in runtime.ToolInput) (runtime.ToolResult, error) {
	query := stringArg(args, "query")
	if query == "" {
		return toolError("web_search needs a query"), nil
	}
	limit := defaultWebResults
	if n, ok := intArg(args, "limit"); ok && n > 0 {
		limit = min(n, maxWebResults)
	}

	results, err := t.searcher.Search(ctx, in.UserID, query, limit)
	switch {
	case errors.Is(err, ErrNoSearchKey):
		return toolError("web search is not available: the user has not connected a search key"), nil
	case err != nil:
		if ctx.Err() != nil {
			return runtime.ToolResult{}, ctx.Err()
		}
		// A spent quota or a provider outage is something to report and work
		// around, not a reason to lose the whole report. The byok chain has
		// already benched the key.
		return toolError("the web search failed; continue with what you have"), nil
	}

	book := in.URLs
	if book == nil {
		book = citations.NewURLBook()
	}
	parts := make([]string, 0, len(results))
	sources := make([]citations.Source, 0, len(results))
	for _, r := range results {
		link, ok := webURL(r.URL)
		if !ok {
			continue
		}
		id := book.ID(link)
		title := strings.TrimSpace(r.Title)
		if title == "" {
			title = hostOf(link)
		}
		marker := citations.Format(citations.KindURL, id)
		body := r.Snippet + "\n\nCite this result as " + marker
		parts = append(parts, Wrap(title+" ("+hostOf(link)+")", citations.KindURL+":"+id, body))
		sources = append(sources, citations.Source{Kind: citations.KindURL, ID: id, Title: title, URL: link})
	}
	if len(parts) == 0 {
		return runtime.ToolResult{Content: "The web search returned nothing usable for that query."}, nil
	}
	return runtime.ToolResult{
		Content: fmt.Sprintf("%d web results, quoted from the pages' own summaries:", len(parts)) +
			"\n\n" + WrapAll(parts),
		Sources: sources,
		// Web text is untrusted, and is enveloped as such, but it is not the
		// user's document text: Retrieved stays false so a web result alone
		// does not close the network gate on itself.
	}, nil
}

// webURL accepts only absolute http(s) URLs. A search provider is a third
// party: a `javascript:` or `data:` URL in its response would otherwise become
// the href of a citation chip.
func webURL(raw string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
		return "", false
	}
	return u.String(), true
}

func hostOf(link string) string {
	if u, err := url.Parse(link); err == nil && u.Host != "" {
		return u.Hostname()
	}
	return link
}
