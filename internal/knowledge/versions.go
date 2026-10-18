package knowledge

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/rag/parse"
)

// Page is one page of a parsed document.
type Page struct {
	Number   int    `json:"page"`
	Markdown string `json:"markdown"`
}

// DocumentContent is what the viewer renders.
//
// Pages, not one blob of Markdown with markers left in. The viewer route
// `documents.$docId` scrolls to `#page-N`, and phase 8 replaces the renderer
// with pdf.js/epub.js IN PLACE — so the page split has to be part of the
// contract, not a detail of one renderer.
type DocumentContent struct {
	Document *Document `json:"document"`
	Pages    []Page    `json:"pages"`
}

// ErrNoParsedContent is returned for a document that has not been parsed yet.
var ErrNoParsedContent = errors.New("knowledge: this document has not been parsed yet")

// DocumentContent reads a document's parsed Markdown and splits it into pages.
//
// `page` selects one page; zero returns all of them. The single-page form is
// what makes a citation cheap to open: the chat panel needs page 14 of a
// 400-page document, not the whole thing.
func (s *Service) DocumentContent(ctx context.Context, userID, docID uuid.UUID, page int) (*DocumentContent, error) {
	doc, err := s.store.GetDocument(ctx, userID, docID)
	if err != nil {
		return nil, err
	}
	if doc.ParsedMarkdownPath == "" {
		return nil, ErrNoParsedContent
	}
	md, err := s.blobs.GetParsed(ctx, doc.ParsedMarkdownPath)
	if err != nil {
		return nil, err
	}

	pages := SplitPages(md)
	if page > 0 {
		for _, p := range pages {
			if p.Number == page {
				return &DocumentContent{Document: doc, Pages: []Page{p}}, nil
			}
		}
		// A page the document does not have is an empty page, not an error: a
		// citation to page 14 of a document that was re-parsed into 12 pages
		// should open the viewer, not a 404.
		return &DocumentContent{Document: doc, Pages: nil}, nil
	}
	return &DocumentContent{Document: doc, Pages: pages}, nil
}

// SplitPages divides page-marked Markdown at its markers.
//
// Content before the first marker is attached to the first page rather than
// dropped — a parser that emits a title line above its first marker is
// producing real text, and losing it silently would be worse than attributing
// it to page 1.
func SplitPages(md string) []Page {
	lead, segments, numbers := parse.SplitAtMarkers(md)
	if len(numbers) == 0 {
		if lead == "" {
			return nil
		}
		return []Page{{Number: 1, Markdown: lead}}
	}

	byPage := map[int]*strings.Builder{}
	order := []int{}
	for i, num := range numbers {
		body := ""
		if i < len(segments) {
			body = segments[i]
		}
		if i == 0 && lead != "" {
			body = strings.TrimSpace(lead + "\n\n" + body)
		}
		b, ok := byPage[num]
		if !ok {
			b = &strings.Builder{}
			byPage[num] = b
			order = append(order, num)
		} else if b.Len() > 0 && body != "" {
			// A page marked twice — the halving retry can produce that when a
			// window boundary lands mid-page — is one page, joined.
			b.WriteString("\n\n")
		}
		b.WriteString(body)
	}

	sort.Ints(order)
	out := make([]Page, 0, len(order))
	for _, num := range order {
		out = append(out, Page{Number: num, Markdown: strings.TrimSpace(byPage[num].String())})
	}
	return out
}
