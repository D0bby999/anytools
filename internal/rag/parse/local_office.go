package parse

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// maxZipEntryBytes bounds a single decompressed entry.
//
// A zip container reports its own uncompressed sizes and a hostile one lies:
// 50 MB of upload can claim to be gigabytes of XML. Every reader below goes
// through a limit, so a zip bomb is a rejected document rather than an OOM.
const maxZipEntryBytes = 32 << 20

// maxZipEntries bounds how many parts are read at all.
const maxZipEntries = 5000

// MaxDecompressedBytes bounds everything one document may inflate to, across
// all its entries. The per-entry cap alone let a 718 KB .pptx of twelve 60 MB
// slides through, allocating 11 GB (security audit F-2): each entry was under
// the limit and nothing added them up. 96 MB of XML is several times a real
// 400-page book's; everything read is also decoded and copied, so the
// allocation behind the budget is a multiple of it.
const MaxDecompressedBytes = 96 << 20

// ErrTooLarge is returned when a container inflates past its budget.
var ErrTooLarge = errors.New("parse: the file expands to more text than AnyLearn reads")

// inflateBudget is the remaining decompressed bytes for one document.
type inflateBudget struct{ left int64 }

func newInflateBudget() *inflateBudget { return &inflateBudget{left: MaxDecompressedBytes} }

// ─────────────────────────────────────────────────────────────────── DOCX

// LocalDOCXText extracts a .docx to Markdown-ish text.
//
// A Word file has no pages until something lays it out, so there is exactly one
// page marker. That is not a shortcut: claiming page numbers a renderer would
// have invented is how a citation ends up pointing at a page that does not
// exist in the reader's copy.
//
// The container is read directly — zip + xml, no library — so that
// `word/document.xml` goes through the same per-entry and per-document budget
// as every other part. The library this used to call read that entry with an
// unbounded ReadAll: a 509 KB file inflating to 512 MB allocated 1.7 GB before
// failing (security audit F-2).
func localDOCXText(data []byte) (string, int, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", 0, fmt.Errorf("parse: docx: %w", err)
	}
	var doc *zip.File
	for i, f := range zr.File {
		if i >= maxZipEntries {
			break
		}
		if f.Name == "word/document.xml" {
			doc = f
			break
		}
	}
	if doc == nil {
		return "", 0, fmt.Errorf("parse: docx: no word/document.xml")
	}
	raw, err := readZipFile(doc, newInflateBudget())
	if err != nil {
		return "", 0, fmt.Errorf("parse: docx: %w", err)
	}
	text, err := wordMLText(raw)
	if err != nil {
		return "", 0, fmt.Errorf("parse: docx: %w", err)
	}
	if strings.TrimSpace(text) == "" {
		return "", 0, fmt.Errorf("parse: docx: no text in word/document.xml")
	}
	return Marker(1) + "\n" + text + "\n", 1, nil
}

// wordMLText walks WordprocessingML, turning <w:t> into text, <w:p> into a
// paragraph break and <w:tab> into a tab. A regex over the XML would also
// "work" until the first document containing the string "<w:t>" inside a
// comment or a field code.
func wordMLText(raw []byte) (string, error) {
	dec := xml.NewDecoder(bytes.NewReader(raw))
	var sb strings.Builder
	inText := false
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "t":
				inText = true
			case "tab":
				sb.WriteString("\t")
			case "br":
				sb.WriteString("\n")
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inText = false
			case "p":
				sb.WriteString("\n\n")
			}
		case xml.CharData:
			if inText {
				sb.Write(t)
			}
		}
	}
	return collapseBlankLines(sb.String()), nil
}

// ─────────────────────────────────────────────────────────────────── PPTX

var slideNameRE = regexp.MustCompile(`^ppt/slides/slide(\d+)\.xml$`)

