package parse_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/rag/parse"
)

// The three documents Spike B measured, committed as fixtures so the rules it
// produced are checked against the same bytes that produced them.
var corpus = []struct {
	name  string
	file  string
	pages int
}{
	{"rag", "rag.pdf", 19},
	{"concrete-ai-safety", "concrete-ai-safety.pdf", 29},
	{"scanned-rag-10p", "scanned-rag-10p.pdf", 10},
}

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return b
}

// recordedParser replays the Markdown Spike B actually got back from
// `gemini-3.6-flash`, sliced to whatever page window the batcher asks for.
//
// This is the only honest way to golden-test a pipeline whose input is a
// language model. A synthetic parser would test the batcher against text this
// repository wrote, which proves the batcher agrees with itself; replaying the
// recording tests it against the shape a real provider produced, including the
// parts nobody would have thought to fake — the `<sup>` runs, the GFM tables,
// the `$$` display equations, the reference lists.
type recordedParser struct {
	pages map[int]string
	// truncateAbove forces PageFinishTruncated for any window wider than this,
	// so the halving retry is exercised the way -maxout 2500 exercised it in
	// the spike.
	truncateAbove int
	// renumber makes the parser emit markers starting from 1 instead of the
	// absolute numbers it was given — the exact misbehaviour the splitter rule
	// exists to catch.
	renumber bool
	calls    []string
	// dropMarkers omits markers entirely.
	dropMarkers bool
}

func loadRecorded(t *testing.T, stem string) *recordedParser {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "recorded", stem+".gemini.md"))
	if err != nil {
		t.Fatalf("read recording for %s: %v", stem, err)
	}
	_, bodies, nums := parse.SplitAtMarkers(string(raw))
	pages := map[int]string{}
	for i, n := range nums {
		if i < len(bodies) {
			pages[n] = bodies[i]
		}
	}
	if len(pages) == 0 {
		t.Fatalf("recording for %s has no page markers", stem)
	}
	return &recordedParser{pages: pages}
}

func (p *recordedParser) ProviderName() string { return "gemini" }

func (p *recordedParser) ParsePages(_ context.Context, req parse.PageRequest) (parse.PageResult, error) {
	p.calls = append(p.calls, fmt.Sprintf("%d-%d", req.Start, req.End))

	var sb strings.Builder
	for n := req.Start; n <= req.End; n++ {
		if !p.dropMarkers {
			marker := n
			if p.renumber {
				marker = n - req.Start + 1
			}
			sb.WriteString(parse.Marker(marker))
			sb.WriteString("\n")
		}
		sb.WriteString(p.pages[n])
		sb.WriteString("\n\n")
	}

	res := parse.PageResult{Markdown: sb.String(), Finish: parse.PageFinishStop, Model: "gemini-3.6-flash"}
	if p.truncateAbove > 0 && req.End-req.Start+1 > p.truncateAbove {
		res.Finish = parse.PageFinishTruncated
	}
	return res, nil
}

// ── page counting and splitting ────────────────────────────────────────────

func TestPDFPageCountMatchesTheSpikeCorpus(t *testing.T) {
	for _, doc := range corpus {
		t.Run(doc.name, func(t *testing.T) {
			got, err := parse.PDFPageCount(readFixture(t, doc.file))
			if err != nil {
				t.Fatalf("PDFPageCount: %v", err)
			}
			if got != doc.pages {
				t.Fatalf("page count = %d, want %d", got, doc.pages)
			}
		})
	}
}

// The splitter is what lets the caller state an absolute page range to a model
// and be believed, so "the slice really contains those pages and only those"
// is the property worth testing.
func TestSplitPDFProducesExactlyTheRequestedPages(t *testing.T) {
	data := readFixture(t, "rag.pdf")
	for _, tc := range []struct{ start, end, want int }{
		{1, 10, 10}, {11, 19, 9}, {5, 5, 1}, {1, 19, 19},
	} {
		slice, err := parse.SplitPDF(data, tc.start, tc.end)
		if err != nil {
			t.Fatalf("SplitPDF(%d,%d): %v", tc.start, tc.end, err)
		}
		got, err := parse.PDFPageCount(slice)
		if err != nil {
			t.Fatalf("count slice(%d,%d): %v", tc.start, tc.end, err)
		}
		if got != tc.want {
			t.Fatalf("slice(%d,%d) has %d pages, want %d", tc.start, tc.end, got, tc.want)
		}
	}
}

