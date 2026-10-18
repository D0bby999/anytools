package videonotes

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/knowledge"
)

// export.go is a video's study notes as one portable Markdown file, in the
// shape youtube-fetcher-to-markdown gives its archival notes: YAML front
// matter for tools such as Obsidian's Dataview, then the notes, every time a
// link that opens the video at that second.
//
// Everything in the file except its skeleton is a stranger's text (the
// video's title and channel, the creator's description) or a model's (the
// notes). Front matter values are JSON strings, which YAML reads as quoted
// scalars; body text is escaped so it cannot become a link, an image, HTML or
// a heading.

// Markdown renders the notes.
func Markdown(doc *knowledge.Document, n *Notes) string {
	var b strings.Builder
	media := doc.Media
	if media == nil {
		media = &knowledge.VideoMedia{}
	}
	b.WriteString("---\n")
	field := func(k, v string) {
		if v != "" {
			q, _ := json.Marshal(v)
			fmt.Fprintf(&b, "%s: %s\n", k, q)
		}
	}
	field("title", doc.Title)
	field("channel", media.Channel)
	field("url", youtube.WatchURL(doc.MediaID))
	field("video_id", doc.MediaID)
	if media.DurationSeconds > 0 {
		field("duration", youtube.FormatClock(float64(media.DurationSeconds)))
	}
	field("language", n.Language)
	field("transcript", transcriptKind(doc))
	field("notes_by", n.Model)
	field("written", n.CreatedAt.UTC().Format("2006-01-02"))
	b.WriteString("tags:\n  - video-notes\n---\n\n")

	fmt.Fprintf(&b, "# %s\n\n", escape(doc.Title))
	if media.Channel != "" {
		fmt.Fprintf(&b, "%s · ", escape(media.Channel))
	}
	fmt.Fprintf(&b, "%s\n\n", link(doc.MediaID, 0, youtube.WatchURL(doc.MediaID)))
	b.WriteString("> Study notes written by an AI model from the video's transcript. Check a point against the video before relying on it.\n\n")

	b.WriteString("## Contents\n\n")
	for _, s := range n.Sections {
		fmt.Fprintf(&b, "- %s %s\n", link(doc.MediaID, s.Start, youtube.FormatClock(s.Start)), escape(s.Title))
	}
	b.WriteString("\n")

	for _, s := range n.Sections {
		fmt.Fprintf(&b, "## %s %s\n\n", link(doc.MediaID, s.Start, youtube.FormatClock(s.Start)), escape(s.Title))
		if s.Summary != "" {
			fmt.Fprintf(&b, "%s\n\n", escape(s.Summary))
		}
		for _, p := range s.Points {
			if p.At != nil {
				fmt.Fprintf(&b, "- %s %s\n", escape(p.Text), link(doc.MediaID, *p.At, youtube.FormatClock(*p.At)))
			} else {
				fmt.Fprintf(&b, "- %s\n", escape(p.Text))
			}
		}
		if len(s.Points) > 0 {
			b.WriteString("\n")
		}
	}

	if media.Description != "" {
		b.WriteString("## About the video\n\n")
		for _, line := range strings.Split(media.Description, "\n") {
			fmt.Fprintf(&b, "> %s\n", escape(line))
		}
		b.WriteString("\n")
	}
	return b.String()
}

// transcriptKind says whose transcript the notes were written from.
func transcriptKind(doc *knowledge.Document) string {
	switch {
	case doc.TranscriptSource == knowledge.TranscriptAI:
		return "AI transcript"
	case doc.TranscriptSource == knowledge.TranscriptLearner:
		return "your transcript"
	case doc.Media != nil && doc.Media.AutoCaptions:
		return "auto-generated captions"
	default:
		return "creator's captions"
	}
}

// link is a Markdown link to the video at a second. The id is validated
// (ValidID) before any document holds it, so the URL needs no escaping.
func link(id string, at float64, label string) string {
	if !youtube.ValidID(id) {
		return escape(label)
	}
	return fmt.Sprintf("[%s](https://www.youtube.com/watch?v=%s&t=%ds)", escape(label), id, int(at))
}

var markdownSpecial = regexp.MustCompile("[\\\\`*_{}\\[\\]()<>#+!|~]")

// escape keeps text as text: every character Markdown or HTML could read as
// syntax is backslash-escaped, and a line cannot start a heading, a list or a
// thematic break.
func escape(s string) string {
	s = markdownSpecial.ReplaceAllString(s, `\$0`)
	s = strings.TrimLeft(s, " \t")
	if strings.HasPrefix(s, "-") || strings.HasPrefix(s, "=") {
		s = `\` + s
	}
	return s
}

// ExportName is the file name offered for download.
func ExportName(doc *knowledge.Document, language string) string {
	name := strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == '"' || r < ' ' {
			return '-'
		}
		return r
	}, doc.Title)
	if len([]rune(name)) > 80 {
		name = string([]rune(name)[:80])
	}
	return fmt.Sprintf("%s - study notes (%s).md", strings.TrimSpace(name), language)
}
