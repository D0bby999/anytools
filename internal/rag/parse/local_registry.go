package parse

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
)

// Kind is a document family, decided once at upload and carried from there.
type Kind string

const (
	KindPDF  Kind = "pdf"
	KindDOCX Kind = "docx"
	KindPPTX Kind = "pptx"
	KindEPUB Kind = "epub"
	KindHTML Kind = "html"
	KindText Kind = "text"
	KindMD   Kind = "markdown"
	KindXLSX Kind = "xlsx"
	KindCSV  Kind = "csv"
	KindTSV  Kind = "tsv"
	// KindImage is a photo of a page or notes (up-methods phase 16, photo.go).
	KindImage Kind = "image"
	KindOther Kind = ""
)

// ErrUnsupportedType is returned for anything not on the allowlist.
var ErrUnsupportedType = errors.New("parse: unsupported file type")

// ErrScannedNoModel is returned for a PDF with no text layer when no model is
// configured to read it. It is a distinct error because it is the one parse
// failure with an actionable answer for the user ("add a key"), and the phase
// risk register calls for exactly that message.
var ErrScannedNoModel = errors.New("parse: this PDF has no text layer and no model is configured to read it")

// allowed maps an extension to its kind and canonical media type.
//
// An ALLOWLIST, not a denylist. The failure mode of a denylist is the file type
// nobody thought of, and for an upload endpoint that file type is the whole
// attack.
var allowed = map[string]struct {
	kind Kind
	mime string
}{
	".pdf":      {KindPDF, "application/pdf"},
	".docx":     {KindDOCX, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
	".pptx":     {KindPPTX, "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
	".epub":     {KindEPUB, "application/epub+zip"},
	".html":     {KindHTML, "text/html"},
	".htm":      {KindHTML, "text/html"},
	".md":       {KindMD, "text/markdown"},
	".markdown": {KindMD, "text/markdown"},
	".txt":      {KindText, "text/plain"},
	".xlsx":     {KindXLSX, MimeXLSX},
	".csv":      {KindCSV, "text/csv"},
	".tsv":      {KindTSV, "text/tab-separated-values"},
	// Photos: the media type is the one sniffed from the bytes (photo.go).
	".png":  {KindImage, ""},
	".jpg":  {KindImage, ""},
	".jpeg": {KindImage, ""},
	".webp": {KindImage, ""},
	".heic": {KindImage, ""},
}

// MimeXLSX is an Excel workbook's media type. Retrieval reads it to know a
// passage's heading path names a sheet.
const MimeXLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

// AllowedExtensions lists the accepted extensions, for the UI and for tests.
func AllowedExtensions() []string {
	out := make([]string, 0, len(allowed))
	for ext := range allowed {
		out = append(out, ext)
	}
	return out
}

// Detect decides a document's kind from its filename AND its bytes.
//
// Both, and they must agree. The filename alone is attacker-controlled; the
// bytes alone cannot tell a .docx from a .pptx from a .epub, because all three
// are zip archives and http.DetectContentType calls every one of them
// "application/zip". So: the extension proposes, the content sniff vetoes.
//
// The sniff is not a security control on its own — a PDF really can contain
// anything — it is what stops a mislabelled file being handed to a parser that
// will fail confusingly three minutes later inside a job.
func Detect(filename string, data []byte) (Kind, string, error) {
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(filename)))
	spec, ok := allowed[ext]
	if !ok {
		return KindOther, "", fmt.Errorf("%w: %q", ErrUnsupportedType, ext)
	}
	if len(data) == 0 {
		return KindOther, "", fmt.Errorf("%w: file is empty", ErrUnsupportedType)
	}

	switch spec.kind {
	case KindPDF:
		if !bytes.HasPrefix(data, []byte("%PDF-")) {
			return KindOther, "", fmt.Errorf("%w: .pdf without a PDF header", ErrUnsupportedType)
		}
	case KindDOCX, KindPPTX, KindEPUB:
		// "PK\x03\x04", or an empty/spanned archive marker.
		if !bytes.HasPrefix(data, []byte("PK\x03\x04")) {
			return KindOther, "", fmt.Errorf("%w: %s without a zip header", ErrUnsupportedType, ext)
		}
	case KindXLSX:
		// Every OOXML file is a zip; what makes one a workbook is its
		// workbook part. Only the central directory is read here.
		if !bytes.HasPrefix(data, []byte("PK\x03\x04")) || !zipHas(data, "xl/workbook.xml") {
			return KindOther, "", fmt.Errorf("%w: .xlsx without a workbook", ErrUnsupportedType)
		}
	case KindHTML, KindText, KindMD, KindCSV, KindTSV:
		// Text lanes: refuse anything the sniffer thinks is a binary. This is
		// what stops a .txt that is really an executable from being stored and
		// later handed back by the viewer.
		ct := http.DetectContentType(data)
		if !strings.HasPrefix(ct, "text/") && ct != "application/octet-stream" {
			return KindOther, "", fmt.Errorf("%w: %s sniffed as %s", ErrUnsupportedType, ext, ct)
		}
		if bytes.IndexByte(data[:min(len(data), 8000)], 0) >= 0 {
			return KindOther, "", fmt.Errorf("%w: %s contains NUL bytes", ErrUnsupportedType, ext)
		}
	case KindImage:
		mime := SniffImage(data)
		if mime == "" {
			return KindOther, "", fmt.Errorf("%w: %s is not a PNG, JPEG, WebP or HEIC image", ErrUnsupportedType, ext)
		}
		return KindImage, mime, nil
	}
	return spec.kind, spec.mime, nil
}