func TestWindowsCoversEveryPageExactlyOnce(t *testing.T) {
	for _, pages := range []int{1, 9, 10, 11, 19, 29, 400} {
		seen := map[int]int{}
		for _, w := range parse.Windows(pages, parse.DefaultBatchPages) {
			if w.End-w.Start+1 > parse.DefaultBatchPages {
				t.Fatalf("pages=%d: window %d-%d is wider than the batch size", pages, w.Start, w.End)
			}
			for p := w.Start; p <= w.End; p++ {
				seen[p]++
			}
		}
		for p := 1; p <= pages; p++ {
			if seen[p] != 1 {
				t.Fatalf("pages=%d: page %d covered %d times", pages, p, seen[p])
			}
		}
		if len(seen) != pages {
			t.Fatalf("pages=%d: covered %d distinct pages", pages, len(seen))
		}
	}
}

// ── the golden parse ───────────────────────────────────────────────────────

// TestParsePDFGolden is the phase's golden test: the three spike documents,
// parsed through the real batcher against the recorded provider output, with
// the page markers checked against the PDFs' own text layers.
func TestParsePDFGolden(t *testing.T) {
	for _, doc := range corpus {
		t.Run(doc.name, func(t *testing.T) {
			data := readFixture(t, doc.file)
			parser := loadRecorded(t, strings.TrimSuffix(doc.file, ".pdf"))

			rep, err := parse.NewBatcher(parse.Options{}).
				ParsePDF(context.Background(), []parse.PageParser{parser}, data, nil)
			if err != nil {
				t.Fatalf("ParsePDF: %v", err)
			}

			if rep.PageCount != doc.pages {
				t.Fatalf("report page count = %d, want %d", rep.PageCount, doc.pages)
			}
			if rep.Provider != "gemini" || rep.Model != "gemini-3.6-flash" {
				t.Fatalf("provenance = %q/%q, want gemini/gemini-3.6-flash", rep.Provider, rep.Model)
			}
			if rep.Downgraded {
				t.Fatal("a single-provider chain that succeeded must not report a downgrade")
			}

			// Every page is marked exactly once, in order.
			pages := parse.MarkerPages(rep.Markdown)
			if len(pages) != doc.pages {
				t.Fatalf("got %d page markers, want %d", len(pages), doc.pages)
			}
			for i, p := range pages {
				if p != i+1 {
					t.Fatalf("marker %d is page %d, want %d", i, p, i+1)
				}
			}

			// Batching really happened at the documented width.
			wantCalls := (doc.pages + parse.DefaultBatchPages - 1) / parse.DefaultBatchPages
			if len(parser.calls) != wantCalls {
				t.Fatalf("made %d provider calls (%v), want %d", len(parser.calls), parser.calls, wantCalls)
			}
		})
	}
}

