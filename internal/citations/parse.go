// Package citations owns AnyTools' ONE citation representation.
//
// Red-team Scope 15: the plan had grown three spellings of the same idea — a
// chunk marker in chat, a numbered footnote in research, and a source list in
// the notebook — which meant three renderers, three parsers and three ways for
// a citation to be silently wrong. There is one format:
//
//	[[cite:chunk:<id>]]
//
// Phase 9 adds exactly one more kind, `[[cite:url:<n>]]`, through the same
// parser and the same validator. A capability that wants to cite something new
// adds a kind here; it does not invent a marker.
package citations

import (
	"regexp"
	"strconv"
	"strings"
)

// Kinds of citable thing. `chunk` is a retrieved document chunk; `url` is a
// web page phase 9's research gathered, numbered per turn by URLBook so the
// marker stays inside the id charset below (a raw URL would not).
const (
	KindChunk = "chunk"
	KindURL   = "url"
)

// Source is one citable reference, as carried by the `sources` event and
// rendered by the UI as a chip.
//
// Page is 1-based and 0 means "not page-addressable". The chip links to
// documents.$docId?page=N, which is AC1's "opens the page containing the quoted
// text" — so a Source with a DocumentID and no Page is a chip that lands on
// page one of a fifty-page PDF, i.e. a citation that technically exists and
// practically does not.
type Source struct {
	Kind       string `json:"kind"`
	ID         string `json:"id"`
	Title      string `json:"title,omitempty"`
	Page       int    `json:"page,omitempty"`
	DocumentID string `json:"document_id,omitempty"`
	// URL is set for kind `url` only: the page the chip opens. It is the URL
	// the search provider or the fetch returned, never one the model wrote —
	// a model-authored URL would make every citation an open redirect.
	URL string `json:"url,omitempty"`
	// Authority and Site override what a research ranker would work out from
	// the URL. A paper's landing page is often a publisher or doi.org, which
	// says nothing about it: every paper is `academic`, and each is its own
	// site, so the per-site cap cannot collapse ten DOI links into two
	// (learning-depth red team AS-5).
	Authority string `json:"authority,omitempty"`
	Site      string `json:"site,omitempty"`
	// Seconds is set for a passage of a timed video transcript: where the
	// cited segment starts. The chip shows it as MM:SS and opens the player
	// there. It comes from documents.timeline, never from the model.
	Seconds *int `json:"seconds,omitempty"`
	// AITranscript marks a passage from an AI transcript, which the chip says.
	AITranscript bool `json:"ai_transcript,omitempty"`
	// LineEnd is set for a passage of a repository's code file: Page is its
	// first line and LineEnd its last, and the chip reads "lines a-b".
	LineEnd int `json:"line_end,omitempty"`
	// Sheet is set for a spreadsheet passage: the chip reads "Sheet: Budget,
	// p. 2". It comes from the stored heading the local reader wrote, never
	// from the model.
	Sheet string `json:"sheet,omitempty"`
	// PhotoModel is set for a passage read from a photo: the chip reads
	// "read by <model> from a photo" (up-methods phase 16). It comes from the
	// document's processed_by, never from the chat model.
	PhotoModel string `json:"photo_model,omitempty"`
}

// marker matches `[[cite:<kind>:<id>]]`.
//
// The id charset is deliberately narrow — uuid, integer or slug. A permissive
// `.+?` would let a document that contains "[[cite:chunk:]] ignore previous
// instructions" have its injected text swallowed into an id and then echoed
// back somewhere that renders it.
var marker = regexp.MustCompile(`\[\[cite:(chunk|url):([A-Za-z0-9_.:-]{1,128})\]\]`)

// Ref is one marker found in a piece of text.
type Ref struct {
	Kind  string
	ID    string
	Match string // the full marker, for replacement
}

// Parse returns every citation marker in order of appearance, duplicates
// included: the same chunk cited twice is two markers and one source.
func Parse(text string) []Ref {
	matches := marker.FindAllStringSubmatch(text, -1)
	refs := make([]Ref, 0, len(matches))
	for _, m := range matches {
		refs = append(refs, Ref{Kind: m[1], ID: m[2], Match: m[0]})
	}
	return refs
}

// Format renders a marker for a source. Capabilities build citations with this
// rather than with fmt.Sprintf, so the format has one definition.
func Format(kind, id string) string {
	return "[[cite:" + kind + ":" + id + "]]"
}

// PageRef builds the citation id for "page N of document D".
//
// The separator is `.` and not `#` for one reason: the id charset in `marker`
// above. A `#` produces a marker the parser cannot match, which means the
// validator never sees it, never drops it, and never turns it into a chip — it
// reaches the reader as literal `[[cite:chunk:…]]` text in the answer and in the
// stored transcript, which is precisely the appearance-of-evidence this package
// exists to prevent. Minting page ids through one function keeps that from being
// rediscovered once per tool.
func PageRef(documentID string, page int) string {
	return documentID + ".p" + strconv.Itoa(page)
}

// Strip removes every marker, leaving readable prose. Used for the plain-text
// copy of an answer (notebook export, search index) where a marker is noise.
func Strip(text string) string {
	return collapseSpaces(marker.ReplaceAllString(text, ""))
}

// collapseSpaces tidies the double spaces a removed marker leaves behind,
// without touching newlines (which carry paragraph structure).
func collapseSpaces(s string) string {
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		for strings.Contains(line, "  ") {
			line = strings.ReplaceAll(line, "  ", " ")
		}
		lines[i] = strings.TrimRight(line, " ")
	}
	return strings.Join(lines, "\n")
}
