package parse

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// PageMarker is the one citation anchor in a parsed document. Every downstream
// consumer — the chunker's page ranges, the viewer's anchors, phase 6's
// citations — reads this and nothing else.
const pageMarkerFormat = "<!-- page: %d -->"

var pageMarkerRE = regexp.MustCompile(`(?m)^[ \t]*<!--[ \t]*page:[ \t]*(\d+)[ \t]*-->[ \t]*$`)

// Marker renders the marker for a page.
func Marker(page int) string { return fmt.Sprintf(pageMarkerFormat, page) }

// MarkerPages lists, in order, the page numbers marked in a Markdown document.
func MarkerPages(md string) []int {
	matches := pageMarkerRE.FindAllStringSubmatch(md, -1)
	out := make([]int, 0, len(matches))
	for _, m := range matches {
		n, err := strconv.Atoi(m[1])
		if err != nil {
			continue
		}
		out = append(out, n)
	}
	return out
}

// StripMarkers removes every page marker line.
func StripMarkers(md string) string {
	return strings.TrimSpace(pageMarkerRE.ReplaceAllString(md, ""))
}

// SplitAtMarkers divides a document at its page markers.
//
// It returns the text BEFORE the first marker separately from the per-marker
// bodies, because those are different things: a title line a parser emitted
// above its first marker belongs to the document but not, strictly, to a page,
// and the caller decides what to do with it. `pages` is index-aligned with
// `bodies`.
func SplitAtMarkers(md string) (lead string, bodies []string, pages []int) {
	pages = MarkerPages(md)
	if len(pages) == 0 {
		return strings.TrimSpace(md), nil, nil
	}
	parts := pageMarkerRE.Split(md, -1)
	if len(parts) > 0 {
		lead = strings.TrimSpace(parts[0])
		parts = parts[1:]
	}
	bodies = make([]string, len(pages))
	for i := range pages {
		if i < len(parts) {
			bodies[i] = strings.TrimSpace(parts[i])
		}
	}
	return lead, bodies, pages
}

// markerVerdict is what checkMarkers decided about one batch's output.
type markerVerdict int

const (
	// markersOK: every marker is inside the window, non-decreasing, and the
	// window's first page is marked.
	markersOK markerVerdict = iota
	// markersBad: the model renumbered, skipped, or invented pages. The
	// response is unusable as-is and the window must be halved.
	markersBad
)

// checkMarkers validates a batch's markers against the range the SPLITTER
// knows the bytes to cover.
//
// This is the enforcement half of "page markers come from the splitter, never
// the model". The prompt asks for absolute numbers; this function is what
// happens when the model does not comply. It never repairs a multi-page batch
// by guessing — a wrong page number is worse than a slow one, because the
// citation will look right and open the wrong page.
func checkMarkers(md string, start, end int) markerVerdict {
	pages := MarkerPages(md)
	if len(pages) == 0 {
		return markersBad
	}
	// The first page of the window must be accounted for, or everything after
	// it is attributed to the wrong page.
	if pages[0] != start {
		return markersBad
	}
	prev := 0
	seen := map[int]bool{}
	for _, p := range pages {
		if p < start || p > end {
			return markersBad
		}
		if p < prev {
			// Out of order: the model moved text across a marker.
			return markersBad
		}
		prev = p
		seen[p] = true
	}
	// A window whose pages are not all marked has silently merged pages, so a
	// quote from the missing page would be attributed to its predecessor.
	for p := start; p <= end; p++ {
		if !seen[p] {
			return markersBad
		}
	}
	return markersOK
}

// authoritativeSinglePage rewrites a one-page batch's markers to the splitter's
// number.
//
// At a window of one page there is exactly one correct answer and the splitter
// has it, so the model's opinion is discarded outright rather than validated.
// This is the base case that makes the halving retry terminate with a correct
// document instead of a hard failure: Spike B forced ten MAX_TOKENS events and
// page accuracy stayed 10/10 precisely because the recursion bottoms out here.
func authoritativeSinglePage(md string, page int) string {
	body := StripMarkers(md)
	if body == "" {
		return Marker(page) + "\n"
	}
	return Marker(page) + "\n" + body + "\n"
}

// isShortParse reports whether a batch produced implausibly little Markdown.
//
// Deliberately independent of the provider's finish reason: in Spike B the
// guard caught 8 of 10 truncated batches on its own, and it is the only signal
// that fires for a PDF with no text layer parsed by a lane that reports a clean
// stop.
func isShortParse(markdown string, pages, minCharsPerPage int) bool {
	if pages < 1 {
		return false
	}
	return len(strings.TrimSpace(markdown))/pages < minCharsPerPage
}
