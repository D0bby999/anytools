package chunk_test

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/rag/chunk"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// The recorded Gemini output for the spike corpus. Chunking is tested against
// what a real model produced, not against handwritten Markdown, because the
// property under test — that the page marker survives the splitter — is a fact
// about langchaingo's behaviour on real documents.
func recorded(t *testing.T, stem string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "parse", "testdata", "recorded", stem+".gemini.md"))
	if err != nil {
		t.Fatalf("read recording: %v", err)
	}
	return string(b)
}

// The central invariant: every chunk knows a page, and that page is one the
// document actually has. AC1 cannot hold without it.
func TestEveryChunkCarriesAPageInRange(t *testing.T) {
	for _, tc := range []struct {
		stem  string
		pages int
	}{
		{"rag", 19},
		{"concrete-ai-safety", 29},
		{"scanned-rag-10p", 10},
	} {
		t.Run(tc.stem, func(t *testing.T) {
			chunks, err := chunk.Split(recorded(t, tc.stem), tc.pages, chunk.Options{})
			if err != nil {
				t.Fatalf("Split: %v", err)
			}
			if len(chunks) < 20 {
				t.Fatalf("only %d chunks from a %d-page document", len(chunks), tc.pages)
			}
			for _, c := range chunks {
				if c.PageStart < 1 || c.PageStart > tc.pages {
					t.Fatalf("chunk %d claims page %d of %d", c.Ord, c.PageStart, tc.pages)
				}
				if c.PageEnd < c.PageStart || c.PageEnd > tc.pages {
					t.Fatalf("chunk %d has page range %d-%d", c.Ord, c.PageStart, c.PageEnd)
				}
				if strings.TrimSpace(c.Text) == "" {
					t.Fatalf("chunk %d is empty", c.Ord)
				}
			}
		})
	}
}

// Page attribution must be exact, not approximate. This walks the document's
// own page bodies and checks that a distinctive line from each page ends up in
// a chunk claiming that page.
func TestChunkPagesMatchTheSourcePage(t *testing.T) {
	md := recorded(t, "rag")
	chunks, err := chunk.Split(md, 19, chunk.Options{})
	if err != nil {
		t.Fatalf("Split: %v", err)
	}

	_, bodies, nums := parse.SplitAtMarkers(md)
	checked := 0
	for i, page := range nums {
		line := longestProseLine(bodies[i])
		if line == "" {
			continue
		}
		needle := normalise(line)
		found := false
		for _, c := range chunks {
			if !strings.Contains(normalise(c.Text), needle) {
				continue
			}
			found = true
			if page < c.PageStart || page > c.PageEnd {
				t.Fatalf("text from page %d landed in a chunk claiming pages %d-%d:\n%.120q",
					page, c.PageStart, c.PageEnd, line)
			}
			break
		}
		if found {
			checked++
		}
	}
	if checked < 12 {
		t.Fatalf("only %d of 19 pages could be checked", checked)
	}
	t.Logf("verified page attribution on %d pages", checked)
}

// Chunks must land inside the plan's 300-800 token band. Characters are what
// the splitter counts; ~4 characters per token of English prose puts the
// 1600-character target in the middle of the band.
func TestChunkSizesStayInBand(t *testing.T) {
	chunks, err := chunk.Split(recorded(t, "rag"), 19, chunk.Options{})
	if err != nil {
		t.Fatalf("Split: %v", err)
	}
	oversized, tiny := 0, 0
	for _, c := range chunks {
		switch {
		case len(c.Text) > 3200:
			oversized++
		case len(c.Text) < 200:
			tiny++
		}
	}
	if oversized > 0 {
		t.Fatalf("%d chunks exceed 3200 characters (~800 tokens)", oversized)
	}
	// A handful of short chunks is normal — a section that simply ends. A
	// majority of them is the table-row failure: without WithJoinTableRows the
	// RAG paper produced 43 single-row chunks out of 107.
	if tiny*2 > len(chunks) {
		t.Fatalf("%d of %d chunks are under 200 characters — table rows are not being joined",
			tiny, len(chunks))
	}
	t.Logf("%d chunks, %d short", len(chunks), tiny)
}

