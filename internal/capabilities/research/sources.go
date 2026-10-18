package research

import (
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/D0bby999/anytools/internal/citations"
)

// sources.go — choosing which web results a report may stand on.
//
// Every search returns more than the report can use, the same page comes back
// for several sub-questions, and one site can flood a topic. Before this, the
// first N results in search order were used as they came. Now, following
// postclaw's research engine (internal/research/dedup.go), results are:
//
//  1. merged across queries by canonical URL (tracking parameters, "www.",
//     fragments and trailing slashes do not make two pages);
//  2. scored by reciprocal-rank fusion (a page several queries rank highly
//     beats one query's first hit), weighted by the kind of site;
//  3. capped at two per site, so the report hears more than one voice.

// rrfK is the reciprocal-rank-fusion constant (Cormack et al.; postclaw uses
// the same 60).
const rrfK = 60

// perSiteCap is how many pages one site may contribute.
const perSiteCap = 2

// Kinds of site, most to least trustworthy for a learner.
const (
	AuthAcademic  = "academic"
	AuthOfficial  = "official"
	AuthReference = "reference"
	AuthNews      = "news"
	AuthOther     = "other"
	AuthForum     = "forum"
)

var authorityWeight = map[string]float64{
	AuthAcademic:  2.0,
	AuthOfficial:  1.8,
	AuthReference: 1.6,
	AuthNews:      1.3,
	AuthOther:     1.0,
	AuthForum:     0.7,
}

// Authority classifies a page by its host. A heuristic, not a verdict: it
// orders sources, it never removes one.
func Authority(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return AuthOther
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	switch {
	case strings.HasSuffix(host, ".edu") || strings.Contains(host, ".edu.") || strings.Contains(host, ".ac.") ||
		hostIn(host, "arxiv.org", "doi.org", "pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov", "nature.com",
			"science.org", "springer.com", "link.springer.com", "ieee.org", "acm.org", "semanticscholar.org",
			"jstor.org", "sciencedirect.com", "wiley.com", "plos.org", "scholar.google.com"):
		return AuthAcademic
	case strings.HasSuffix(host, ".gov") || strings.Contains(host, ".gov.") || strings.HasSuffix(host, ".mil") ||
		strings.HasSuffix(host, ".int") || hostIn(host, "who.int", "un.org", "europa.eu", "oecd.org", "worldbank.org"):
		return AuthOfficial
	case hostIn(host, "wikipedia.org", "britannica.com", "khanacademy.org", "openstax.org", "libretexts.org",
		"mathworld.wolfram.com", "plato.stanford.edu", "iep.utm.edu", "developer.mozilla.org", "docs.python.org"):
		return AuthReference
	case hostIn(host, "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "nytimes.com", "theguardian.com",
		"ft.com", "economist.com", "bloomberg.com", "npr.org", "washingtonpost.com", "wsj.com", "vnexpress.net",
		"tuoitre.vn", "thanhnien.vn"):
		return AuthNews
	case hostIn(host, "reddit.com", "quora.com", "stackoverflow.com", "stackexchange.com", "news.ycombinator.com"):
		return AuthForum
	}
	return AuthOther
}

// hostIn reports whether host is one of the domains or a subdomain of one.
func hostIn(host string, domains ...string) bool {
	for _, d := range domains {
		if host == d || strings.HasSuffix(host, "."+d) {
			return true
		}
	}
	return false
}

// trackingParam matches query parameters that never change the page.
var trackingParam = regexp.MustCompile(`^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|igshid|si)$`)

// CanonicalURL is the identity two results share when they are the same page.
func CanonicalURL(rawURL string) string {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Host == "" {
		return strings.TrimSpace(rawURL)
	}
	u.Scheme = "https"
	u.Host = strings.TrimPrefix(strings.ToLower(u.Host), "www.")
	u.Fragment = ""
	q := u.Query()
	for k := range q {
		if trackingParam.MatchString(strings.ToLower(k)) {
			q.Del(k)
		}
	}
	u.RawQuery = q.Encode()
	u.Path = strings.TrimRight(u.Path, "/")
	return u.String()
}

// candidate is one distinct web page seen by any search this turn.
type candidate struct {
	source    citations.Source
	block     string // the enveloped snippet, citable as source.ID
	score     float64
	authority string
	firstSeen int
}

// candidatePool merges search results across queries and rounds.
type candidatePool struct {
	byCanon map[string]*candidate
	seen    int
}

func newCandidatePool() *candidatePool { return &candidatePool{byCanon: map[string]*candidate{}} }

// add records one query's results, in the order the engine ranked them.
// blocks maps "url:<n>" to its enveloped snippet.
func (p *candidatePool) add(results []citations.Source, blocks map[string]string) {
	for rank, src := range results {
		canon := CanonicalURL(src.URL)
		c, ok := p.byCanon[canon]
		if !ok {
			p.seen++
			auth := src.Authority
			if _, known := authorityWeight[auth]; !known {
				auth = Authority(src.URL)
			}
			c = &candidate{source: src, block: blocks[src.Kind+":"+src.ID], authority: auth, firstSeen: p.seen}
			p.byCanon[canon] = c
		}
		c.score += 1.0 / float64(rrfK+rank+1)
	}
}

// best returns up to n candidates: highest weighted score first, at most
// perSiteCap per site, ties broken by first appearance.
func (p *candidatePool) best(n int) []*candidate {
	all := make([]*candidate, 0, len(p.byCanon))
	for _, c := range p.byCanon {
		all = append(all, c)
	}
	weighted := func(c *candidate) float64 { return c.score * authorityWeight[c.authority] }
	sort.Slice(all, func(i, j int) bool {
		wi, wj := weighted(all[i]), weighted(all[j])
		if wi != wj {
			return wi > wj
		}
		return all[i].firstSeen < all[j].firstSeen
	})
	perSite := map[string]int{}
	out := make([]*candidate, 0, n)
	for _, c := range all {
		if len(out) >= n {
			break
		}
		site := c.source.Site
		if site == "" {
			site = siteOf(c.source.URL)
		}
		if perSite[site] >= perSiteCap {
			continue
		}
		perSite[site]++
		out = append(out, c)
	}
	return out
}

func (p *candidatePool) len() int { return len(p.byCanon) }

// siteOf is the registrable-ish part of a host: the last two labels, or three
// under a two-letter second level ("bbc.co.uk", "edu.vn").
func siteOf(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	labels := strings.Split(strings.TrimPrefix(strings.ToLower(u.Hostname()), "www."), ".")
	keep := 2
	if n := len(labels); n >= 3 && (len(labels[n-2]) <= 3 && len(labels[n-1]) == 2) {
		keep = 3
	}
	if len(labels) <= keep {
		return strings.Join(labels, ".")
	}
	return strings.Join(labels[len(labels)-keep:], ".")
}

// envelopeRE finds one enveloped block and its id. The envelope neutralises
// any "</document" inside a body (internal/tools/envelope.go), so the first
// closing tag after an opening one is that block's own.
var envelopeRE = regexp.MustCompile(`(?s)<document source="[^"]*" id="([^"]+)" trust="untrusted">\n.*?\n</document>`)

// splitBlocks maps each envelope id in a tool's output to its whole block.
func splitBlocks(content string) map[string]string {
	out := map[string]string{}
	for _, m := range envelopeRE.FindAllStringSubmatchIndex(content, -1) {
		id := content[m[2]:m[3]]
		block := content[m[0]:m[1]]
		if prev, ok := out[id]; ok {
			block = prev + "\n\n" + block
		}
		out[id] = block
	}
	return out
}
