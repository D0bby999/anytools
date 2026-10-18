package book

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/capabilities/research"
	"github.com/D0bby999/anytools/internal/capabilities/visualize"
	"github.com/D0bby999/anytools/internal/citations"
)

// export.go is a book as one Markdown file: every written block, in order,
// with its citations resolved exactly as a research report's are
// (research.ExportMarkdown) — a passage becomes "(title, p. N)", and a marker
// that resolves to nothing is removed.

// Export renders the book's written chapters as Markdown.
func (s *Service) Export(ctx context.Context, userID, id uuid.UUID) (string, string, error) {
	b, err := s.store.GetBook(ctx, userID, id)
	if err != nil {
		return "", "", ErrNotFound
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "# %s\n\n", b.Title)
	if b.Proposal.Audience != "" {
		fmt.Fprintf(&sb, "_%s_\n\n", b.Proposal.Audience)
	}
	var sources []citations.Source
	for _, ch := range b.Chapters {
		fmt.Fprintf(&sb, "## %d. %s\n\n", ch.Ord, ch.Title)
		blocks, err := s.store.Blocks(ctx, userID, ch.ID)
		if err != nil {
			return "", "", err
		}
		written := 0
		for i := range blocks {
			blk := &blocks[i]
			if blk.Version == 0 {
				continue
			}
			if err := s.fill(ctx, userID, blk); err != nil {
				return "", "", err
			}
			if md := blockMarkdown(*blk); md != "" {
				sb.WriteString(md)
				sb.WriteString("\n\n")
				written++
			}
			sources = append(sources, blk.Sources...)
		}
		if written == 0 {
			sb.WriteString("_Not written yet._\n\n")
		}
	}
	md := research.ExportMarkdown(research.Report{ReportMD: sb.String(), Sources: sources})
	return md, exportName(b.Title), nil
}

// blockMarkdown is one block as Markdown, its markers still in place.
func blockMarkdown(b Block) string {
	var sb strings.Builder
	switch b.Type {
	case TypeText, TypeSummary, TypeNote:
		var p MarkdownPayload
		_ = json.Unmarshal(b.Payload, &p)
		if b.Type == TypeSummary {
			sb.WriteString("### Summary\n\n")
		}
		if b.Type == TypeNote {
			sb.WriteString("> **Note:** ")
			sb.WriteString(strings.ReplaceAll(strings.TrimSpace(p.Markdown), "\n", "\n> "))
			return sb.String()
		}
		sb.WriteString(p.Markdown)
	case TypeCallout:
		var p CalloutPayload
		_ = json.Unmarshal(b.Payload, &p)
		label := map[string]string{"definition": "Definition", "warning": "Warning", "tip": "Tip"}[p.Variant]
		if p.Title != "" {
			label += ": " + p.Title
		}
		fmt.Fprintf(&sb, "> **%s.** %s", label, strings.ReplaceAll(strings.TrimSpace(p.Markdown), "\n", "\n> "))
	case TypeWorkedExample:
		var p ExamplePayload
		_ = json.Unmarshal(b.Payload, &p)
		fmt.Fprintf(&sb, "### Worked example: %s\n\n%s\n\n", b.Title, p.Problem)
		for i, step := range p.Steps {
			fmt.Fprintf(&sb, "%d. %s\n", i+1, step)
		}
		fmt.Fprintf(&sb, "\n**Answer.** %s", p.Answer)
	case TypeDiagram:
		var d visualize.Diagram
		_ = json.Unmarshal(b.Payload, &d)
		sb.WriteString(visualize.Markdown(d))
	case TypeQuiz:
		fmt.Fprintf(&sb, "### Check yourself: %s\n\n", b.Title)
		var answers []string
		for i, q := range b.Questions {
			fmt.Fprintf(&sb, "%d. %v\n", i+1, q["prompt"])
			if opts, ok := q["options"].([]quiz.Option); ok {
				for _, o := range opts {
					fmt.Fprintf(&sb, "   - %s. %s\n", o.Label, o.Body)
				}
			}
			// The answer only once the learner has attempted the question,
			// as the reader shows it: an export is no way round the quiz.
			if a, ok := q["answer"]; ok {
				answers = append(answers, fmt.Sprintf("%d. %v", i+1, a))
			}
		}
		if len(answers) > 0 {
			fmt.Fprintf(&sb, "\nAnswers: %s", strings.Join(answers, "; "))
		}
	case TypeFlashCards:
		fmt.Fprintf(&sb, "### Cards: %s\n\n", b.Title)
		for _, c := range b.Cards {
			fmt.Fprintf(&sb, "- **%s** — %s\n", c.Front, c.Back)
		}
	}
	return strings.TrimRight(sb.String(), "\n")
}

// exportName is the book's title made safe for a filename, ending .md.
func exportName(title string) string {
	var sb strings.Builder
	for _, r := range title {
		switch {
		case r == '/' || r == '\\' || r == '"' || r < 32:
			sb.WriteRune('-')
		default:
			sb.WriteRune(r)
		}
	}
	name := strings.TrimSpace(truncate(sb.String(), 80))
	if name == "" {
		name = "book"
	}
	return name + ".md"
}
