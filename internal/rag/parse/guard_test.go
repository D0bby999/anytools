package parse

import (
	"bytes"
	"errors"
	"fmt"
	"math/rand"
	"testing"
)

// onePagePDF is a minimal valid PDF with a text layer, built with correct
// xref offsets so the unmutated file parses.
func onePagePDF() []byte {
	objs := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		"<< /Length 44 >>\nstream\nBT /F1 24 Tf 72 700 Td (Hello world) Tj ET\nendstream",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objs))
	for i, o := range objs {
		offsets[i] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objs)+1)
	for _, off := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objs)+1, xref)
	return b.Bytes()
}

// TestMalformedPDFsNeverPanic replays the audit's fuzz with a fixed seed: small
// byte mutations of a valid PDF. The raw library must panic on some of them —
// otherwise this test proves nothing — and the guarded entry point on none.
func TestMalformedPDFsNeverPanic(t *testing.T) {
	base := onePagePDF()
	if _, _, err := LocalPDFText(base); err != nil {
		t.Fatalf("the unmutated fixture does not parse: %v", err)
	}
	rng := rand.New(rand.NewSource(1))
	rawPanics := 0
	for i := 0; i < 3000; i++ {
		m := append([]byte(nil), base...)
		for j := 0; j < 1+rng.Intn(4); j++ {
			m[rng.Intn(len(m))] = byte(rng.Intn(256))
		}
		func() {
			defer func() {
				if recover() != nil {
					rawPanics++
				}
			}()
			_, _, _ = localPDFText(m)
		}()
		_, _, err := LocalPDFText(m) // must return, never panic
		_ = err
	}
	if rawPanics == 0 {
		t.Fatal("no mutant panicked the raw library; the fixture no longer exercises the guard")
	}
	t.Logf("%d of 3000 mutants panicked the raw library; the guard returned an error for each", rawPanics)
}

func TestGuardReportsAPanicAsAnInputError(t *testing.T) {
	_, _, err := guarded("pdf", func() (string, int, error) { panic("missing endobj") })
	if !errors.Is(err, ErrParserPanicked) {
		t.Fatalf("err = %v, want ErrParserPanicked", err)
	}
}
