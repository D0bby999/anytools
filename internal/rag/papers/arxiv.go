package papers

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Arxiv is the secondary source: preprints, no key, and a rule of at most one
// request every three seconds (arXiv API terms), kept process-wide.
type Arxiv struct {
	endpoint string
	hc       *http.Client
	throttle *Throttle
}

// ArxivEndpoint is the public query API.
const ArxivEndpoint = "https://export.arxiv.org/api/query"

// arxivGap is arXiv's requested spacing between requests.
const arxivGap = 3 * time.Second

// sharedThrottle is the one arXiv allowance for the whole process: two users
// searching at once still send one request every three seconds.
var sharedThrottle = NewThrottle(arxivGap, time.Now, sleepCtx)

// NewArxiv builds the client on the process-wide throttle.
func NewArxiv() *Arxiv {
	return &Arxiv{endpoint: ArxivEndpoint, hc: newClient(), throttle: sharedThrottle}
}

// WithEndpoint aims the client at a fixture, with its own throttle (tests).
func (c *Arxiv) WithEndpoint(u string, hc *http.Client, t *Throttle) *Arxiv {
	c.endpoint, c.hc, c.throttle = u, hc, t
	return c
}

// Search finds preprints matching q. A 429 is retried once, after the gap.
func (c *Arxiv) Search(ctx context.Context, q string, n int) ([]Paper, error) {
	v := url.Values{}
	v.Set("search_query", "all:"+q)
	v.Set("max_results", fmt.Sprint(clampInt(n, 1, 25)))
	v.Set("sortBy", "relevance")
	host := hostOf(c.endpoint)
	var body []byte
	for attempt := 0; ; attempt++ {
		if err := c.throttle.Wait(ctx); err != nil {
			return nil, err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint+"?"+v.Encode(), nil)
		if err != nil {
			return nil, &Error{Host: host, Reason: "the request could not be built"}
		}
		resp, err := c.hc.Do(req)
		if err != nil {
			return nil, transportError(host, err)
		}
		body, err = io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests && attempt == 0 {
			continue
		}
		if resp.StatusCode != http.StatusOK {
			return nil, statusError(host, resp.StatusCode)
		}
		if err != nil {
			return nil, transportError(host, err)
		}
		break
	}
	var feed struct {
		Entries []struct {
			ID        string `xml:"id"`
			Title     string `xml:"title"`
			Summary   string `xml:"summary"`
			Published string `xml:"published"`
			Authors   []struct {
				Name string `xml:"name"`
			} `xml:"author"`
			DOI string `xml:"http://arxiv.org/schemas/atom doi"`
		} `xml:"entry"`
	}
	if err := xml.Unmarshal(body, &feed); err != nil {
		return nil, &Error{Host: host, Reason: "the answer was not readable"}
	}
	out := make([]Paper, 0, len(feed.Entries))
	for _, e := range feed.Entries {
		id := e.ID
		if i := strings.Index(id, "/abs/"); i >= 0 {
			id = id[i+len("/abs/"):]
		}
		title := clip(e.Title, 300)
		if title == "" || id == "" {
			continue
		}
		p := Paper{
			ID: id, Source: "arxiv", DOI: strings.TrimSpace(e.DOI), Title: title,
			URL: "https://arxiv.org/abs/" + id, Abstract: clip(e.Summary, maxAbstract), Authors: []string{},
			// arXiv's licence varies per paper and the feed does not state it:
			// AnyTools links to the abstract and never stores the e-print.
			OpenAccess: true,
		}
		if len(e.Published) >= 4 {
			fmt.Sscanf(e.Published[:4], "%d", &p.Year)
		}
		for i, a := range e.Authors {
			if i == 8 {
				p.Authors = append(p.Authors, "et al.")
				break
			}
			p.Authors = append(p.Authors, strings.TrimSpace(a.Name))
		}
		out = append(out, p)
	}
	return out, nil
}

// Throttle spaces calls at least gap apart, across goroutines.
type Throttle struct {
	mu    sync.Mutex
	gap   time.Duration
	next  time.Time
	now   func() time.Time
	sleep func(context.Context, time.Duration) error
}

// NewThrottle builds a throttle with an injectable clock and sleep (tests).
func NewThrottle(gap time.Duration, now func() time.Time, sleep func(context.Context, time.Duration) error) *Throttle {
	return &Throttle{gap: gap, now: now, sleep: sleep}
}

// Wait returns when the caller may send, or when ctx ends.
func (t *Throttle) Wait(ctx context.Context) error {
	t.mu.Lock()
	now := t.now()
	at := t.next
	if at.Before(now) {
		at = now
	}
	t.next = at.Add(t.gap)
	t.mu.Unlock()
	if d := at.Sub(now); d > 0 {
		return t.sleep(ctx, d)
	}
	return nil
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
