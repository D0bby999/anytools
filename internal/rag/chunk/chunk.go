// Package chunk splits parsed Markdown into retrievable pieces that remember
// which page they came from.
//
// The page range is the whole point. AC1 is "a citation that opens the page
// containing the quoted text", and a chunk that cannot say which page it was on
// cannot satisfy it no matter how good the retrieval is.
//
// How the page survives splitting was measured, not assumed. langchaingo's
// MarkdownTextSplitter does NOT return verbatim substrings of its input — it
// re-renders the Markdown, so only 1 of 107 chunks matched the source text
// exactly and any scheme based on finding a chunk's byte offset would have
// silently mis-attributed the other 106. What it DOES preserve is HTML
// comments: all 19 `<!-- page: N -->` markers in the RAG paper, all 29 in
// Concrete Problems, all 10 in the scanned copy, survived into the chunks
// intact. So the marker travels inside the text and is read back out here,
// then stripped before the chunk is stored.
package chunk

import (
	"strings"

	"github.com/tmc/langchaingo/textsplitter"

	"github.com/D0bby999/anytools/internal/rag/parse"
)

// Chunk is one retrievable piece of a document.
type Chunk struct {
	Ord         int
	HeadingPath string
	PageStart   int
	PageEnd     int
	Text        string
}

// Options tune the splitter. Zero values take the measured defaults.
type Options struct {
	// ChunkSize is in CHARACTERS, not tokens: langchaingo counts characters by
	// default and a tokenizer would pull a model dependency into a package
	// that must work with no keys configured. 1600 characters is ~300-500
	// tokens of English prose, inside the plan's 300-800 band, and measured
	// against the three spike documents it produced chunks of 400-2400
	// characters with the table rows joined.
	ChunkSize int
	// ChunkOverlap is ~12 % of ChunkSize, inside the plan's 10-15 %.
	ChunkOverlap int
}

const (
	// DefaultChunkSize is the measured default. See Options.ChunkSize.
	DefaultChunkSize = 1600
	// DefaultChunkOverlap is 12.5 % of DefaultChunkSize.
	DefaultChunkOverlap = 200
)

func (o Options) withDefaults() Options {
	if o.ChunkSize <= 0 {
		o.ChunkSize = DefaultChunkSize
	}
	if o.ChunkOverlap <= 0 {
		o.ChunkOverlap = DefaultChunkOverlap
	}
	return o
}

// Split turns page-marked Markdown into chunks.
//
// `pageCount` bounds the page numbers a chunk may claim: a marker the parser
// somehow let through for a page that does not exist would otherwise become a
// citation to nowhere.
func Split(markdown string, pageCount int, opts Options) ([]Chunk, error) {
	opts = opts.withDefaults()
	if pageCount < 1 {
		pageCount = 1
	}

	splitter := textsplitter.NewMarkdownTextSplitter(
		textsplitter.WithChunkSize(opts.ChunkSize),
		textsplitter.WithChunkOverlap(opts.ChunkOverlap),
		// Prefixes each chunk with its heading ancestry, which is both how
		// HeadingPath below is recovered and what makes a mid-document chunk
		// self-describing to an embedding model.
		textsplitter.WithHeadingHierarchy(true),
		// Without this every table ROW becomes its own chunk: 43 of 107 chunks
		// on the RAG paper came out under 400 characters, one table row each.
		// With it the same document produced 64 chunks and the rows stayed
		// with their header.
		textsplitter.WithJoinTableRows(true),
		textsplitter.WithCodeBlocks(true),
	)

	raw, err := splitter.SplitText(markdown)
	if err != nil {
		return nil, err
	}

	// The page cursor: the page in effect when a chunk begins. A chunk with no
	// marker of its own belongs to it, because the splitter emits chunks in
	// document order.
	current := 1
	if pages := parse.MarkerPages(markdown); len(pages) > 0 {
		current = pages[0]
	}

	out := make([]Chunk, 0, len(raw))
	for _, text := range raw {
		start, end, next := pageRange(text, current)
		current = next

		start, end = clampPage(start, pageCount), clampPage(end, pageCount)
		if end < start {
			end = start
		}

		body := parse.StripMarkers(text)
		if strings.TrimSpace(body) == "" {
			// A chunk that was nothing but a page marker. It still moved the
			// cursor above, which is the only reason it existed; storing it
			// would put an empty row in the index.
			continue
		}

		out = append(out, Chunk{
			Ord:         len(out),
			HeadingPath: headingPath(body),
			PageStart:   start,
			PageEnd:     end,
			Text:        strings.TrimSpace(body),
		})
	}
	return out, nil
}

