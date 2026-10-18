package citations

import (
	"strings"
	"sync"
	"testing"
)

// A research report cites chunks and web pages in one text, through one
// validator. A url marker the turn did not gather is dropped exactly like a
// chunk marker nobody retrieved.
func TestValidateResolvesURLCitationsAgainstTheGatheredSet(t *testing.T) {
	book := NewURLBook()
	first := book.ID("https://example.org/a")
	second := book.ID("https://example.org/b")

	known := Index([]Source{
		{Kind: KindChunk, ID: "c1", Title: "Notes.pdf", Page: 3, DocumentID: "d1"},
		{Kind: KindURL, ID: first, Title: "A", URL: "https://example.org/a"},
		{Kind: KindURL, ID: second, Title: "B", URL: "https://example.org/b"},
	})
	text := "Chunk " + Format(KindChunk, "c1") + ". Web " + Format(KindURL, first) +
		" and " + Format(KindURL, second) + ". Invented " + Format(KindURL, "9") + "."

	res := Validate(text, known)
	if len(res.Dropped) != 1 || res.Dropped[0].ID != "9" {
		t.Fatalf("dropped = %+v, want only url:9", res.Dropped)
	}
	if strings.Contains(res.Text, "url:9") {
		t.Fatalf("an ungathered url citation survived: %q", res.Text)
	}
	if len(res.Sources) != 3 || res.Sources[1].URL != "https://example.org/a" {
		t.Fatalf("sources = %+v", res.Sources)
	}
}

func TestURLBookNumbersPerTurnAndKeepsANumberForARepeat(t *testing.T) {
	book := NewURLBook()
	if got := book.ID("https://a.test/"); got != "1" {
		t.Fatalf("first = %s", got)
	}
	if got := book.ID("https://b.test/"); got != "2" {
		t.Fatalf("second = %s", got)
	}
	if got := book.ID("https://a.test/"); got != "1" {
		t.Fatalf("repeat = %s, want 1", got)
	}
	// Every id the book mints must survive the marker parser.
	if refs := Parse(Format(KindURL, book.ID("https://c.test/?q=x&y=1"))); len(refs) != 1 {
		t.Fatal("a minted url id does not parse as a marker")
	}
}

func TestURLBookIsSafeUnderConcurrentGathers(t *testing.T) {
	book := NewURLBook()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			book.ID("https://same.test/")
		}()
	}
	wg.Wait()
	if book.Len() != 1 || book.ID("https://same.test/") != "1" {
		t.Fatalf("concurrent ids diverged: len %d", book.Len())
	}
}
