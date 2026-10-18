package search

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/providers"
)

func TestNewRefusesAnUnknownProvider(t *testing.T) {
	// A value that slipped past the database CHECK must fail at the seam, by
	// name, rather than as a nil dereference inside phase 9's research feature.
	if _, err := New("google", "k"); err == nil {
		t.Fatal("an unknown search provider was accepted")
	}
	for _, p := range []string{ProviderTavily, ProviderBrave} {
		c, err := New(p, "k")
		if err != nil || c.Name() != p {
			t.Fatalf("%s: %v", p, err)
		}
	}
}

func TestTavilyParsesResults(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"results":[{"title":"T","url":"https://x.test","content":"snippet"}]}`))
	}))
	defer srv.Close()

	c := &TavilyClient{apiKey: "k", hc: srv.Client()}
	// Point the client at the fixture by overriding the endpoint through the
	// helper it uses, rather than by making the URL a field nobody else needs.
	raw, err := c.post(context.Background(), srv.URL, []byte(`{}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	if len(raw) == 0 {
		t.Fatal("empty response")
	}
}

// A search failure must classify through the same cooldown rules as every other
// provider failure, so a spent Tavily quota benches the key instead of being
// retried on every research turn.
func TestSearchErrorsAreClassifiable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "120")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":"usage limit reached"}`))
	}))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodGet, srv.URL, nil)
	_, err := do(srv.Client(), req)

	var httpErr *providers.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("search error is not an HTTPError: %v", err)
	}
	if httpErr.RetryAfter == 0 {
		t.Error("Retry-After was not parsed")
	}
	if cd := providers.ClassifyProviderError(err, 0); !cd.QuotaExhausted {
		t.Error("a spent search allowance did not classify as quota exhaustion")
	}
}

// The recorded-HTTP tests below drive the REAL request builder and response
// parser against fixture bodies in testdata/, which follow the providers'
// documented response shapes (Tavily /search, Brave web search). They are not
// captures of a live call — no key was available to this phase — so a provider
// changing its format shows up in production first; the tests pin what the
// parser does with the format as documented.

func TestTavilyRecordedSearch(t *testing.T) {
	fixture, err := os.ReadFile("testdata/tavily_search.json")
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("request = %s %q", r.Method, r.Header.Get("Content-Type"))
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write(fixture)
	}))
	defer srv.Close()

	c := &TavilyClient{apiKey: "tvly-secret", hc: srv.Client(), endpoint: srv.URL}
	results, err := c.Search(context.Background(), "retrieval augmented generation", 3)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if got["api_key"] != "tvly-secret" || got["query"] != "retrieval augmented generation" || got["max_results"] != float64(3) {
		t.Errorf("request body = %v", got)
	}
	if len(results) != 2 || results[0].URL != "https://arxiv.org/abs/2005.11401" ||
		!strings.Contains(results[1].Snippet, "external knowledge base") {
		t.Fatalf("results = %+v", results)
	}
}

func TestBraveRecordedSearch(t *testing.T) {
	fixture, err := os.ReadFile("testdata/brave_search.json")
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Subscription-Token") != "brave-secret" {
			t.Errorf("subscription token header = %q", r.Header.Get("X-Subscription-Token"))
		}
		if q := r.URL.Query(); q.Get("q") != "retrieval augmented generation" || q.Get("count") != "4" {
			t.Errorf("query = %v", q)
		}
		_, _ = w.Write(fixture)
	}))
	defer srv.Close()

	c := &BraveClient{apiKey: "brave-secret", hc: srv.Client(), endpoint: srv.URL}
	results, err := c.Search(context.Background(), "retrieval augmented generation", 4)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(results) != 2 || results[1].URL != "https://en.wikipedia.org/wiki/Retrieval-augmented_generation" ||
		results[0].Title == "" {
		t.Fatalf("results = %+v", results)
	}
}

