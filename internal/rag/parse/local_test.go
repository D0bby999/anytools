package parse_test

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/rag/parse"
)

// ── the local PDF lane ─────────────────────────────────────────────────────

// Spike B's finding, pinned: `ledongthuc/pdf` is a text-layer LIVENESS CHECK,
// not a parser. These two assertions are the ones the pipeline actually relies
// on — a text PDF has text, a scanned one does not — and nothing depends on the
// quality of what comes out.
func TestLocalPDFTextIsALivenessCheck(t *testing.T) {
	text, pages, err := parse.LocalPDFText(readFixture(t, "rag.pdf"))
	if err != nil {
		t.Fatalf("LocalPDFText: %v", err)
	}
	if pages != 19 {
		t.Fatalf("pages = %d, want 19", pages)
	}
	if parse.LooksScanned(text, pages) {
		t.Fatal("a born-digital PDF must not look scanned")
	}
	// Markers are written by us, so every page has exactly one.
	if got := len(parse.MarkerPages(text)); got != 19 {
		t.Fatalf("local extraction emitted %d markers, want 19", got)
	}
}

func TestScannedPDFIsDetectedAndRefusedWithoutAModel(t *testing.T) {
	data := readFixture(t, "scanned-rag-10p.pdf")

	text, pages, err := parse.LocalPDFText(data)
	if err != nil {
		t.Fatalf("LocalPDFText: %v", err)
	}
	if !parse.LooksScanned(text, pages) {
		t.Fatalf("a rasterised PDF must look scanned; got %d chars over %d pages",
			len(parse.StripMarkers(text)), pages)
	}

	// And the no-key path must say so in the one way the user can act on.
	_, err = parse.ParseLocal(parse.KindPDF, data)
	if !errors.Is(err, parse.ErrScannedNoModel) {
		t.Fatalf("err = %v, want ErrScannedNoModel", err)
	}
}

// ── PPTX: zip + xml, one page per slide ────────────────────────────────────