func TestHeadingPathIsTheAncestryNotTheFirstHeadingInside(t *testing.T) {
	chunks, err := chunk.Split(recorded(t, "rag"), 19, chunk.Options{})
	if err != nil {
		t.Fatalf("Split: %v", err)
	}
	withPath := 0
	for _, c := range chunks {
		if c.HeadingPath == "" {
			continue
		}
		withPath++
		if !strings.Contains(c.HeadingPath, "Retrieval-Augmented Generation") {
			t.Fatalf("chunk %d heading path %q does not start from the document title", c.Ord, c.HeadingPath)
		}
	}
	if withPath*2 < len(chunks) {
		t.Fatalf("only %d of %d chunks carry a heading path", withPath, len(chunks))
	}
}

func TestOrdIsDenseAndOrdered(t *testing.T) {
	chunks, err := chunk.Split(recorded(t, "rag"), 19, chunk.Options{})
	if err != nil {
		t.Fatalf("Split: %v", err)
	}
	for i, c := range chunks {
		if c.Ord != i {
			t.Fatalf("chunk %d has ord %d — the unique (document_id, ord) index needs a dense sequence", i, c.Ord)
		}
	}
}

// A chunk that was nothing but a page marker must not be stored — but it must
// still move the page cursor, or everything after it is attributed to the
// previous page.
func TestMarkerOnlyChunksAdvanceThePageButAreNotStored(t *testing.T) {
	var md strings.Builder
	for p := 1; p <= 4; p++ {
		fmt.Fprintf(&md, "%s\n\n## Section %d\n\n%s\n\n", parse.Marker(p), p,
			strings.Repeat(fmt.Sprintf("Page %d body sentence number one. ", p), 30))
	}
	chunks, err := chunk.Split(md.String(), 4, chunk.Options{})
	if err != nil {
		t.Fatalf("Split: %v", err)
	}
	for _, c := range chunks {
		if strings.Contains(c.Text, "<!-- page:") {
			t.Fatalf("chunk %d still contains a page marker: %q", c.Ord, c.Text)
		}
		want := fmt.Sprintf("Page %d body", c.PageStart)
		if !strings.Contains(c.Text, want) {
			t.Fatalf("chunk %d claims page %d but its text is %.80q", c.Ord, c.PageStart, c.Text)
		}
	}
}

func TestDocumentWithoutMarkersIsAllPageOne(t *testing.T) {
	chunks, err := chunk.Split(strings.Repeat("Some plain text with no markers at all. ", 200), 1, chunk.Options{})
	if err != nil {
		t.Fatalf("Split: %v", err)
	}
	if len(chunks) == 0 {
		t.Fatal("no chunks")
	}
	for _, c := range chunks {
		if c.PageStart != 1 || c.PageEnd != 1 {
			t.Fatalf("chunk %d claims pages %d-%d for an unpaginated document", c.Ord, c.PageStart, c.PageEnd)
		}
	}
}

// A marker for a page beyond the document's length would become a citation to
// nowhere.
func TestPagesAreClampedToTheDocument(t *testing.T) {
	md := parse.Marker(1) + "\n" + strings.Repeat("body text here. ", 60) + "\n" +
		parse.Marker(999) + "\n" + strings.Repeat("more body text here. ", 60)
	chunks, err := chunk.Split(md, 2, chunk.Options{})
	if err != nil {
		t.Fatalf("Split: %v", err)
	}
	for _, c := range chunks {
		if c.PageEnd > 2 {
			t.Fatalf("chunk %d claims page %d in a 2-page document", c.Ord, c.PageEnd)
		}
	}
}

func longestProseLine(body string) string {
	best := ""
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "|") || strings.HasPrefix(line, "#") || strings.Contains(line, "<sup>") {
			continue
		}
		if len(line) > len(best) && len(line) < 300 {
			best = line
		}
	}
	if len(best) < 60 {
		return ""
	}
	return best[:60]
}

func normalise(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(s)), " ")
}
