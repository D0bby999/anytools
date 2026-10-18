package chunk

import (
	"fmt"
	"strings"
	"testing"
)

func TestSplitCodeCutsOnBlankLinesWithLineRanges(t *testing.T) {
	var b strings.Builder
	b.WriteString("package demo\n\n")
	for i := 0; i < 6; i++ {
		fmt.Fprintf(&b, "func f%d() int {\n\treturn %d\n}\n\n", i, i)
	}
	src := b.String()
	lines := strings.Split(src, "\n")
	chunks := SplitCode("pkg/demo.go", src, Options{ChunkSize: 60, ChunkOverlap: 1})
	if len(chunks) < 3 {
		t.Fatalf("%d chunks", len(chunks))
	}
	prevEnd := 0
	for _, c := range chunks {
		if c.HeadingPath != "pkg/demo.go" {
			t.Fatalf("heading %q", c.HeadingPath)
		}
		if c.PageStart <= prevEnd || c.PageEnd < c.PageStart {
			t.Fatalf("line range %d-%d after %d", c.PageStart, c.PageEnd, prevEnd)
		}
		prevEnd = c.PageEnd
		// The range names exactly the lines the chunk holds, and both ends
		// are text, never a blank line.
		body := strings.Join(lines[c.PageStart-1:c.PageEnd], "\n")
		if !strings.HasSuffix(c.Text, body) {
			t.Fatalf("chunk %d text does not end with lines %d-%d:\n%s", c.Ord, c.PageStart, c.PageEnd, c.Text)
		}
		if !strings.HasPrefix(c.Text, fmt.Sprintf("pkg/demo.go (lines %d-%d)", c.PageStart, c.PageEnd)) {
			t.Fatalf("chunk %d has no path heading: %q", c.Ord, c.Text)
		}
		if strings.TrimSpace(lines[c.PageStart-1]) == "" || strings.TrimSpace(lines[c.PageEnd-1]) == "" {
			t.Fatalf("chunk %d starts or ends on a blank line", c.Ord)
		}
		// A function is never split across chunks: every chunk ends at a
		// closing brace or the package line.
		if last := lines[c.PageEnd-1]; last != "}" && !strings.HasPrefix(last, "package") {
			t.Fatalf("chunk %d ends mid-block on %q", c.Ord, last)
		}
	}
}

func TestSplitCodeCutsAnOversizedBlockBetweenLines(t *testing.T) {
	src := strings.Repeat("x := 1 // a long line of code\n", 40)
	chunks := SplitCode("big.go", src, Options{ChunkSize: 200, ChunkOverlap: 1})
	if len(chunks) < 5 {
		t.Fatalf("%d chunks for one oversized block", len(chunks))
	}
	if chunks[0].PageStart != 1 || chunks[len(chunks)-1].PageEnd != 40 {
		t.Fatalf("ranges %d..%d", chunks[0].PageStart, chunks[len(chunks)-1].PageEnd)
	}
	for i := 1; i < len(chunks); i++ {
		if chunks[i].PageStart != chunks[i-1].PageEnd+1 {
			t.Fatalf("gap or overlap between chunk %d and %d", i-1, i)
		}
	}
	if len(SplitCode("empty.go", "\n\n\n", Options{})) != 0 {
		t.Fatal("blank file produced chunks")
	}
}
