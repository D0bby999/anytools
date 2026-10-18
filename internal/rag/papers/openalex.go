package papers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

// OpenAlex is the primary source: every discipline, a free optional key
// (about 100 searches a day per IP without one, about 1,000 with).
type OpenAlex struct {
	key      string
	endpoint string
	hc       *http.Client
	now      func() time.Time
}

// OpenAlexEndpoint is the public API.
const OpenAlexEndpoint = "https://api.openalex.org"

// NewOpenAlex builds the client. key may be empty (the keyless budget).
func NewOpenAlex(key string) *OpenAlex {
	return &OpenAlex{key: key, endpoint: OpenAlexEndpoint, hc: newClient(), now: time.Now}
}

// WithEndpoint aims the client at a recorded-HTTP fixture (tests only).
func (c *OpenAlex) WithEndpoint(u string, hc *http.Client) *OpenAlex {
	c.endpoint, c.hc = strings.TrimRight(u, "/"), hc
	return c
}

// selectFields asks for only what Paper holds.
const selectFields = "id,doi,title,authorships,publication_year,cited_by_count,open_access,primary_location,best_oa_location,abstract_inverted_index"

// Search finds works matching q. sinceYears > 0 keeps the last N years.
func (c *OpenAlex) Search(ctx context.Context, q string, n, sinceYears int) ([]Paper, error) {
	v := url.Values{}
	v.Set("search", q)
	v.Set("per-page", fmt.Sprint(clampInt(n, 1, 25)))
	v.Set("select", selectFields)
	if sinceYears > 0 {
		v.Set("filter", "from_publication_date:"+c.now().AddDate(-sinceYears, 0, 0).Format(time.DateOnly))
	}
	var out struct {
		Results []openAlexWork `json:"results"`
	}
	if err := c.get(ctx, "/works", v, &out); err != nil {
		return nil, err
	}
	papers := make([]Paper, 0, len(out.Results))
	for _, w := range out.Results {
		if p, ok := w.paper(); ok {
			papers = append(papers, p)
		}
	}
	return papers, nil
}

// workID is an OpenAlex work id: W and digits, nothing a client could use to
// reach another path.
var workID = regexp.MustCompile(`^W\d{1,12}$`)

// Work reads one work by its id. The id is checked before it is put in a
// URL.
func (c *OpenAlex) Work(ctx context.Context, id string) (*Paper, error) {
	id = strings.TrimPrefix(strings.TrimSpace(id), "https://openalex.org/")
	if !workID.MatchString(id) {
		return nil, fmt.Errorf("papers: %q is not an OpenAlex work id", id)
	}
	v := url.Values{}
	v.Set("select", selectFields)
	var w openAlexWork
	if err := c.get(ctx, "/works/"+id, v, &w); err != nil {
		return nil, err
	}
	p, ok := w.paper()
	if !ok {
		return nil, fmt.Errorf("papers: work %s has no title", id)
	}
	return &p, nil
}

// Ping is the verify probe for a stored key: one one-result search.
func (c *OpenAlex) Ping(ctx context.Context) error {
	_, err := c.Search(ctx, "learning", 1, 0)
	return err
}

func (c *OpenAlex) get(ctx context.Context, path string, v url.Values, out any) error {
	if c.key != "" {
		v.Set("api_key", c.key)
	}
	u := c.endpoint + path + "?" + v.Encode()
	host := hostOf(c.endpoint)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return &Error{Host: host, Reason: "the request could not be built"}
	}
	req.Header.Set("Accept", "application/json")
	resp, err := c.hc.Do(req)
	if err != nil {
		return transportError(host, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return statusError(host, resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(out); err != nil {
		return &Error{Host: host, Reason: "the answer was not readable"}
	}
	return nil
}

type openAlexWork struct {
	ID              string `json:"id"`
	DOI             string `json:"doi"`
	Title           string `json:"title"`
	PublicationYear int    `json:"publication_year"`
	CitedByCount    int    `json:"cited_by_count"`
	Authorships     []struct {
		Author struct {
			DisplayName string `json:"display_name"`
		} `json:"author"`
	} `json:"authorships"`
	OpenAccess struct {
		IsOA  bool   `json:"is_oa"`
		OAURL string `json:"oa_url"`
	} `json:"open_access"`
	PrimaryLocation *openAlexLocation `json:"primary_location"`
	BestOALocation  *openAlexLocation `json:"best_oa_location"`
	Abstract        map[string][]int  `json:"abstract_inverted_index"`
}

type openAlexLocation struct {
	LandingPageURL string `json:"landing_page_url"`
	PDFURL         string `json:"pdf_url"`
	License        string `json:"license"`
}

func (w openAlexWork) paper() (Paper, bool) {
	title := strings.TrimSpace(w.Title)
	if title == "" {
		return Paper{}, false
	}
	p := Paper{
		ID: strings.TrimPrefix(w.ID, "https://openalex.org/"), Source: "openalex",
		DOI: strings.TrimPrefix(w.DOI, "https://doi.org/"), Title: clip(title, 300),
		Year: w.PublicationYear, Citations: w.CitedByCount, OpenAccess: w.OpenAccess.IsOA,
		Abstract: clip(rebuildAbstract(w.Abstract), maxAbstract), Authors: []string{},
	}
	for i, a := range w.Authorships {
		if i == 8 {
			p.Authors = append(p.Authors, "et al.")
			break
		}
		if name := strings.TrimSpace(a.Author.DisplayName); name != "" {
			p.Authors = append(p.Authors, name)
		}
	}
	switch {
	case p.DOI != "":
		p.URL = "https://doi.org/" + p.DOI
	case w.PrimaryLocation != nil && w.PrimaryLocation.LandingPageURL != "":
		p.URL = w.PrimaryLocation.LandingPageURL
	default:
		p.URL = "https://openalex.org/" + p.ID
	}
	if oa := w.BestOALocation; oa != nil {
		p.License = oa.License
		if p.OpenLicence() {
			p.PDFURL = oa.PDFURL
		}
	}
	return p, true
}

// rebuildAbstract turns OpenAlex's inverted index (word → positions) back
// into text.
func rebuildAbstract(index map[string][]int) string {
	type at struct {
		pos  int
		word string
	}
	var words []at
	for w, positions := range index {
		for _, p := range positions {
			if p >= 0 && p < 5000 {
				words = append(words, at{p, w})
			}
		}
	}
	sort.Slice(words, func(i, j int) bool { return words[i].pos < words[j].pos })
	out := make([]string, len(words))
	for i, w := range words {
		out[i] = w.word
	}
	return strings.Join(out, " ")
}

func hostOf(endpoint string) string {
	u, err := url.Parse(endpoint)
	if err != nil {
		return "the paper service"
	}
	return u.Host
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
