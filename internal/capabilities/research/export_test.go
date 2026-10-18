package research

import (
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/citations"
)

func TestExportResolvesMarkersIntoReferencesAReaderCanFollow(t *testing.T) {
	r := Report{
		Query: "q",
		ReportMD: "# Spacing: why it works\n\nA [[cite:url:7]]. B [[cite:chunk:c1]]. " +
			"Again [[cite:url:7]], then [[cite:url:9]]. Gone [[cite:url:42]].",
		Sources: []citations.Source{
			{Kind: "url", ID: "7", Title: "Forgetting curve", URL: "https://en.wikipedia.org/wiki/Forgetting_curve"},
			{Kind: "url", ID: "9", URL: "https://example.edu/spacing"},
			{Kind: "chunk", ID: "c1", Title: "Make It Stick.pdf", Page: 12},
		},
		Verification: &Verification{Status: "checked", Total: 4, Supported: 3, Partial: 1},
	}
	md := ExportMarkdown(r)
	for _, want := range []string{
		"A [[1]](https://en.wikipedia.org/wiki/Forgetting_curve).",
		"B (Make It Stick.pdf, p. 12).",
		"Again [[1]](https://en.wikipedia.org/wiki/Forgetting_curve), then [[2]](https://example.edu/spacing).",
		"## Sources\n\n1. [Forgetting curve](https://en.wikipedia.org/wiki/Forgetting_curve)\n2. [https://example.edu/spacing](https://example.edu/spacing)",
		"3 of 4 claims supported by their sources; 1 need checking.",
	} {
		if !strings.Contains(md, want) {
			t.Errorf("export lacks %q:\n%s", want, md)
		}
	}
	if strings.Contains(md, "[[cite:") {
		t.Errorf("a raw marker survived:\n%s", md)
	}
	if got := ExportFilename(r); got != "Research - Spacing- why it works.md" {
		t.Errorf("filename = %q", got)
	}
	if got := ExportFilename(Report{Query: "how does memory work"}); got != "Research - how does memory work.md" {
		t.Errorf("filename without a title = %q", got)
	}
}