// TestPageMarkerAccuracyOnSampledQuotes is Spike B's own metric, run as a test.
//
// It samples sentences from the parsed Markdown of a page and checks they
// really appear in THAT page's text layer in the source PDF. This is the
// measurement behind AC1 — "a citation that opens the page containing the
// quoted text" — and the reason it is a test rather than a one-off spike
// number is that nothing else in the pipeline would notice if pages started
// being attributed one off.
//
// `scanned-rag-10p` is excluded: it has no text layer to check against, which
// is the whole reason it is in the corpus.
func TestPageMarkerAccuracyOnSampledQuotes(t *testing.T) {
	for _, doc := range corpus[:2] {
		t.Run(doc.name, func(t *testing.T) {
			data := readFixture(t, doc.file)
			parser := loadRecorded(t, strings.TrimSuffix(doc.file, ".pdf"))

			rep, err := parse.NewBatcher(parse.Options{}).
				ParsePDF(context.Background(), []parse.PageParser{parser}, data, nil)
			if err != nil {
				t.Fatalf("ParsePDF: %v", err)
			}

			textLayer, _, err := parse.LocalPDFText(data)
			if err != nil {
				t.Fatalf("LocalPDFText: %v", err)
			}
			truth := pagesByNumber(textLayer)
			parsed := pagesByNumber(rep.Markdown)

			sampled, hits := 0, 0
			var misses []string
			for page := 1; page <= doc.pages; page++ {
				quote := sampleSentence(parsed[page])
				if quote == "" {
					continue
				}
				sampled++
				if shingleOverlap(quote, truth[page]) >= 0.6 {
					hits++
				} else {
					misses = append(misses, fmt.Sprintf("p%d: %.60q", page, quote))
				}
			}

			if sampled < 8 {
				t.Fatalf("only %d pages yielded a sampleable sentence", sampled)
			}
			// Spike B's threshold was 9/10. `ledongthuc/pdf` emits this corpus
			// with no spaces at all, so the comparison is deliberately made on
			// letters-only shingles; the bar is the spike's ratio, not a
			// character-exact match.
			if float64(hits)/float64(sampled) < 0.9 {
				t.Fatalf("page accuracy %d/%d < 9/10\nmisses:\n%s",
					hits, sampled, strings.Join(misses, "\n"))
			}
			t.Logf("page-marker accuracy %d/%d", hits, sampled)
		})
	}
}

// ── the truncation rule ────────────────────────────────────────────────────

// TestTruncationHalvesTheWindowAndKeepsPagesCorrect is the rule Spike B
// exercised by forcing ten MAX_TOKENS events: the retry recurses 10 -> 5 -> 2
// -> 1 and page accuracy stays perfect, because the numbers come from the
// splitter rather than from the model.
func TestTruncationHalvesTheWindowAndKeepsPagesCorrect(t *testing.T) {
	data := readFixture(t, "rag.pdf")
	parser := loadRecorded(t, "rag")
	parser.truncateAbove = 1 // every multi-page window truncates

	rep, err := parse.NewBatcher(parse.Options{}).
		ParsePDF(context.Background(), []parse.PageParser{parser}, data, nil)
	if err != nil {
		t.Fatalf("ParsePDF: %v", err)
	}

	pages := parse.MarkerPages(rep.Markdown)
	if len(pages) != 19 {
		t.Fatalf("got %d markers after the halving retry, want 19", len(pages))
	}
	for i, p := range pages {
		if p != i+1 {
			t.Fatalf("after halving, marker %d is page %d, want %d", i, p, i+1)
		}
	}
	if rep.TruncationEvents == 0 {
		t.Fatal("no truncation events recorded although every wide window truncated")
	}

	// The recursion really went 10 -> 5 -> 2/3 -> 1, not 10 -> 1.
	widths := map[int]int{}
	for _, c := range parser.calls {
		var a, b int
		fmt.Sscanf(c, "%d-%d", &a, &b)
		widths[b-a+1]++
	}
	if widths[1] < 19 {
		t.Fatalf("expected every page to be re-parsed alone eventually; single-page calls = %d (%v)",
			widths[1], parser.calls)
	}
	if len(widths) < 3 {
		t.Fatalf("expected at least three distinct window widths during halving, got %v", widths)
	}
}

// A single page that is STILL truncated is a hard failure, never a silent short
// parse. Spike B's whole point was that the quiet version of this looks like a
// successful parse until someone opens a citation.
func TestSinglePageTruncationIsAHardFailure(t *testing.T) {
	data := readFixture(t, "rag.pdf")
	parser := loadRecorded(t, "rag")
	parser.truncateAbove = 0 // 0 means "never"; set the always-truncate below
	always := &alwaysTruncating{inner: parser}

	_, err := parse.NewBatcher(parse.Options{}).
		ParsePDF(context.Background(), []parse.PageParser{always}, data, nil)
	if err == nil {
		t.Fatal("a page that stays truncated at a one-page window must fail, not return a short document")
	}
	if !strings.Contains(err.Error(), "truncated") {
		t.Fatalf("error should name truncation, got %v", err)
	}
}

