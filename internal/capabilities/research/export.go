package research

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/D0bby999/anytools/internal/citations"
)

// export.go — a report as a document a knowledge base can hold.
//
// Adding a report to a knowledge base is how the learner keeps studying it:
// once it is a document, quiz generation, mastery paths and grounded chat all
// work on it the same way they work on an uploaded book. Its citation markers
// only mean something inside the turn that wrote them, so they become plain
// references a reader (and a later retrieval) can follow.

var exportMarkerRE = regexp.MustCompile(`\[\[cite:(chunk|url):([A-Za-z0-9_.:-]+)\]\]`)

// ExportMarkdown renders the report with its markers resolved: a web source
// becomes a numbered link, a passage from the learner's documents a
// "(title, p. N)" reference. A sources list and the claim check close it.
func ExportMarkdown(r Report) string {
	byKey := map[string]citations.Source{}
	for _, s := range r.Sources {
		byKey[citations.Key(s.Kind, s.ID)] = s
	}
	webNumber := map[string]int{}
	var web []citations.Source

	body := exportMarkerRE.ReplaceAllStringFunc(r.ReportMD, func(m string) string {
		sub := exportMarkerRE.FindStringSubmatch(m)
		src, ok := byKey[sub[1]+":"+sub[2]]
		if !ok {
			return ""
		}
		if src.Kind == citations.KindURL {
			n, seen := webNumber[src.URL]
			if !seen {
				web = append(web, src)
				n = len(web)
				webNumber[src.URL] = n
			}
			return fmt.Sprintf("[[%d]](%s)", n, src.URL)
		}
		if src.Page > 0 {
			return fmt.Sprintf("(%s, p. %d)", src.Title, src.Page)
		}
		return "(" + src.Title + ")"
	})

	var b strings.Builder
	b.WriteString(strings.TrimSpace(body))
	if len(web) > 0 {
		b.WriteString("\n\n## Sources\n\n")
		for i, s := range web {
			title := strings.TrimSpace(s.Title)
			if title == "" {
				title = s.URL
			}
			b.WriteString(fmt.Sprintf("%d. [%s](%s)\n", i+1, title, s.URL))
		}
	}
	if v := r.Verification; v != nil && v.Status == "checked" && v.Total > 0 {
		b.WriteString(fmt.Sprintf("\n\n---\n\nClaim check when this report was written: %d of %d claims supported by their sources",
			v.Supported, v.Total))
		if n := v.Partial + v.Unsupported + v.Uncited; n > 0 {
			b.WriteString(fmt.Sprintf("; %d need checking", n))
		}
		b.WriteString(".\n")
	}
	return b.String() + "\n"
}

// ExportFilename is the document name for a report: its title line, made
// safe for a filename, ending .md so the knowledge base reads it as Markdown.
func ExportFilename(r Report) string {
	title := ""
	for _, line := range strings.Split(r.ReportMD, "\n") {
		if t := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "# ")); strings.HasPrefix(strings.TrimSpace(line), "# ") && t != "" {
			title = t
			break
		}
	}
	if title == "" {
		title = strings.TrimPrefix(ReportTitle(r.Query), "Research: ")
	}
	title = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`/\:*?"<>|`, r) || r < 0x20 {
			return '-'
		}
		return r
	}, title)
	if rs := []rune(title); len(rs) > 100 {
		title = string(rs[:100])
	}
	return "Research - " + strings.TrimSpace(title) + ".md"
}
