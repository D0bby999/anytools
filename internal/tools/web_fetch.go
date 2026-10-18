package tools

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	readability "github.com/go-shiori/go-readability"

	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/security"
)

// Web fetch limits.
//
// MaxFetchBytes is security.MaxFetchBytes, the 5 MB cap security.FetchPage
// enforces while reading rather than by trusting Content-Length. maxFetchRunes bounds what
// reaches the model: a readable article is rarely longer, and an untrusted page
// that is longer is mostly an opportunity to steer.
const (
	MaxFetchBytes = security.MaxFetchBytes
	maxFetchRunes = 24_000
	fetchTimeout  = 20 * time.Second
)

// WebFetch is `web_fetch(url)`: one page, reduced to its readable text.
//
// Three fences, from the outside in:
//
//  1. It is a network tool registered for research only, behind the runtime's
//     gate (see WebSearch).
//  2. Inside a research turn it opens only pages that turn's own web search
//     returned (runtime.ToolInput.URLs). A model — or a page it read — cannot
//     name a fresh URL with a user's data in its query string and have this
//     tool deliver it.
//  3. Every dial goes through security.FetchClient: resolve, refuse if any
//     record is internal, dial the address that was checked, and do it again on
//     every redirect hop.
type WebFetch struct {
	client *http.Client
}

// NewWebFetch builds the tool. A nil client is the production one,
// security.FetchClient; tests pass a client aimed at a fixture server.
func NewWebFetch(client *http.Client) *WebFetch {
	if client == nil {
		client = security.FetchClient(fetchTimeout)
	}
	return &WebFetch{client: client}
}

// Name implements runtime.Tool.
func (t *WebFetch) Name() string { return "web_fetch" }

// NeedsNetwork implements runtime.Tool.
func (t *WebFetch) NeedsNetwork() bool { return true }

// Definition implements runtime.Tool.
func (t *WebFetch) Definition() runtime.ToolDefinition {
	return runtime.ToolDefinition{
		Type: "function",
		Function: runtime.ToolFunctionSchema{
			Name: t.Name(),
			Description: "Read one web page returned by web_search in this conversation. " +
				"Returns the page's readable text, quoted, with a citation id.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url": map[string]any{"type": "string", "description": "A URL web_search returned."},
				},
				"required": []string{"url"},
			},
		},
	}
}

// Execute implements runtime.Tool.
func (t *WebFetch) Execute(ctx context.Context, args map[string]any, in runtime.ToolInput) (runtime.ToolResult, error) {
	raw := stringArg(args, "url")
	link, ok := webURL(raw)
	if !ok {
		return toolError("web_fetch needs an http or https URL"), nil
	}
	if in.URLs != nil && !in.URLs.Has(link) {
		return toolError("only pages returned by this conversation's web search can be read"), nil
	}
	if _, err := security.CheckFetchURL(link); err != nil {
		return toolError("that address cannot be fetched"), nil
	}

	page, err := t.fetch(ctx, link)
	if err != nil {
		if ctx.Err() != nil {
			return runtime.ToolResult{}, ctx.Err()
		}
		// The reason is for the model, not the user; it never carries the
		// page's body, only what went wrong with it.
		return toolError("could not read that page: %s", fetchReason(err)), nil
	}

	book := in.URLs
	if book == nil {
		book = citations.NewURLBook()
	}
	id := book.ID(link)
	title := page.title
	if title == "" {
		title = hostOf(link)
	}
	marker := citations.Format(citations.KindURL, id)
	return runtime.ToolResult{
		Content: Wrap(title+" ("+hostOf(link)+")", citations.KindURL+":"+id,
			page.text+"\n\nCite this page as "+marker),
		Sources: []citations.Source{{Kind: citations.KindURL, ID: id, Title: title, URL: link}},
	}, nil
}

type fetchedPage struct{ title, text string }

var (
	errTooLarge    = security.ErrPageTooLarge
	errContentType = errors.New("the page is not HTML or text")
	errEmpty       = errors.New("the page has no readable text")
)

// fetchTypes are what a research turn may read: pages and plain text. A PDF
// is refused here (the Knowledge Center's "Add a link" is where a PDF goes).
var fetchTypes = []string{"text/html", "application/xhtml+xml", "text/plain", "text/markdown", ""}

func (t *WebFetch) fetch(ctx context.Context, link string) (fetchedPage, error) {
	// The size cap, the type check and the status check are security.FetchPage's:
	// one implementation shared with the Knowledge Center's web links.
	got, err := security.FetchPage(ctx, t.client, security.PageRequest{
		URL:       link,
		Accept:    "text/html,application/xhtml+xml,text/plain;q=0.9",
		UserAgent: "AnyTools-Research/1.0",
		Types:     fetchTypes,
	})
	if errors.Is(err, security.ErrPageType) {
		return fetchedPage{}, errContentType
	}
	if err != nil {
		return fetchedPage{}, err
	}
	mediaType, body := got.MediaType, got.Body

	var page fetchedPage
	if mediaType == "text/plain" || mediaType == "text/markdown" {
		page.text = strings.TrimSpace(string(body))
	} else {
		// The reader-mode algorithm the Knowledge Center uses for saved HTML
		// (internal/rag/parse/local_web.go): a page is mostly navigation, and
		// quoting the navigation is quoting noise.
		article, err := readability.FromReader(bytes.NewReader(body), got.FinalURL)
		if err == nil {
			page.title = strings.TrimSpace(article.Title)
			page.text = strings.TrimSpace(article.TextContent)
		}
	}
	if page.text == "" {
		return fetchedPage{}, errEmpty
	}
	page.text = truncateRunes(collapseBlank(page.text), maxFetchRunes)
	return page, nil
}

// fetchReason names a failure without echoing anything the site sent.
func fetchReason(err error) string {
	switch {
	case errors.Is(err, errTooLarge), errors.Is(err, errContentType), errors.Is(err, errEmpty):
		return err.Error()
	case security.IsInternalAddress(err):
		return "the address is not on the public internet"
	case strings.Contains(err.Error(), "HTTP "):
		return err.Error()
	default:
		return "the site could not be reached"
	}
}

func collapseBlank(s string) string {
	lines := strings.Split(s, "\n")
	out := make([]string, 0, len(lines))
	blank := false
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l == "" {
			if !blank && len(out) > 0 {
				out = append(out, "")
			}
			blank = true
			continue
		}
		blank = false
		out = append(out, l)
	}
	return strings.Join(out, "\n")
}

// truncateRunes cuts on a rune boundary: the text lands in a `text` column via
// the event log, and Postgres refuses a split multi-byte sequence.
func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}
