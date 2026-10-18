package notebook

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// ExportLimit caps how many notes one export renders. A notebook larger than
// this is paged through the API instead; building a 40 MB string in memory to
// hand a browser is not an export, it is an outage.
const ExportLimit = 5000

// ExportMarkdown renders a whole notebook as one Markdown document.
//
// Each note carries its SOURCE LINE — the document id and page it came from —
// as visible text rather than as metadata a reader has to take on faith. That
// line is the export's whole point: a notebook you can read outside AnyTools
// and still trace back to the page, which is what phase 10's evidence loop
// needs and what a user who leaves the product keeps.
//
// The body is emitted verbatim. It is the user's (or the model's) own Markdown
// and this is a `.md` file, not HTML: there is nothing to escape, and escaping
// it would corrupt the thing being exported. The HTTP layer is what makes it
// safe to hand to a browser — `text/markdown` plus nosniff plus an attachment
// disposition (see notebookapi.export).
func (s *Service) ExportMarkdown(ctx context.Context, userID, notebookID uuid.UUID) (string, error) {
	nb, err := s.store.GetNotebook(ctx, userID, notebookID)
	if err != nil {
		return "", err
	}
	notes, err := s.store.ListNotes(ctx, userID, notebookID, NoteFilter{Limit: ExportLimit})
	if err != nil {
		return "", err
	}
	cats, err := s.store.ListCategories(ctx, userID, notebookID)
	if err != nil {
		return "", err
	}
	byID := make(map[uuid.UUID]string, len(cats))
	for _, c := range cats {
		byID[c.ID] = c.Name
	}

	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", nb.Name)
	if len(notes) == 0 {
		b.WriteString("_This notebook is empty._\n")
		return b.String(), nil
	}

	for i, n := range notes {
		if i > 0 {
			b.WriteString("\n---\n\n")
		}
		title := n.Title
		if strings.TrimSpace(title) == "" {
			title = "Untitled note"
		}
		fmt.Fprintf(&b, "## %s\n\n", title)

		if line := SourceLine(n.Source); line != "" {
			fmt.Fprintf(&b, "- Source: %s\n", line)
		}
		if n.CreatedBy == CreatedByAgent {
			b.WriteString("- Written by: AnyTools (agent)\n")
		}
		if names := categoryNames(n.CategoryIDs, byID); len(names) > 0 {
			fmt.Fprintf(&b, "- Categories: %s\n", strings.Join(names, ", "))
		}
		fmt.Fprintf(&b, "- Saved: %s\n\n", n.CreatedAt.UTC().Format("2006-01-02 15:04 UTC"))

		body := strings.TrimRight(n.BodyMD, "\n")
		if body != "" {
			b.WriteString(body)
			b.WriteString("\n")
		}
	}
	return b.String(), nil
}

// SourceLine renders a source as one human-readable line.
//
// The id is printed in full rather than shortened. A truncated uuid looks
// tidier and cannot be pasted back into `documents/<id>`, which is the only
// thing anyone would want to do with it.
func SourceLine(src Source) string {
	if src.Kind == "" {
		return ""
	}
	line := src.Kind
	if src.ID != "" {
		line += " " + src.ID
	}
	if src.Page > 0 {
		line += fmt.Sprintf(", page %d", src.Page)
	}
	return line
}

func categoryNames(ids []uuid.UUID, byID map[uuid.UUID]string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if name, ok := byID[id]; ok {
			out = append(out, name)
		}
	}
	return out
}

// ExportFilename is the name the download is offered under.
//
// The notebook's own name is sanitised down to a safe ASCII slug rather than
// interpolated: a name containing a quote or a newline would break out of the
// Content-Disposition header, and a name containing a slash would suggest a
// path to whatever unpacks it.
func ExportFilename(name string) string {
	var b strings.Builder
	prevDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
		if b.Len() >= 60 {
			break
		}
	}
	slug := strings.Trim(b.String(), "-")
	if slug == "" {
		slug = "notebook"
	}
	return slug + ".md"
}
