package tools

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/connectors/zotero"
	"github.com/D0bby999/anytools/internal/runtime"
)

// ZoteroSearcher searches the user's own Zotero library on their own key
// (internal/app). Connected says whether they have added one.
type ZoteroSearcher interface {
	Connected(ctx context.Context, userID uuid.UUID) (bool, error)
	SearchZotero(ctx context.Context, userID uuid.UUID, query string, limit int) ([]zotero.Item, error)
}

// ErrNoZotero is a user with no Zotero key.
var ErrNoZotero = errors.New("no Zotero library is connected")

const maxZoteroResults = 10

// scholarlyTypes are the Zotero item types ranked as academic sources.
var scholarlyTypes = map[string]bool{
	"journalArticle": true, "conferencePaper": true, "book": true, "bookSection": true,
	"thesis": true, "report": true, "preprint": true, "manuscript": true,
}

// ZoteroSearch is `zotero_search(query)` (up-methods phase 20), DeepTutor's
// tools/zotero_search.py: the learner's own library, searched by title,
// creator and year, top-level items only.
//
// Like paper_search it is a NETWORK tool, gated the same way, registered for
// research only, and spends nothing but the research turn's own budget: the
// call is on the learner's key, with no allowance of its own. Each item is
// enveloped as untrusted text — an abstract in a library is a stranger's
// words — and cited as a `url` source: its DOI, its own link, or the item in
// the learner's web library.
type ZoteroSearch struct{ searcher ZoteroSearcher }

// NewZoteroSearch builds the tool.
func NewZoteroSearch(s ZoteroSearcher) *ZoteroSearch { return &ZoteroSearch{searcher: s} }

// Name implements runtime.Tool.
func (t *ZoteroSearch) Name() string { return "zotero_search" }

// NeedsNetwork implements runtime.Tool.
func (t *ZoteroSearch) NeedsNetwork() bool { return true }

// Connected reports whether the user has a Zotero library to search, so a
// pipeline can skip the tool rather than call it to be told.
func (t *ZoteroSearch) Connected(ctx context.Context, userID uuid.UUID) bool {
	if t.searcher == nil {
		return false
	}
	ok, err := t.searcher.Connected(ctx, userID)
	return err == nil && ok
}

// Definition implements runtime.Tool.
func (t *ZoteroSearch) Definition() runtime.ToolDefinition {
	return runtime.ToolDefinition{
		Type: "function",
		Function: runtime.ToolFunctionSchema{
			Name: t.Name(),
			Description: "Search the learner's own Zotero library by title, creator and year. Returns each item's " +
				"title, creators, year and abstract, each with a citation id. Cite every claim you take from an item.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{"type": "string", "description": "The search query."},
					"limit": map[string]any{"type": "integer", "description": fmt.Sprintf("How many items (max %d).", maxZoteroResults)},
				},
				"required": []string{"query"},
			},
		},
	}
}

// Execute implements runtime.Tool.
func (t *ZoteroSearch) Execute(ctx context.Context, args map[string]any, in runtime.ToolInput) (runtime.ToolResult, error) {
	query := stringArg(args, "query")
	if query == "" {
		return toolError("zotero_search needs a query"), nil
	}
	limit := 5
	if n, ok := intArg(args, "limit"); ok && n > 0 {
		limit = min(n, maxZoteroResults)
	}
	found, err := t.searcher.SearchZotero(ctx, in.UserID, query, limit)
	switch {
	case errors.Is(err, ErrNoZotero):
		return toolError("no Zotero library is connected; continue with what you have"), nil
	case err != nil:
		if ctx.Err() != nil {
			return runtime.ToolResult{}, ctx.Err()
		}
		return toolError("the Zotero search failed; continue with what you have"), nil
	}

	book := in.URLs
	if book == nil {
		book = citations.NewURLBook()
	}
	parts := make([]string, 0, len(found))
	sources := make([]citations.Source, 0, len(found))
	for _, it := range found {
		link, ok := zoteroLink(it)
		if !ok {
			continue
		}
		id := book.ID(link)
		marker := citations.Format(citations.KindURL, id)
		var body strings.Builder
		fmt.Fprintf(&body, "Type: %s\n", it.ItemType)
		if len(it.Creators) > 0 {
			fmt.Fprintf(&body, "Creators: %s\n", strings.Join(it.Creators, ", "))
		}
		if it.Year != "" {
			fmt.Fprintf(&body, "Year: %s\n", it.Year)
		}
		if it.Publication != "" {
			fmt.Fprintf(&body, "Published in: %s\n", it.Publication)
		}
		if it.Abstract != "" {
			fmt.Fprintf(&body, "Abstract: %s\n", it.Abstract)
		}
		body.WriteString("\nCite this item as " + marker)
		label := it.Title
		if it.Year != "" {
			label = fmt.Sprintf("%s (%s)", it.Title, it.Year)
		}
		parts = append(parts, Wrap(label, citations.KindURL+":"+id, body.String()))
		src := citations.Source{Kind: citations.KindURL, ID: id, Title: it.Title, URL: link, Site: "zotero:" + it.Key}
		if scholarlyTypes[it.ItemType] {
			src.Authority = "academic"
		}
		sources = append(sources, src)
	}
	if len(parts) == 0 {
		return runtime.ToolResult{Content: "The Zotero library has nothing for that query."}, nil
	}
	return runtime.ToolResult{
		Content: fmt.Sprintf("%d items from the learner's Zotero library, as the library gives them:", len(parts)) +
			"\n\n" + WrapAll(parts),
		Sources: sources,
	}, nil
}

// zoteroLink is where a cited item can be read: its DOI, its own link, or
// the item in the learner's web library.
func zoteroLink(it zotero.Item) (string, bool) {
	if doi := strings.TrimSpace(it.DOI); doi != "" && !strings.ContainsAny(doi, " \t\n<>\"") {
		if link, ok := webURL("https://doi.org/" + strings.TrimPrefix(strings.TrimPrefix(doi, "https://doi.org/"), "doi:")); ok {
			return link, true
		}
	}
	if link, ok := webURL(it.URL); ok {
		return link, true
	}
	return webURL(it.WebURL)
}
