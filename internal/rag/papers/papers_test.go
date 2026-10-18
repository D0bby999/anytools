package papers_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/rag/papers"
)

func fixture(t *testing.T, path string, status int, seen *[]string) *httptest.Server {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if seen != nil {
			*seen = append(*seen, r.URL.String())
		}
		w.WriteHeader(status)
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestOpenAlexParsesWorksAndRebuildsAbstracts(t *testing.T) {
	var seen []string
	srv := fixture(t, "testdata/openalex_search.json", http.StatusOK, &seen)
	got, err := papers.NewOpenAlex("oa-key-1").WithEndpoint(srv.URL, srv.Client()).Search(context.Background(), "rag", 5, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("%d papers; the untitled one must be dropped", len(got))
	}
	rag := got[0]
	if rag.ID != "W3027879771" || rag.URL != "https://doi.org/10.48550/arxiv.2005.11401" ||
		rag.Abstract != "Large pre-trained language models store knowledge." || len(rag.Authors) != 2 ||
		!rag.OpenLicence() || rag.PDFURL == "" || rag.Year != 2020 {
		t.Fatalf("parsed = %+v", rag)
	}
	if closed := got[1]; closed.OpenLicence() || closed.PDFURL != "" || closed.URL != "https://publisher.example/p/1" {
		t.Fatalf("a closed paper = %+v", closed)
	}
	q := seen[0]
	for _, want := range []string{"search=rag", "per-page=5", "api_key=oa-key-1", "filter=from_publication_date%3A", "select="} {
		if !strings.Contains(q, want) {
			t.Errorf("request %s lacks %s", q, want)
		}
	}
}

// An outage is an error, not an empty list; a 429 says the budget is spent;
// and no error ever quotes the key.
func TestOpenAlexFailuresAreErrorsWithoutTheKey(t *testing.T) {
	limited := fixture(t, "testdata/openalex_search.json", http.StatusTooManyRequests, nil)
	_, err := papers.NewOpenAlex("oa-key-1").WithEndpoint(limited.URL, limited.Client()).Search(context.Background(), "rag", 5, 0)
	if !errors.Is(err, papers.ErrLimited) {
		t.Fatalf("429: %v", err)
	}
	down := fixture(t, "testdata/openalex_search.json", http.StatusBadGateway, nil)
	if _, err := papers.NewOpenAlex("").WithEndpoint(down.URL, down.Client()).Search(context.Background(), "rag", 5, 0); err == nil {
		t.Fatal("a 502 was an empty list")
	}
	// A transport failure: *url.Error would print the URL, key and all.
	unreachable := papers.NewOpenAlex("oa-key-1").WithEndpoint("http://127.0.0.1:1", &http.Client{Timeout: time.Second})
	_, err = unreachable.Search(context.Background(), "rag", 5, 0)
	if err == nil || strings.Contains(err.Error(), "oa-key-1") || strings.Contains(err.Error(), "api_key") {
		t.Fatalf("transport error = %v", err)
	}
}

func TestWorkIDsAreCheckedBeforeTheyReachAURL(t *testing.T) {
	c := papers.NewOpenAlex("")
	for _, bad := range []string{"../authors/A1", "W1/../../x", "https://evil.example/W1", "W"} {
		if _, err := c.Work(context.Background(), bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestArxivParsesTheAtomFeed(t *testing.T) {
	srv := fixture(t, "testdata/arxiv_search.xml", http.StatusOK, nil)
	throttle := papers.NewThrottle(3*time.Second, time.Now, func(context.Context, time.Duration) error { return nil })
	got, err := papers.NewArxiv().WithEndpoint(srv.URL, srv.Client(), throttle).Search(context.Background(), "rag", 3)
	if err != nil || len(got) != 1 {
		t.Fatalf("%v, %v", got, err)
	}
	p := got[0]
	if p.ID != "2005.11401v4" || p.URL != "https://arxiv.org/abs/2005.11401v4" || p.Year != 2020 ||
		p.Title != "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks" || len(p.Authors) != 2 ||
		p.DOI != "10.48550/arXiv.2005.11401" || p.OpenLicence() {
		t.Fatalf("parsed = %+v", p)
	}
}

// At most one arXiv request every three seconds, whoever asks.
func TestTheArxivThrottleSpacesRequests(t *testing.T) {
	now := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)
	var slept []time.Duration
	th := papers.NewThrottle(3*time.Second, func() time.Time { return now }, func(_ context.Context, d time.Duration) error {
		slept = append(slept, d)
		return nil
	})
	for i := 0; i < 3; i++ {
		if err := th.Wait(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if len(slept) != 2 || slept[0] != 3*time.Second || slept[1] != 6*time.Second {
		t.Fatalf("waits = %v, want [3s 6s]", slept)
	}
}
