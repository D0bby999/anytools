// Package search is AnyTools' web-search seam: the user's own Tavily or Brave
// key, or nothing at all.
//
// There is no platform search key. The plan originally carried a system Tavily
// key and red-team RT-13 cut it: a shared key is a shared quota with no
// accounting, and it contradicts the product's one hard rule. With no key,
// research runs against the knowledge base only and readiness says so in those
// words.
package search

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/security"
)

// Providers AnyTools knows how to call. Stored in search_connections.provider
// and pinned by the migration's CHECK.
const (
	ProviderTavily = "tavily"
	ProviderBrave  = "brave"
)

const searchTimeout = 30 * time.Second

// The providers' endpoints. They are fields on each client, defaulted from
// these, so a recorded-HTTP test can aim the real request-building and
// response-parsing code at a fixture server. Nothing in production sets them.
const (
	tavilyEndpoint = "https://api.tavily.com/search"
	braveEndpoint  = "https://api.search.brave.com/res/v1/web/search"
)

// Result is one web result.
type Result struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

// Client is a web-search backend.
type Client interface {
	Name() string
	Search(ctx context.Context, query string, maxResults int) ([]Result, error)
	// Ping is the verify probe: a real one-result search, because a key that
	// authenticates but has no quota left is not a working key.
	Ping(ctx context.Context) error
}

// New builds the client for a provider. Unknown providers are an error rather
// than a nil client, so a value that slipped past the database CHECK fails
// loudly at the seam instead of as a nil dereference in phase 9.
func New(provider, secret string) (Client, error) {
	switch provider {
	case ProviderTavily:
		return &TavilyClient{apiKey: secret, hc: security.SafeClient(searchTimeout), endpoint: tavilyEndpoint}, nil
	case ProviderBrave:
		return &BraveClient{apiKey: secret, hc: security.SafeClient(searchTimeout), endpoint: braveEndpoint}, nil
	default:
		return nil, fmt.Errorf("search: unknown provider %q", provider)
	}
}

// TavilyClient calls Tavily's /search endpoint.
type TavilyClient struct {
	apiKey   string
	hc       *http.Client
	endpoint string
}

func (c *TavilyClient) Name() string { return ProviderTavily }

func (c *TavilyClient) Search(ctx context.Context, query string, maxResults int) ([]Result, error) {
	if maxResults <= 0 {
		maxResults = 5
	}
	body, _ := json.Marshal(map[string]any{
		"api_key":     c.apiKey,
		"query":       query,
		"max_results": maxResults,
	})
	if f := FreshnessFrom(ctx); f != "" {
		// Tavily's time_range takes the same four words.
		var m map[string]any
		_ = json.Unmarshal(body, &m)
		m["time_range"] = f
		body, _ = json.Marshal(m)
	}
	raw, err := c.post(ctx, c.endpoint, body)
	if err != nil {
		return nil, err
	}
	var r struct {
		Results []struct {
			Title   string `json:"title"`
			URL     string `json:"url"`
			Content string `json:"content"`
		} `json:"results"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("tavily: decode response: %w", err)
	}
	out := make([]Result, 0, len(r.Results))
	for _, item := range r.Results {
		out = append(out, Result{Title: item.Title, URL: item.URL, Snippet: item.Content})
	}
	return out, nil
}

func (c *TavilyClient) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	results, err := c.Search(ctx, "anytools verify", 1)
	if err != nil {
		return err
	}
	if len(results) == 0 {
		return fmt.Errorf("tavily: verify search returned no results")
	}
	return nil
}

func (c *TavilyClient) post(ctx context.Context, endpoint string, body []byte) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return do(c.hc, req)
}

// BraveClient calls Brave's Web Search API.
type BraveClient struct {
	apiKey   string
	hc       *http.Client
	endpoint string
}

func (c *BraveClient) Name() string { return ProviderBrave }

func (c *BraveClient) Search(ctx context.Context, query string, maxResults int) ([]Result, error) {
	if maxResults <= 0 {
		maxResults = 5
	}
	endpoint := c.endpoint + "?q=" + url.QueryEscape(query) + "&count=" + fmt.Sprint(maxResults)
	if f := FreshnessFrom(ctx); f != "" {
		// Brave: pd / pw / pm / py.
		endpoint += "&freshness=p" + f[:1]
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Subscription-Token", c.apiKey)

	raw, err := do(c.hc, req)
	if err != nil {
		return nil, err
	}
	var r struct {
		Web struct {
			Results []struct {
				Title       string `json:"title"`
				URL         string `json:"url"`
				Description string `json:"description"`
			} `json:"results"`
		} `json:"web"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("brave: decode response: %w", err)
	}
	out := make([]Result, 0, len(r.Web.Results))
	for _, item := range r.Web.Results {
		out = append(out, Result{Title: item.Title, URL: item.URL, Snippet: item.Description})
	}
	return out, nil
}

func (c *BraveClient) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	results, err := c.Search(ctx, "anytools verify", 1)
	if err != nil {
		return err
	}
	if len(results) == 0 {
		return fmt.Errorf("brave: verify search returned no results")
	}
	return nil
}

// do sends the request and turns a non-200 into providers.HTTPError, so a
// search failure classifies through the same cooldown rules as everything else.
func do(hc *http.Client, req *http.Request) ([]byte, error) {
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("search request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("read search response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		body := string(raw)
		if len(body) > 400 {
			body = body[:400] + "…"
		}
		return nil, &providers.HTTPError{
			Status:     resp.StatusCode,
			Body:       body,
			RetryAfter: providers.ParseRetryAfter(resp.Header.Get("Retry-After")),
		}
	}
	return raw, nil
}