type alwaysTruncating struct{ inner *recordedParser }

func (a *alwaysTruncating) ProviderName() string { return a.inner.ProviderName() }
func (a *alwaysTruncating) ParsePages(ctx context.Context, req parse.PageRequest) (parse.PageResult, error) {
	res, err := a.inner.ParsePages(ctx, req)
	res.Finish = parse.PageFinishTruncated
	return res, err
}

// A model that renumbers pages from 1 is exactly what the splitter rule exists
// to catch. The retry must drive the window down to a single page, where the
// splitter's number is authoritative and the model's is discarded.
func TestRenumberedMarkersAreRepairedBySplittingToOnePage(t *testing.T) {
	data := readFixture(t, "rag.pdf")
	parser := loadRecorded(t, "rag")
	parser.renumber = true

	rep, err := parse.NewBatcher(parse.Options{}).
		ParsePDF(context.Background(), []parse.PageParser{parser}, data, nil)
	if err != nil {
		t.Fatalf("ParsePDF: %v", err)
	}
	pages := parse.MarkerPages(rep.Markdown)
	if len(pages) != 19 {
		t.Fatalf("got %d markers, want 19", len(pages))
	}
	for i, p := range pages {
		if p != i+1 {
			t.Fatalf("marker %d is page %d, want %d — the model's renumbering survived", i, p, i+1)
		}
	}
}

// A model that emits no markers at all must not produce a document where every
// passage claims page 1.
func TestMissingMarkersAreSuppliedBySplittingToOnePage(t *testing.T) {
	data := readFixture(t, "rag.pdf")
	parser := loadRecorded(t, "rag")
	parser.dropMarkers = true

	rep, err := parse.NewBatcher(parse.Options{}).
		ParsePDF(context.Background(), []parse.PageParser{parser}, data, nil)
	if err != nil {
		t.Fatalf("ParsePDF: %v", err)
	}
	if got := len(parse.MarkerPages(rep.Markdown)); got != 19 {
		t.Fatalf("got %d markers, want 19", got)
	}
}

// ── the chain ──────────────────────────────────────────────────────────────

// A provider that fails is abandoned for the next one, and the fallback is
// REPORTED. RT-14: a chain that silently re-sends a document to another
// provider is the failure the user most needs to see.
func TestChainFallsBackAndReportsTheDowngrade(t *testing.T) {
	data := readFixture(t, "rag.pdf")
	good := loadRecorded(t, "rag")

	var fallbacks []string
	rep, err := parse.NewBatcher(parse.Options{}).ParsePDF(
		context.Background(),
		[]parse.PageParser{&failingParser{name: "openai"}, good},
		data,
		func(from, to string, cause error) {
			fallbacks = append(fallbacks, from+"->"+to+": "+cause.Error())
		})
	if err != nil {
		t.Fatalf("ParsePDF: %v", err)
	}
	if !rep.Downgraded {
		t.Fatal("report must record that the first provider was not the one that worked")
	}
	if rep.Provider != "gemini" {
		t.Fatalf("provenance says %q, want the provider that actually parsed", rep.Provider)
	}
	if len(fallbacks) != 1 || !strings.HasPrefix(fallbacks[0], "openai->gemini") {
		t.Fatalf("fallback callback = %v, want one openai->gemini entry", fallbacks)
	}
}

func TestEmptyChainIsNamedNotNil(t *testing.T) {
	_, err := parse.NewBatcher(parse.Options{}).
		ParsePDF(context.Background(), nil, readFixture(t, "rag.pdf"), nil)
	if !errors.Is(err, parse.ErrNoParser) {
		t.Fatalf("err = %v, want ErrNoParser", err)
	}
}

