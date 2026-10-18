// Package parse is AnyTools' document-parsing seam: the user's own model turns
// a PDF into Markdown carrying page markers we can cite.
//
// NEW code, not a port. postclaw has no document parser, so the three clients
// here were written against the wire formats the phase-2 spike measured
// (reports/spike-parse.md): Gemini `generateContent` with inline PDF data,
// OpenAI `/v1/responses` with an `input_file` part, Anthropic `/v1/messages`
// with a `document` content block.
//
// What lives here: the interface, the prompt contract, the three clients and
// their verify pings. What does NOT live here, deliberately: page splitting,
// 10-page batching, the truncation-halving retry and the short-parse guard.
// Those are phase 5's, they need the page-count machinery this phase has no use
// for, and putting them here would mean phase 5 rewriting rather than calling.
package parse

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// ErrNoCandidate reports a 200 that carried no answer at all — a refusal, a
// safety block, or an endpoint that is not what the user thinks it is. It is a
// SENTINEL rather than a formatted message on purpose: the upstream body that
// explains it can echo the document and carry a key fragment, so it is
// classified here and never carried into a string a user might see.
var ErrNoCandidate = errors.New("parse: the provider returned no document")

// ErrEmptyDocument and ErrProbeTextMissing are the two ways a verify ping can
// fail without an HTTP error.
var (
	ErrEmptyDocument    = errors.New("parse: the provider returned an empty document")
	ErrProbeTextMissing = errors.New("parse: the provider did not return the probe page's text")
)

// ErrTruncated reports that the model stopped before finishing the excerpt.
//
// Derived from the provider's own stop field, never from "the output looks
// short" — that is the separate short-parse guard, and conflating them means a
// genuinely short page reads as a truncation while a truncated one that happens
// to be long does not.
var ErrTruncated = errors.New("parse: model output was truncated")

// Result is what one parse call produced.
type Result struct {
	Markdown     string
	FinishReason string
	Truncated    bool
	InputTokens  int
	OutputTokens int
}

// DocumentParser converts a PDF excerpt to Markdown with page markers.
//
// startPage and endPage are ABSOLUTE page numbers in the source document and
// are stated to the model; the `<!-- page: N -->` markers in the output are
// therefore the splitter's numbers, not the model's count. The spike proved
// this is what keeps page attribution correct even when the output truncates:
// forcing ten truncations on a 19-page document left page accuracy at 10/10,
// because the markers never came from the model in the first place.
type DocumentParser interface {
	// Name is the provider identifier ("gemini", "openai", "anthropic").
	Name() string
	// Model is the model id this instance will call.
	Model() string
	// ParsePages converts the given PDF bytes, which must contain exactly the
	// pages startPage..endPage of the source document.
	ParsePages(ctx context.Context, pdfBytes []byte, startPage, endPage int) (Result, error)
	// ParseImage transcribes one photo of a page or notes with ImagePrompt
	// (up-methods phase 16). A lane that does not take this type or size
	// answers ErrImageNotAccepted without a request.
	ParseImage(ctx context.Context, image []byte, mime string) (Result, error)
	// Ping is the verify probe: a one-page parse of a document generated here,
	// whose text is known, so a provider that answers with something other than
	// that text fails rather than passing on a 200.
	Ping(ctx context.Context) error
}

// Prompt is the page-marker contract, shared by all three clients so a fix to
// the wording cannot land in one lane and not the others.
func Prompt(startPage, endPage int) string {
	return fmt.Sprintf(`Convert this PDF excerpt to Markdown.

The excerpt contains exactly %d page(s). They are, in order, pages %d through %d of the source document.

Rules:
1. Before the content of each page, emit a marker alone on its own line: <!-- page: N -->
   N is that page's absolute number in the source document. The first page of this excerpt is page %d, the next is %d, and so on. Use these numbers exactly; do not renumber from 1.
2. Keep the content in page order and never move text across a marker. Text that is printed on page N must appear after <!-- page: N --> and before the next marker.
3. Reproduce tables as GitHub-flavoured Markdown tables with a header separator row. Do not describe a table in prose.
4. Reproduce mathematics as LaTeX: $...$ inline, $$...$$ for display equations.
5. Transcribe everything on every page, including headers, captions, footnotes, references and appendices. Do not summarise and do not skip pages.
6. Output only the Markdown. No preamble, no closing remark, no fence around the whole answer.`,
		endPage-startPage+1, startPage, endPage, startPage, startPage+1)
}

// pingProbeText is printed on the page Ping sends and must appear in the
// answer. A verify that only checked for HTTP 200 would pass against an
// endpoint that returns an empty body — which is exactly what a stored api_base
// missing its version segment does (spike A: HTTP 200, empty body,
// finish_reason "stop").
const pingProbeText = "AnyTools verify page"

// checkPing validates a ping result. Exported behaviour lives here rather than
// in each client so the three lanes cannot disagree about what "verified" means.
func checkPing(name string, r Result, err error) error {
	if err != nil {
		return err
	}
	if strings.TrimSpace(r.Markdown) == "" {
		return fmt.Errorf("%s: %w", name, ErrEmptyDocument)
	}
	// Matched against the constant the probe PDF is generated from, so the two
	// cannot drift into a check that can never pass.
	if !strings.Contains(r.Markdown, pingProbeText) {
		return fmt.Errorf("%s: %w", name, ErrProbeTextMissing)
	}
	return nil
}
