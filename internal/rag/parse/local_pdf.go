package parse

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/ledongthuc/pdf"
)

// LocalPDFText extracts a PDF's text layer, one marked page at a time.
//
// Read Spike B before trusting this for anything but what it is for:
// `ledongthuc/pdf` emitted the spike corpus with NO SPACES AT ALL
// ("Weexperiment…") and scored 0 on tables. It is a **text-layer liveness
// check**, not a parser. Two jobs, both of them real:
//
//  1. Deciding whether a PDF is scanned. Under 400 characters per page means
//     there is no text layer, so a lane without vision cannot read it and the
//     document must fail loudly rather than index a blank.
//  2. Being the denominator of the short-parse guard: an LLM parse under 60 %
//     of this is a parse that skipped pages.
//
// Its page markers are written here, by us, so its page accuracy is perfect by
// construction and means nothing.
func localPDFText(data []byte) (string, int, error) {
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", 0, fmt.Errorf("parse: read pdf text layer: %w", err)
	}
	pages := r.NumPage()
	var sb strings.Builder
	for i := 1; i <= pages; i++ {
		sb.WriteString(Marker(i))
		sb.WriteString("\n")
		p := r.Page(i)
		if p.V.IsNull() {
			sb.WriteString("\n")
			continue
		}
		txt, err := p.GetPlainText(nil)
		if err != nil {
			// A page this library cannot decode is not a document-level
			// failure: the caller is measuring how much text exists, and one
			// unreadable page is part of that measurement.
			sb.WriteString("\n")
			continue
		}
		sb.WriteString(strings.TrimSpace(txt))
		sb.WriteString("\n\n")
	}
	return strings.TrimSpace(sb.String()) + "\n", pages, nil
}

// LooksScanned reports whether a PDF's text layer is too thin to be real text.
//
// Same 400-characters-per-page floor as the short-parse guard, for the same
// measured reason: healthy pages produced thousands.
func LooksScanned(textLayer string, pages int) bool {
	if pages < 1 {
		return true
	}
	return len(StripMarkers(textLayer))/pages < DefaultMinCharsPerPage
}

// LocalPDFText is localPDFText behind the parser panic guard (guard.go).
func LocalPDFText(data []byte) (string, int, error) {
	return guarded("pdf", func() (string, int, error) { return localPDFText(data) })
}