func buildPPTX(t *testing.T, slides map[int][]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	write := func(name, body string) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip create %s: %v", name, err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatalf("zip write %s: %v", name, err)
		}
	}
	write("[Content_Types].xml", `<?xml version="1.0"?><Types/>`)

	for n, paragraphs := range slides {
		var sb strings.Builder
		sb.WriteString(`<?xml version="1.0"?><p:sld xmlns:p="ppt" xmlns:a="draw"><p:cSld><p:spTree>`)
		for _, p := range paragraphs {
			// Split across two runs, as PowerPoint does whenever formatting
			// changes mid-sentence. A naive regex over <a:t> would join them
			// without the space; the XML walk keeps the run boundary.
			mid := len(p) / 2
			fmt.Fprintf(&sb, `<p:sp><p:txBody><a:p><a:r><a:t>%s</a:t></a:r><a:r><a:t>%s</a:t></a:r></a:p></p:txBody></p:sp>`,
				p[:mid], p[mid:])
		}
		sb.WriteString(`</p:spTree></p:cSld></p:sld>`)
		write(fmt.Sprintf("ppt/slides/slide%d.xml", n), sb.String())
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

func TestPPTXOnePagePerSlideInNumericOrder(t *testing.T) {
	// Eleven slides, so that slide10 and slide11 sort BEFORE slide2
	// lexically — which is the order zip entries arrive in and the bug this
	// test exists to catch.
	slides := map[int][]string{}
	for n := 1; n <= 11; n++ {
		slides[n] = []string{fmt.Sprintf("Slide %d discusses retrieval augmented generation.", n)}
	}
	data := buildPPTX(t, slides)

	res, err := parse.ParseLocal(parse.KindPPTX, data)
	if err != nil {
		t.Fatalf("ParseLocal(pptx): %v", err)
	}
	if res.Pages != 11 {
		t.Fatalf("pages = %d, want 11", res.Pages)
	}
	if res.Parser != "local:pptx" {
		t.Fatalf("parser = %q", res.Parser)
	}

	markers := parse.MarkerPages(res.Markdown)
	if len(markers) != 11 {
		t.Fatalf("got %d markers, want 11", len(markers))
	}
	for i, m := range markers {
		if m != i+1 {
			t.Fatalf("marker %d is %d, want %d", i, m, i+1)
		}
	}

	// Each slide's text landed under its own marker, not its neighbour's.
	lead, bodies, nums := parse.SplitAtMarkers(res.Markdown)
	if lead != "" {
		t.Fatalf("unexpected content before the first marker: %q", lead)
	}
	for i, n := range nums {
		want := fmt.Sprintf("Slide %d discusses", n)
		if !strings.Contains(bodies[i], want) {
			t.Fatalf("page %d body %q does not contain %q — slides are out of order", n, bodies[i], want)
		}
	}
}

func TestPPTXWithoutSlidesIsRefused(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("docProps/app.xml")
	_, _ = w.Write([]byte("<x/>"))
	_ = zw.Close()

	if _, err := parse.ParseLocal(parse.KindPPTX, buf.Bytes()); err == nil {
		t.Fatal("a zip with no slides must not parse as a deck")
	}
}

// ── DOCX ───────────────────────────────────────────────────────────────────

func buildDOCX(t *testing.T, paragraphs []string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	write := func(name, body string) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip create %s: %v", name, err)
		}
		_, _ = w.Write([]byte(body))
	}
	write("[Content_Types].xml", `<?xml version="1.0"?><Types/>`)
	// Every real .docx carries this part, and the container reader requires it.
	write("word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships/>`)

	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0"?><w:document xmlns:w="word"><w:body>`)
	for _, p := range paragraphs {
		fmt.Fprintf(&sb, `<w:p><w:r><w:t>%s</w:t></w:r></w:p>`, p)
	}
	sb.WriteString(`</w:body></w:document>`)
	write("word/document.xml", sb.String())
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

// A Word file has no pages until something lays it out, so it gets exactly one
// marker. Inventing page numbers here would produce citations to pages that do
// not exist in the reader's copy.
func TestDOCXIsOnePageAndKeepsParagraphs(t *testing.T) {
	data := buildDOCX(t, []string{
		"Retrieval augmented generation combines parametric and non-parametric memory.",
		"The retriever provides latent documents conditioned on the input.",
	})
	res, err := parse.ParseLocal(parse.KindDOCX, data)
	if err != nil {
		t.Fatalf("ParseLocal(docx): %v", err)
	}
	if res.Pages != 1 {
		t.Fatalf("pages = %d, want 1", res.Pages)
	}
	if got := parse.MarkerPages(res.Markdown); len(got) != 1 || got[0] != 1 {
		t.Fatalf("markers = %v, want [1]", got)
	}
	for _, want := range []string{"parametric and non-parametric memory", "latent documents"} {
		if !strings.Contains(res.Markdown, want) {
			t.Fatalf("missing %q in\n%s", want, res.Markdown)
		}
	}
	// Paragraphs must not be run together into one line.
	if strings.Contains(res.Markdown, "memory.The retriever") {
		t.Fatal("paragraph boundary was lost")
	}
}

// ── plain text and markdown ────────────────────────────────────────────────

func TestPlainTextNeutralisesAnEmbeddedPageMarker(t *testing.T) {
	// A user's own document containing our marker syntax would otherwise be
	// read as a page boundary by the chunker, the viewer and every citation.
	res, err := parse.ParseLocal(parse.KindMD, []byte("# Notes\n\n<!-- page: 99 -->\n\nreal content"))
	if err != nil {
		t.Fatalf("ParseLocal(md): %v", err)
	}
	pages := parse.MarkerPages(res.Markdown)
	if len(pages) != 1 || pages[0] != 1 {
		t.Fatalf("markers = %v, want exactly [1]", pages)
	}
	if !strings.Contains(res.Markdown, "real content") {
		t.Fatal("content was lost")
	}
}

func TestEmptyFileIsRefused(t *testing.T) {
	if _, err := parse.ParseLocal(parse.KindText, []byte("   \n  ")); err == nil {
		t.Fatal("an empty file must be refused, not indexed as an empty document")
	}
}

// ── the allowlist ──────────────────────────────────────────────────────────

func TestDetectRequiresExtensionAndContentToAgree(t *testing.T) {
	pdf := readFixture(t, "rag.pdf")
	docx := buildDOCX(t, []string{"hello"})

	cases := []struct {
		name     string
		filename string
		data     []byte
		wantKind parse.Kind
		wantErr  bool
	}{
		{"pdf", "paper.pdf", pdf, parse.KindPDF, false},
		{"docx", "notes.docx", docx, parse.KindDOCX, false},
		{"markdown", "notes.md", []byte("# hi"), parse.KindMD, false},
		{"uppercase extension", "PAPER.PDF", pdf, parse.KindPDF, false},

		// The extension proposes; the content sniff vetoes.
		{"pdf extension, zip content", "evil.pdf", docx, parse.KindOther, true},
		{"docx extension, pdf content", "evil.docx", pdf, parse.KindOther, true},
		{"txt extension, binary content", "evil.txt", []byte{0x7f, 'E', 'L', 'F', 0, 0, 0}, parse.KindOther, true},

		// Not on the allowlist at all.
		{"executable", "run.exe", []byte("MZ\x90\x00"), parse.KindOther, true},
		{"svg", "logo.svg", []byte("<svg/>"), parse.KindOther, true},
		{"no extension", "README", []byte("hello"), parse.KindOther, true},
		{"double extension", "invoice.pdf.exe", pdf, parse.KindOther, true},
		{"empty", "empty.txt", nil, parse.KindOther, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			kind, mime, err := parse.Detect(tc.filename, tc.data)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("Detect(%q) accepted it as %s/%s", tc.filename, kind, mime)
				}
				if !errors.Is(err, parse.ErrUnsupportedType) {
					t.Fatalf("err = %v, want ErrUnsupportedType", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Detect(%q): %v", tc.filename, err)
			}
			if kind != tc.wantKind {
				t.Fatalf("kind = %q, want %q", kind, tc.wantKind)
			}
			if mime == "" {
				t.Fatal("mime must not be empty for an accepted file")
			}
		})
	}
}

func TestOnlyPDFGoesThroughAModel(t *testing.T) {
	if !parse.NeedsModel(parse.KindPDF) {
		t.Fatal("a PDF's layout is the thing a text extractor cannot recover; it needs the model lane")
	}
	for _, k := range []parse.Kind{parse.KindDOCX, parse.KindPPTX, parse.KindEPUB, parse.KindHTML, parse.KindMD, parse.KindText} {
		if parse.NeedsModel(k) {
			t.Fatalf("%s must not spend provider quota: its structure is already machine-readable", k)
		}
	}
}