type failingParser struct{ name string }

func (f *failingParser) ProviderName() string { return f.name }
func (f *failingParser) ParsePages(context.Context, parse.PageRequest) (parse.PageResult, error) {
	return parse.PageResult{}, errors.New("429 quota exhausted")
}

// ── the caps and guards ────────────────────────────────────────────────────

func TestPageCapRefusesBeforeAnyProviderCall(t *testing.T) {
	data := readFixture(t, "rag.pdf")
	parser := loadRecorded(t, "rag")

	_, err := parse.NewBatcher(parse.Options{MaxPages: 5}).
		ParsePDF(context.Background(), []parse.PageParser{parser}, data, nil)
	if !errors.Is(err, parse.ErrPageCapExceeded) {
		t.Fatalf("err = %v, want ErrPageCapExceeded", err)
	}
	if len(parser.calls) != 0 {
		t.Fatalf("the cap must be enforced before spending provider quota; calls = %v", parser.calls)
	}
}

func TestShortParseAgainstTextLayer(t *testing.T) {
	local := strings.Repeat("real document text. ", 200) // 4000 chars

	if parse.ShortParseAgainstTextLayer(strings.Repeat("x", 3000), local) {
		t.Fatal("75 % of the text layer is not a short parse")
	}
	if !parse.ShortParseAgainstTextLayer(strings.Repeat("x", 1000), local) {
		t.Fatal("25 % of the text layer IS a short parse")
	}
	// A scanned PDF extracts to nothing, and 60 % of nothing would pass
	// everything — so the guard must not fire when there is no text layer.
	if parse.ShortParseAgainstTextLayer("", "") {
		t.Fatal("the guard must not fire when there is no text layer to compare against")
	}
}

// ── sampling helpers ───────────────────────────────────────────────────────

func pagesByNumber(md string) map[int]string {
	lead, bodies, nums := parse.SplitAtMarkers(md)
	out := map[int]string{}
	for i, n := range nums {
		body := ""
		if i < len(bodies) {
			body = bodies[i]
		}
		if i == 0 && lead != "" {
			body = lead + "\n" + body
		}
		out[n] += "\n" + body
	}
	return out
}

// sampleSentence picks a prose sentence: long enough to be distinctive, and not
// a table row, heading, or math line. Spike B excluded the same things for the
// same reason — they measure LaTeX style and column order, not page attribution.
func sampleSentence(page string) string {
	best := ""
	for _, line := range strings.Split(page, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case len(line) < 120,
			strings.HasPrefix(line, "|"), strings.HasPrefix(line, "#"),
			strings.HasPrefix(line, "$$"), strings.HasPrefix(line, "!["),
			strings.Contains(line, "<sup>"), strings.Contains(line, "$"):
			continue
		}
		for _, sentence := range strings.Split(line, ". ") {
			sentence = strings.TrimSpace(sentence)
			if len(sentence) >= 80 && len(sentence) <= 300 && len(sentence) > len(best) {
				best = sentence
			}
		}
		if best != "" {
			return best
		}
	}
	return best
}

// shingleOverlap is Spike B's comparison: what fraction of a quote's 32-char
// letter-only shingles appear in the candidate page's text layer.
//
// Letters only, lowercased, because `ledongthuc/pdf` emits this corpus with no
// spaces at all ("Weexperiment…"); comparing with punctuation and whitespace
// would measure the extractor, not the page attribution.
func shingleOverlap(quote, pageText string) float64 {
	q := lettersOnly(quote)
	hay := lettersOnly(pageText)
	const n = 32
	if len(q) < n || hay == "" {
		return 0
	}
	total, hits := 0, 0
	for i := 0; i+n <= len(q); i += n / 2 {
		total++
		if strings.Contains(hay, q[i:i+n]) {
			hits++
		}
	}
	if total == 0 {
		return 0
	}
	return float64(hits) / float64(total)
}

func lettersOnly(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