// pageRange decides which pages a chunk's text actually came from, and which
// page the NEXT chunk starts on.
//
// The naive rule — "a chunk's page is its first marker" — is wrong, and wrong
// in the direction that breaks citations. The splitter packs text up to a size
// limit, so a chunk routinely holds the tail of page 5 followed by the marker
// for page 6; taking the first marker would file that page-5 text under page 6
// and the citation would open the wrong page. (Both failures were found by
// TestChunkPagesMatchTheSourcePage before this function existed.)
//
// So a page is claimed only when the chunk contains TEXT belonging to it:
//
//   - content before the chunk's first marker belongs to `current`
//   - content after a marker belongs to that marker's page
//   - the cursor advances to the last marker seen, whether or not text followed
//     it, because that is where the next chunk begins
func pageRange(text string, current int) (start, end, next int) {
	lead, bodies, markers := parse.SplitAtMarkers(text)

	if len(markers) == 0 {
		return current, current, current
	}

	var touched []int
	// The splitter prefixes each chunk with its heading ancestry, which is
	// synthetic — it is not text from the previous page, so it must not make
	// the chunk claim that page.
	if strings.TrimSpace(stripLeadingHeadings(lead)) != "" {
		touched = append(touched, current)
	}
	for i, m := range markers {
		if i < len(bodies) && strings.TrimSpace(bodies[i]) != "" {
			touched = append(touched, m)
		}
	}

	next = markers[len(markers)-1]
	if next < current {
		// Chunk overlap can repeat a marker the previous chunk already passed.
		// The cursor must never go backwards, or the pages after it repeat.
		next = current
	}

	if len(touched) == 0 {
		// Marker-only chunk: no text of its own, but it still moves the cursor.
		return markers[0], markers[0], next
	}

	start, end = touched[0], touched[0]
	for _, p := range touched {
		if p < start {
			start = p
		}
		if p > end {
			end = p
		}
	}
	return start, end, next
}

// stripLeadingHeadings removes the heading ancestry the splitter prepends.
func stripLeadingHeadings(s string) string {
	lines := strings.Split(s, "\n")
	i := 0
	for i < len(lines) {
		trimmed := strings.TrimSpace(lines[i])
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			i++
			continue
		}
		break
	}
	return strings.Join(lines[i:], "\n")
}

func clampPage(p, pageCount int) int {
	if p < 1 {
		return 1
	}
	if p > pageCount {
		return pageCount
	}
	return p
}

// headingPath reads the heading ancestry the splitter prefixed onto a chunk and
// renders it as "Title > Section > Subsection".
//
// It reads only the LEADING run of heading lines. A `##` further down is a
// heading that starts inside this chunk, not an ancestor of it, and folding it
// into the path would claim the chunk lives somewhere it only begins.
func headingPath(body string) string {
	var parts []string
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			if len(parts) == 0 {
				continue
			}
			break
		}
		if !strings.HasPrefix(trimmed, "#") {
			break
		}
		heading := strings.TrimSpace(strings.TrimLeft(trimmed, "#"))
		if heading != "" {
			parts = append(parts, heading)
		}
	}
	return strings.Join(parts, " > ")
}
