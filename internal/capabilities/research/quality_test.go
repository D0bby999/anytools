package research

import (
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Deep mode searches again for what the first round missed, never repeats a
// search, stops when the material is sufficient, and keeps the gaps it saw.
func TestDeepModeSearchesAgainForTheGaps(t *testing.T) {
	s := newSetup()
	s.mode = ModeDeep
	if _, _, err := s.run(t); err != nil {
		t.Fatal(err)
	}
	queries := strings.Join(s.searcher.queries, "|")
	if !strings.Contains(queries, "follow-up one") || !strings.Contains(queries, "follow-up two") {
		t.Fatalf("follow-ups were not searched: %v", s.searcher.queries)
	}
	seen := map[string]int{}
	for _, q := range s.searcher.queries {
		seen[q]++
		if seen[q] > 1 {
			t.Fatalf("%q was searched twice", q)
		}
	}
	// The second reflection said the material is sufficient: nothing is left
	// open.
	if r := s.reports.reports[0]; len(r.OpenQuestions) != 0 {
		t.Fatalf("open questions after a sufficient reflection = %v", r.OpenQuestions)
	}
	if !strings.Contains(s.model.synthInput, "follow-up one") {
		t.Error("the synthesis was not told which follow-up searches ran")
	}
}

// At the round cap, the gaps the last reflection saw are kept as open
// questions and handed to the synthesis.
func TestTheRoundCapEndsTheSearchAndKeepsTheGaps(t *testing.T) {
	s := newSetup()
	s.mode = ModeDeep
	s.model.neverSatisfied = true
	s.model.subqueries = 2
	if _, _, err := s.run(t); err != nil {
		t.Fatal(err)
	}
	// 3 rounds: reflections after rounds 1 and 2 only.
	if s.model.reflections != 2 || s.searcher.calls() != 4 {
		t.Fatalf("reflections %d, searches %d; want 2 and 4", s.model.reflections, s.searcher.calls())
	}
	if r := s.reports.reports[0]; len(r.OpenQuestions) != 1 || r.OpenQuestions[0] != "gap 2" {
		t.Fatalf("open questions = %v", r.OpenQuestions)
	}
	if !strings.Contains(s.model.synthInput, "gap 2") {
		t.Error("the synthesis was not told what is still open")
	}
}

// Quick mode is one round: no reflection at all.
func TestQuickModeDoesNotReflect(t *testing.T) {
	s := newSetup()
	if _, _, err := s.run(t); err != nil {
		t.Fatal(err)
	}
	if s.model.reflections != 0 || s.searcher.calls() != 3 {
		t.Fatalf("reflections %d, searches %d; want 0 and 3", s.model.reflections, s.searcher.calls())
	}
}

// An unreadable reflection ends the search instead of looping.
func TestAnUnreadableReflectionStopsTheSearch(t *testing.T) {
	s := newSetup()
	s.mode = ModeDeep
	s.model.badReflect = true
	s.model.subqueries = 2
	if _, _, err := s.run(t); err != nil {
		t.Fatal(err)
	}
	if s.model.reflections != 1 || s.searcher.calls() != 2 {
		t.Fatalf("reflections %d, searches %d; want 1 and 2", s.model.reflections, s.searcher.calls())
	}
	if len(s.reports.reports) != 1 {
		t.Fatal("no report after a failed reflection")
	}
}

// A report may only cite what it was given. Results ranked out of the
// material are dropped even though a search returned them this turn.
func TestCitationsToRankedOutResultsAreDropped(t *testing.T) {
	s := newSetup()
	s.model.citeAll = true
	_, events, err := s.run(t)
	if err != nil {
		t.Fatal(err)
	}
	r := s.reports.reports[0]
	if n := len(r.Sources); n == 0 || n > 5 {
		t.Fatalf("quick report cites %d sources, want 1..5", n)
	}
	// 15 results were found (3 searches × 5); at most 5 were given.
	if got, _ := resultOf(t, events).Metadata["dropped_citations"].(int); got < 10 {
		t.Fatalf("dropped = %d, want the ranked-out results dropped", got)
	}
}

// Every chosen claim is checked against its own cited sources.
func TestTheReportIsCheckedAgainstItsSources(t *testing.T) {
	s := newSetup()
	_, events, err := s.run(t)
	if err != nil {
		t.Fatal(err)
	}
	v := s.reports.reports[0].Verification
	if v == nil || v.Status != "checked" {
		t.Fatalf("verification = %+v", v)
	}
	if v.Total != len(v.Claims) || v.Supported != 1 {
		t.Fatalf("counts = %+v", v)
	}
	for _, c := range v.Claims {
		switch c.Claim {
		case "borrowed":
			// It named a source the report never cited: not evidence.
			if c.Verdict != VerdictUncited || len(c.Cites) != 0 {
				t.Errorf("borrowed claim = %+v", c)
			}
		case "odd":
			if c.Verdict != VerdictUnsupported {
				t.Errorf("an unknown verdict counted as %q", c.Verdict)
			}
		}
	}
	if v.Supported+v.Partial+v.Unsupported+v.Uncited != v.Total {
		t.Fatalf("verdicts do not add up: %+v", v)
	}
	// The check saw the cited sources' text, and nothing it was not cited on.
	cited := s.reports.reports[0].Sources
	for _, src := range cited {
		if !strings.Contains(s.model.verifyInput, `id="`+citations.Key(src.Kind, src.ID)+`"`) {
			t.Errorf("the check was not shown %s", citations.Key(src.Kind, src.ID))
		}
	}
	if strings.Contains(s.model.verifyInput, `id="url:99"`) {
		t.Error("the check was shown a source the report does not cite")
	}
	if resultOf(t, events).Metadata["verification"] == nil {
		t.Error("the result event does not carry the check")
	}
}

// A check that cannot run leaves the report delivered and marked unchecked.
func TestAFailedCheckStillDeliversTheReport(t *testing.T) {
	s := newSetup()
	s.model.badVerify = true
	_, events, err := s.run(t)
	if err != nil {
		t.Fatal(err)
	}
	r := s.reports.reports[0]
	if r.Verification == nil || r.Verification.Status != "unavailable" || r.ReportMD == "" {
		t.Fatalf("report = %+v", r)
	}
	said := false
	for _, ev := range events {
		said = said || (ev.Type == runtime.EvObservation && strings.Contains(ev.Content, "unchecked"))
	}
	if !said {
		t.Error("the stream did not say the report is unchecked")
	}
}

// Without a key, the keyless engine reaches the web, and the report says so.
func TestKeylessSearchIsUsedAndNamed(t *testing.T) {
	s := newSetup()
	s.searcher.hasKey, s.searcher.keyless = false, true
	_, events, err := s.run(t)
	if err != nil {
		t.Fatal(err)
	}
	r := s.reports.reports[0]
	if r.KBOnly || r.Engine != "duckduckgo" || s.searcher.calls() == 0 {
		t.Fatalf("report = %+v, searches %d", r, s.searcher.calls())
	}
	said := false
	for _, ev := range events {
		said = said || (ev.Type == runtime.EvObservation && strings.Contains(ev.Content, "DuckDuckGo"))
	}
	if !said {
		t.Error("the stream did not say DuckDuckGo was used")
	}
}

// A question about something current limits every search to recent pages.
func TestFreshnessReachesEverySearch(t *testing.T) {
	s := newSetup()
	s.model.freshness = "month"
	if _, _, err := s.run(t); err != nil {
		t.Fatal(err)
	}
	for _, f := range s.searcher.freshness {
		if f != "month" {
			t.Fatalf("searches ran with freshness %v", s.searcher.freshness)
		}
	}
	s2 := newSetup()
	s2.model.freshness = "sometime"
	if _, _, err := s2.run(t); err != nil {
		t.Fatal(err)
	}
	for _, f := range s2.searcher.freshness {
		if f != "" {
			t.Fatalf("an unknown recency word limited the search: %v", s2.searcher.freshness)
		}
	}
}

func src(id, u string) citations.Source {
	return citations.Source{Kind: citations.KindURL, ID: id, URL: u, Title: id}
}

// The same page from two searches is one source and outranks a page only one
// search found; a site cannot flood the report; academic beats a blog at the
// same rank.
func TestSourcesAreMergedRankedAndCappedPerSite(t *testing.T) {
	p := newCandidatePool()
	p.add([]citations.Source{
		src("1", "https://blog.example/a"),
		src("2", "https://www.shared.example/page/?utm_source=x#top"),
		src("3", "https://flood.example/1"),
		src("4", "https://flood.example/2"),
		src("5", "https://flood.example/3"),
	}, nil)
	p.add([]citations.Source{
		src("6", "https://shared.example/page"),
		src("7", "https://mit.edu/notes"),
	}, nil)

	best := p.best(10)
	if best[0].source.URL != "https://www.shared.example/page/?utm_source=x#top" {
		t.Fatalf("top = %s, want the page both searches found", best[0].source.URL)
	}
	flood := 0
	for _, c := range best {
		if siteOf(c.source.URL) == "flood.example" {
			flood++
		}
	}
	if flood != perSiteCap {
		t.Fatalf("flood.example contributed %d, cap is %d", flood, perSiteCap)
	}
	if len(best) != 5 {
		t.Fatalf("got %d distinct sources, want 5 (2 merged, 1 over the site cap)", len(best))
	}
	rank := map[string]int{}
	for i, c := range best {
		rank[c.source.URL] = i
	}
	// mit.edu was second in its search, the blog first in its own; the
	// academic weight must still put it ahead.
	if rank["https://mit.edu/notes"] > rank["https://blog.example/a"] {
		t.Errorf("academic ranked below a blog: %v", rank)
	}
}

func TestAuthorityAndSiteHeuristics(t *testing.T) {
	for u, want := range map[string]string{
		"https://arxiv.org/abs/1":           AuthAcademic,
		"https://hcmus.edu.vn/x":            AuthAcademic,
		"https://www.cdc.gov/x":             AuthOfficial,
		"https://moh.gov.vn/x":              AuthOfficial,
		"https://en.wikipedia.org/wiki/X":   AuthReference,
		"https://www.bbc.co.uk/news/x":      AuthNews,
		"https://old.reddit.com/r/x":        AuthForum,
		"https://notwikipedia.org.evil/x":   AuthOther,
		"https://randomblog.example/post-1": AuthOther,
	} {
		if got := Authority(u); got != want {
			t.Errorf("Authority(%s) = %s, want %s", u, got, want)
		}
	}
	for u, want := range map[string]string{
		"https://news.bbc.co.uk/x": "bbc.co.uk",
		"https://en.wikipedia.org": "wikipedia.org",
		"https://a.hcmus.edu.vn":   "hcmus.edu.vn",
	} {
		if got := siteOf(u); got != want {
			t.Errorf("siteOf(%s) = %s, want %s", u, got, want)
		}
	}
}