// LocalResult is what a no-key extraction produced.
type LocalResult struct {
	Markdown string
	Pages    int
	// Parser is the id recorded in documents.processed_by, e.g.
	// "local:ledongthuc/pdf". It is prefixed so the UI can say plainly that no
	// model read this document.
	Parser string
}

// ParseLocal runs the no-key extractor for a kind.
//
// For every format except PDF this is the ONLY lane, and deliberately so. A
// .txt does not become better Markdown by being sent to a model, and a .pptx
// round-tripped through one loses the slide boundaries that make its page
// numbers citable. The provider chain exists for PDFs, which is the format
// whose layout a text extractor genuinely cannot recover (Spike B: tables
// scored 0 locally, 2/2 with Gemini).
func ParseLocal(kind Kind, data []byte) (LocalResult, error) {
	switch kind {
	case KindPDF:
		md, pages, err := LocalPDFText(data)
		if err != nil {
			return LocalResult{}, err
		}
		if LooksScanned(md, pages) {
			return LocalResult{}, ErrScannedNoModel
		}
		return LocalResult{Markdown: md, Pages: pages, Parser: "local:ledongthuc/pdf"}, nil
	case KindDOCX:
		md, pages, err := LocalDOCXText(data)
		return LocalResult{Markdown: md, Pages: pages, Parser: "local:docx"}, err
	case KindPPTX:
		md, pages, err := LocalPPTXText(data)
		return LocalResult{Markdown: md, Pages: pages, Parser: "local:pptx"}, err
	case KindEPUB:
		md, pages, err := LocalEPUBText(data)
		return LocalResult{Markdown: md, Pages: pages, Parser: "local:epub"}, err
	case KindHTML:
		md, pages, err := LocalHTMLText(data, "")
		return LocalResult{Markdown: md, Pages: pages, Parser: "local:readability"}, err
	case KindMD, KindText:
		md, pages, err := LocalPlainText(data)
		return LocalResult{Markdown: md, Pages: pages, Parser: "local:text"}, err
	case KindXLSX:
		md, pages, err := LocalXLSXText(data)
		return LocalResult{Markdown: md, Pages: pages, Parser: "local:excelize"}, err
	case KindCSV:
		md, pages, err := LocalCSVText(data, ',')
		return LocalResult{Markdown: md, Pages: pages, Parser: "local:csv"}, err
	case KindTSV:
		md, pages, err := LocalCSVText(data, '\t')
		return LocalResult{Markdown: md, Pages: pages, Parser: "local:csv"}, err
	}
	return LocalResult{}, ErrUnsupportedType
}

// zipHas reports whether a zip archive has an entry by that name.
func zipHas(data []byte, name string) bool {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return false
	}
	for _, f := range zr.File {
		if strings.EqualFold(f.Name, name) {
			return true
		}
	}
	return false
}

// NeedsModel reports whether a kind goes through the provider chain at all.
// A photo has nothing else to read it.
func NeedsModel(kind Kind) bool { return kind == KindPDF || kind == KindImage }
