package search

import (
	"context"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/D0bby999/anytools/internal/security"
)

// duckduckgo.go — the keyless fallback. With no Tavily or Brave key, or when
// every key the user has fails, research searches DuckDuckGo's HTML page so a
// learner without a paid search key still gets web sources.
//
// It is not a platform key: nothing is shared and nothing is billed. It is
// also not an API. DuckDuckGo publishes no search API, and this reads the
// no-JavaScript results page the way postclaw does
// (internal/research/searcher_ddg.go), so it can break when the page changes
// or be rate-limited from a busy address. It is therefore always the LAST
// choice, the report says when it was used, and an operator can turn it off
// with ANYTOOLS_KEYLESS_SEARCH=0.

// ProviderDuckDuckGo names the keyless fallback. Never stored: there is no key.
const ProviderDuckDuckGo = "duckduckgo"

const ddgEndpoint = "https://html.duckduckgo.com/html/"

var (
	// One result block; results are split on it so a result without a
	// snippet cannot shift every later snippet onto the wrong link.
	ddgBlockRe   = regexp.MustCompile(`class="result results_links[^"]*"`)
	ddgLinkRe    = regexp.MustCompile(`<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>`)
	ddgSnippetRe = regexp.MustCompile(`<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)</a>`)
	ddgTagRe     = regexp.MustCompile(`<[^>]+>`)
)

// DuckDuckGoClient reads DuckDuckGo's HTML results page.
type DuckDuckGoClient struct {
	hc       *http.Client
	endpoint string
}

// NewDuckDuckGo builds the keyless client.
func NewDuckDuckGo() *DuckDuckGoClient {
	return &DuckDuckGoClient{hc: security.SafeClient(searchTimeout), endpoint: ddgEndpoint}
}

func (c *DuckDuckGoClient) Name() string { return ProviderDuckDuckGo }

// Search fetches one results page and keeps up to maxResults organic results.
func (c *DuckDuckGoClient) Search(ctx context.Context, query string, maxResults int) ([]Result, error) {
	if strings.TrimSpace(query) == "" {
		return nil, fmt.Errorf("duckduckgo: empty query")
	}
	target := c.endpoint + "?q=" + url.QueryEscape(query)
	if f := FreshnessFrom(ctx); f != "" {
		target += "&df=" + f[:1] // d / w / m / y
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; AnyTools-Research/1.0)")
	req.Header.Set("Accept", "text/html")
	body, err := do(c.hc, req)
	if err != nil {
		return nil, err
	}
	results := parseDuckDuckGo(string(body), maxResults)
	if len(results) == 0 && strings.Contains(string(body), "anomaly") {
		// DuckDuckGo's bot check. Reported as a failure, not as "no results",
		// so the caller says the web search failed rather than that the web
		// has nothing on the topic.
		return nil, fmt.Errorf("duckduckgo: the request was challenged as automated")
	}
	return results, nil
}

// Ping is a real one-result search.
func (c *DuckDuckGoClient) Ping(ctx context.Context) error {
	_, err := c.Search(ctx, "anytools", 1)
	return err
}

// parseDuckDuckGo extracts organic results from the HTML page.
func parseDuckDuckGo(page string, maxResults int) []Result {
	if maxResults <= 0 {
		maxResults = 5
	}
	idx := ddgBlockRe.FindAllStringIndex(page, -1)
	out := make([]Result, 0, maxResults)
	for i, loc := range idx {
		if len(out) >= maxResults {
			break
		}
		end := len(page)
		if i+1 < len(idx) {
			end = idx[i+1][0]
		}
		block := page[loc[0]:end]
		if strings.Contains(page[loc[0]:loc[1]], "result--ad") {
			continue
		}
		m := ddgLinkRe.FindStringSubmatch(block)
		if m == nil {
			continue
		}
		link := ddgTarget(html.UnescapeString(m[1]))
		if link == "" {
			continue
		}
		r := Result{Title: cleanText(m[2]), URL: link}
		if s := ddgSnippetRe.FindStringSubmatch(block); s != nil {
			r.Snippet = cleanText(s[1])
		}
		out = append(out, r)
	}
	return out
}

// ddgTarget unwraps DuckDuckGo's redirect (//duckduckgo.com/l/?uddg=<url>)
// and keeps only http(s) targets.
func ddgTarget(raw string) string {
	if strings.HasPrefix(raw, "//") {
		raw = "https:" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if target := u.Query().Get("uddg"); target != "" {
		if t, err := url.Parse(target); err == nil {
			u = t
		}
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}
	if strings.HasSuffix(u.Hostname(), "duckduckgo.com") {
		return "" // an internal link, e.g. an ad click-through
	}
	return u.String()
}

func cleanText(s string) string {
	return strings.Join(strings.Fields(html.UnescapeString(ddgTagRe.ReplaceAllString(s, ""))), " ")
}