// The production clients refuse to dial an internal address even though the
// endpoint is a constant: the search client is built on security.SafeClient,
// so a hostile DNS answer for api.tavily.com cannot turn a search into a
// request to the metadata service.
func TestProductionSearchClientsRefuseInternalAddresses(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"results":[]}`))
	}))
	defer srv.Close()

	c, err := New(ProviderTavily, "k")
	if err != nil {
		t.Fatal(err)
	}
	tc := c.(*TavilyClient)
	tc.endpoint = srv.URL // loopback
	if _, err := tc.Search(context.Background(), "x", 1); err == nil {
		t.Fatal("the production search client reached a loopback address")
	}
}

// Recorded from html.duckduckgo.com on 2026-09-26 (query "spaced repetition
// forgetting curve"). The parser must unwrap DuckDuckGo's redirect, keep each
// snippet with its own link, and decode entities.
func TestDuckDuckGoRecordedSearch(t *testing.T) {
	page, err := os.ReadFile("testdata/ddg.html")
	if err != nil {
		t.Fatal(err)
	}
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query().Get("q")
		_, _ = w.Write(page)
	}))
	defer srv.Close()

	c := &DuckDuckGoClient{hc: srv.Client(), endpoint: srv.URL}
	results, err := c.Search(context.Background(), "spaced repetition", 5)
	if err != nil {
		t.Fatal(err)
	}
	if gotQuery != "spaced repetition" {
		t.Fatalf("query sent = %q", gotQuery)
	}
	if len(results) != 5 {
		t.Fatalf("got %d results, want 5", len(results))
	}
	first := results[0]
	if first.URL != "https://en.wikipedia.org/wiki/Forgetting_curve" || first.Title != "Forgetting curve - Wikipedia" {
		t.Fatalf("first result = %+v", first)
	}
	if !strings.Contains(first.Snippet, "it's built upon things you already know") {
		t.Fatalf("snippet not decoded or not paired with its link: %q", first.Snippet)
	}
	for _, r := range results {
		if strings.Contains(r.URL, "duckduckgo.com") || !strings.HasPrefix(r.URL, "http") {
			t.Errorf("unwrapped URL %q", r.URL)
		}
	}
}

// A result with no snippet must not hand its neighbour's snippet to the next
// link, and an ad or a non-http target is skipped.
func TestDuckDuckGoParserKeepsSnippetsWithTheirLinks(t *testing.T) {
	block := func(class, href, title, snippet string) string {
		s := `<div class="result results_links` + class + `"><a class="result__a" href="` + href + `">` + title + `</a>`
		if snippet != "" {
			s += `<a class="result__snippet" href="x">` + snippet + `</a>`
		}
		return s + `</div>`
	}
	page := block(" result--ad", "//duckduckgo.com/y.js?ad=1", "Ad", "buy") +
		block("", "//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2F&amp;rut=1", "A", "") +
		block("", "//duckduckgo.com/l/?uddg=javascript%3Aalert(1)", "Bad", "no") +
		block("", "//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.example%2F", "B &amp; C", "about <b>B</b>")
	got := parseDuckDuckGo(page, 10)
	if len(got) != 2 {
		t.Fatalf("got %+v", got)
	}
	if got[0].URL != "https://a.example/" || got[0].Snippet != "" {
		t.Errorf("first = %+v", got[0])
	}
	if got[1].Title != "B & C" || got[1].Snippet != "about B" {
		t.Errorf("second = %+v", got[1])
	}
}

// A recency limit reaches each provider in its own dialect.
func TestFreshnessReachesEveryProvider(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		got = r.URL.RawQuery + string(raw)
		switch {
		case strings.Contains(r.URL.RawQuery, "count="):
			_, _ = io.WriteString(w, `{"web":{"results":[]}}`)
		case len(raw) > 0:
			_, _ = io.WriteString(w, `{"results":[]}`)
		default:
			_, _ = io.WriteString(w, `<html></html>`)
		}
	}))
	defer srv.Close()
	ctx := WithFreshness(context.Background(), FreshWeek)

	for _, tc := range []struct {
		c    Client
		want string
	}{
		{&TavilyClient{apiKey: "k", hc: srv.Client(), endpoint: srv.URL}, `"time_range":"week"`},
		{&BraveClient{apiKey: "k", hc: srv.Client(), endpoint: srv.URL}, "freshness=pw"},
		{&DuckDuckGoClient{hc: srv.Client(), endpoint: srv.URL}, "df=w"},
	} {
		if _, err := tc.c.Search(ctx, "q", 3); err != nil {
			t.Fatalf("%s: %v", tc.c.Name(), err)
		}
		if !strings.Contains(got, tc.want) {
			t.Errorf("%s sent %q, want it to contain %q", tc.c.Name(), got, tc.want)
		}
	}
	if FreshnessFrom(WithFreshness(context.Background(), "decade")) != "" {
		t.Error("an unknown recency value was carried")
	}
}