// LocalPPTXText extracts a .pptx by reading its slide parts directly —
// zip + xml, no library.
//
// Each slide is one "page". A deck is the one non-PDF format where page
// numbers are real and stable: slide 7 is slide 7 in every renderer, so a
// citation to it survives being opened somewhere else.
func localPPTXText(data []byte) (string, int, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", 0, fmt.Errorf("parse: pptx: %w", err)
	}
	type slide struct {
		n    int
		file *zip.File
	}
	var slides []slide
	for i, f := range zr.File {
		if i >= maxZipEntries {
			break
		}
		m := slideNameRE.FindStringSubmatch(f.Name)
		if m == nil {
			continue
		}
		n, err := strconv.Atoi(m[1])
		if err != nil {
			continue
		}
		slides = append(slides, slide{n: n, file: f})
	}
	if len(slides) == 0 {
		return "", 0, fmt.Errorf("parse: pptx: no slides found")
	}
	// Counted BEFORE anything is inflated: a slide is a page, and a deck over
	// the page cap is refused as a PDF over it is.
	if len(slides) > DefaultMaxPages {
		return "", 0, fmt.Errorf("%w: %d slides, the limit is %d", ErrPageCapExceeded, len(slides), DefaultMaxPages)
	}
	budget := newInflateBudget()
	// Zip entry order is whatever the writer chose; slide10 sorts before
	// slide2 lexically, so ordering by the parsed number is what keeps slide
	// numbers and page markers aligned.
	sort.Slice(slides, func(i, j int) bool { return slides[i].n < slides[j].n })

	var sb strings.Builder
	for idx, s := range slides {
		raw, err := readZipFile(s.file, budget)
		if err != nil {
			return "", 0, fmt.Errorf("parse: pptx slide %d: %w", s.n, err)
		}
		text, err := drawingMLText(raw)
		if err != nil {
			return "", 0, fmt.Errorf("parse: pptx slide %d: %w", s.n, err)
		}
		// Markers are sequential positions, not the file's own numbering: a
		// deck with slide3.xml deleted still has a page 3.
		sb.WriteString(Marker(idx + 1))
		sb.WriteString("\n")
		sb.WriteString(text)
		sb.WriteString("\n\n")
	}
	return strings.TrimSpace(sb.String()) + "\n", len(slides), nil
}

// drawingMLText pulls <a:t> runs out of a slide, breaking paragraphs on <a:p>.
func drawingMLText(raw []byte) (string, error) {
	dec := xml.NewDecoder(bytes.NewReader(raw))
	var sb strings.Builder
	inText := false
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "t" {
				inText = true
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inText = false
			case "p":
				sb.WriteString("\n")
			}
		case xml.CharData:
			if inText {
				sb.Write(t)
			}
		}
	}
	return collapseBlankLines(sb.String()), nil
}

// ───────────────────────────────────────────────────────────────── helpers

// readZipFile inflates one entry, charging it to the document's budget. The
// sizes the zip header declares are the uploader's to lie about, so the limit
// is on the bytes actually read.
func readZipFile(f *zip.File, budget *inflateBudget) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return readBudgeted(rc, f.Name, budget)
}

func readBudgeted(r io.Reader, name string, budget *inflateBudget) ([]byte, error) {
	limit := int64(maxZipEntryBytes)
	if budget.left < limit {
		limit = budget.left
	}
	b, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		if limit < maxZipEntryBytes {
			return nil, fmt.Errorf("%w (%s)", ErrTooLarge, name)
		}
		return nil, fmt.Errorf("%w: entry %q exceeds %d bytes", ErrTooLarge, name, maxZipEntryBytes)
	}
	budget.left -= int64(len(b))
	return b, nil
}

var blankLinesRE = regexp.MustCompile(`\n{3,}`)

func collapseBlankLines(s string) string {
	lines := strings.Split(s, "\n")
	for i := range lines {
		lines[i] = strings.TrimRight(lines[i], " \t\r")
	}
	return strings.TrimSpace(blankLinesRE.ReplaceAllString(strings.Join(lines, "\n"), "\n\n"))
}

// LocalDOCXText is localDOCXText behind the parser panic guard (guard.go).
func LocalDOCXText(data []byte) (string, int, error) {
	return guarded("docx", func() (string, int, error) { return localDOCXText(data) })
}

// LocalPPTXText is localPPTXText behind the parser panic guard (guard.go).
func LocalPPTXText(data []byte) (string, int, error) {
	return guarded("pptx", func() (string, int, error) { return localPPTXText(data) })
}
