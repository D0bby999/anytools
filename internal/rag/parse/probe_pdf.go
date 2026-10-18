package parse

import (
	"bytes"
	"fmt"
)

// probe_pdf.go — the one-page PDF a verify ping sends.
//
// Built here rather than committed as a binary fixture for two reasons: a
// checked-in blob is a thing nobody can read in a diff, and the probe's text
// must match pingProbeText, which is a Go constant. Generating it keeps those
// two facts in one file.
//
// The structure is the minimum a PDF reader accepts: catalog, one page tree,
// one page, one content stream, one standard font. The xref offsets are
// computed from the bytes actually written, because a PDF with a wrong xref is
// the kind of file that works in one parser and fails in the next.
func probePDF() []byte {
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Contents 4 0 R " +
			"/Resources << /Font << /F1 5 0 R >> >> >>",
		contentStream(),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}

	var buf bytes.Buffer
	buf.WriteString("%PDF-1.4\n")
	// A binary comment line marks the file as binary for transports that would
	// otherwise treat it as text and "helpfully" translate line endings.
	buf.Write([]byte{'%', 0xE2, 0xE3, 0xCF, 0xD3, '\n'})

	offsets := make([]int, len(objects)+1)
	for i, body := range objects {
		offsets[i+1] = buf.Len()
		fmt.Fprintf(&buf, "%d 0 obj\n%s\nendobj\n", i+1, body)
	}

	xrefOffset := buf.Len()
	fmt.Fprintf(&buf, "xref\n0 %d\n", len(objects)+1)
	buf.WriteString("0000000000 65535 f \n")
	for i := 1; i <= len(objects); i++ {
		fmt.Fprintf(&buf, "%010d 00000 n \n", offsets[i])
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n",
		len(objects)+1, xrefOffset)

	return buf.Bytes()
}

func contentStream() string {
	text := fmt.Sprintf("BT /F1 14 Tf 20 60 Td (%s) Tj ET", pingProbeText)
	return fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(text), text)
}
