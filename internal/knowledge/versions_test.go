package knowledge_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// The viewer's contract: parsed Markdown comes back as PAGES, so
// `documents.$docId` can anchor `#page-N` and phase 8 can swap in pdf.js
// without changing what the route consumes.
func TestSplitPagesKeepsEachPageSeparate(t *testing.T) {
	md := parse.Marker(1) + "\nfirst page body\n\n" +
		parse.Marker(2) + "\nsecond page body\n\n" +
		parse.Marker(3) + "\nthird page body\n"

	pages := knowledge.SplitPages(md)
	if len(pages) != 3 {
		t.Fatalf("got %d pages, want 3", len(pages))
	}
	for i, p := range pages {
		if p.Number != i+1 {
			t.Fatalf("page %d numbered %d", i, p.Number)
		}
		if strings.Contains(p.Markdown, "<!-- page:") {
			t.Fatalf("page %d still carries its marker", p.Number)
		}
	}
	if pages[1].Markdown != "second page body" {
		t.Fatalf("page 2 = %q", pages[1].Markdown)
	}
}

// A parser that emits a title above its first marker is producing real text.
// Dropping it silently would be worse than attributing it to page 1.
func TestContentBeforeTheFirstMarkerIsKept(t *testing.T) {
	md := "# A Paper Title\n\n" + parse.Marker(1) + "\nbody of page one\n"
	pages := knowledge.SplitPages(md)
	if len(pages) != 1 {
		t.Fatalf("got %d pages", len(pages))
	}
	if !strings.Contains(pages[0].Markdown, "A Paper Title") {
		t.Fatalf("the lead was dropped: %q", pages[0].Markdown)
	}
	if !strings.Contains(pages[0].Markdown, "body of page one") {
		t.Fatalf("the body was dropped: %q", pages[0].Markdown)
	}
}

// The halving retry can produce a window boundary mid-page, so the same page
// number appears twice. It is one page, joined — not two pages with the same
// number, which would make the viewer's anchors ambiguous.
func TestARepeatedPageNumberBecomesOnePage(t *testing.T) {
	md := parse.Marker(1) + "\nfirst half\n\n" + parse.Marker(1) + "\nsecond half\n\n" +
		parse.Marker(2) + "\npage two\n"
	pages := knowledge.SplitPages(md)
	if len(pages) != 2 {
		t.Fatalf("got %d pages, want 2", len(pages))
	}
	if !strings.Contains(pages[0].Markdown, "first half") || !strings.Contains(pages[0].Markdown, "second half") {
		t.Fatalf("page 1 lost half its content: %q", pages[0].Markdown)
	}
}

func TestUnmarkedDocumentIsOnePage(t *testing.T) {
	pages := knowledge.SplitPages("just some text")
	if len(pages) != 1 || pages[0].Number != 1 {
		t.Fatalf("pages = %+v", pages)
	}
	if knowledge.SplitPages("   ") != nil {
		t.Fatal("an empty document has no pages")
	}
}

// ── through the service ────────────────────────────────────────────────────

func TestDocumentContentServesOnePageForACitation(t *testing.T) {
	h := newHarness(t, &fakeProviders{
		chain:    []knowledge.Parser{newFakeParser("gemini")},
		embedder: newFakeEmbedder("embed-1", 768),
	})
	ctx := context.Background()

	res, err := h.svc.Upload(ctx, h.user, h.kb.ID, "rag.pdf", ragPDF(t))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if err := h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{
		DocumentID: res.Document.ID, KBID: h.kb.ID,
	}, lastAttempt); err != nil {
		t.Fatalf("ProcessDocument: %v", err)
	}

	all, err := h.svc.DocumentContent(ctx, h.user, res.Document.ID, 0)
	if err != nil {
		t.Fatalf("DocumentContent: %v", err)
	}
	if len(all.Pages) != 19 {
		t.Fatalf("got %d pages, want 19", len(all.Pages))
	}

	// The citation path: one page, and it is the right one.
	one, err := h.svc.DocumentContent(ctx, h.user, res.Document.ID, 14)
	if err != nil {
		t.Fatalf("DocumentContent(page 14): %v", err)
	}
	if len(one.Pages) != 1 || one.Pages[0].Number != 14 {
		t.Fatalf("got %+v, want just page 14", one.Pages)
	}
	if !strings.Contains(one.Pages[0].Markdown, fmt.Sprintf("Page %d discusses", 14)) {
		t.Fatalf("page 14 does not contain page 14's text: %.100q", one.Pages[0].Markdown)
	}

	// A page beyond the document opens the viewer empty rather than 404ing: a
	// citation to page 14 of a document re-parsed into 12 pages should still
	// open something.
	beyond, err := h.svc.DocumentContent(ctx, h.user, res.Document.ID, 999)
	if err != nil {
		t.Fatalf("DocumentContent(page 999): %v", err)
	}
	if len(beyond.Pages) != 0 {
		t.Fatalf("expected no pages, got %d", len(beyond.Pages))
	}
	if beyond.Document == nil {
		t.Fatal("the document itself must still come back so the viewer can render its header")
	}
}

func TestDocumentContentRefusesAnUnparsedDocument(t *testing.T) {
	h := newHarness(t, &fakeProviders{})
	ctx := context.Background()

	res, err := h.svc.Upload(ctx, h.user, h.kb.ID, "rag.pdf", ragPDF(t))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	_, err = h.svc.DocumentContent(ctx, h.user, res.Document.ID, 0)
	if !errors.Is(err, knowledge.ErrNoParsedContent) {
		t.Fatalf("err = %v, want ErrNoParsedContent", err)
	}
}
