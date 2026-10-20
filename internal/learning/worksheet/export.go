package worksheet

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// export.go is a worksheet as one portable Markdown file, in the shape up's
// reader would have copied it into a private note: front matter (kind, title,
// dates, source), then each section as a heading, `Label: value` lines, and
// tables as Markdown tables.
//
// Every value is the learner's own text and is escaped as the study notes'
// export escapes a stranger's (internal/capabilities/videonotes/export.go):
// it cannot become a link, an image, HTML, a heading or a table cell break.
// Front matter values are JSON strings, which YAML reads as quoted scalars.

// Markdown renders w by its kind, in English.
func Markdown(k *Kind, w *Worksheet) string { return MarkdownIn(k, w, "en") }

// MarkdownIn renders w by its kind in the learner's language. The front
// matter stays as it is stored (keys, status, option values).
func MarkdownIn(k *Kind, w *Worksheet, lang string) string {
	k, tr := Localized(k, lang), translator(lang)
	var b strings.Builder
	b.WriteString("---\n")
	field := func(key, v string) {
		if v != "" {
			q, _ := json.Marshal(v)
			fmt.Fprintf(&b, "%s: %s\n", key, q)
		}
	}
	field("kind", k.Kind)
	field("title", w.Title)
	field("created", w.CreatedAt.UTC().Format("2006-01-02"))
	field("updated", w.UpdatedAt.UTC().Format("2006-01-02"))
	field("status", w.Status)
	field("source", "up: "+k.Source)
	if w.Private {
		// The download is the learner's own; the flag travels with it so a
		// notes tool or a later import can keep it out of anything shared.
		b.WriteString("private: true\n")
	}
	if len(k.Reviews) > 0 {
		b.WriteString("reviews:\n")
		for _, r := range k.Reviews {
			due := "not scheduled"
			if d, ok := w.Reviews[r.Key]; ok {
				due = d.Due
				if d.Done {
					due += " (done)"
				}
			}
			q, _ := json.Marshal(due)
			fmt.Fprintf(&b, "  %s: %s\n", r.Key, q)
		}
	}
	b.WriteString("---\n\n")
	fmt.Fprintf(&b, "# %s\n\n", escape(w.Title))
	fmt.Fprintf(&b, "%s\n\n", escape(k.Name))

	recs := make(map[string]Recording, len(w.Recordings))
	for _, r := range w.Recordings {
		recs[r.ID.String()] = r
	}
	for _, s := range k.Sections {
		fmt.Fprintf(&b, "## %s\n\n", escape(s.Title))
		stored := w.Answers[s.Key]
		var lines []string
		for _, f := range s.Fields {
			v := stored[f.Key]
			if f.Type == Table {
				if len(lines) > 0 {
					b.WriteString(strings.Join(lines, "\n") + "\n\n")
					lines = nil
				}
				fmt.Fprintf(&b, "%s\n\n", escape(f.Label))
				writeTable(&b, f, v, recs, tr)
				continue
			}
			lines = append(lines, fmt.Sprintf("%s: %s", escape(f.Label), inline(f, v, recs, tr)))
		}
		if len(lines) > 0 {
			b.WriteString(strings.Join(lines, "  \n") + "\n\n")
		}
	}

	if earlier := earlierKeys(k, w.Answers); len(earlier) > 0 {
		fmt.Fprintf(&b, "## %s\n\n", escape(tr("From an earlier version")))
		for _, path := range earlier {
			section, key, _ := strings.Cut(path, ".")
			raw, _ := json.Marshal(w.Answers[section][key])
			fmt.Fprintf(&b, "%s: %s  \n", escape(path), escape(string(raw)))
		}
		b.WriteString("\n")
	}
	return b.String()
}

// inline is one non-table value on a line. An audio value is named by its
// length and date: the file itself stays on the server.
func inline(f Field, v any, recs map[string]Recording, tr func(string) string) string {
	if v == nil {
		return ""
	}
	switch f.Type {
	case Audio:
		r, ok := recs[fmt.Sprint(v)]
		if !ok {
			return tr("recording (missing)")
		}
		return fmt.Sprintf("%s, %d:%02d, %s", tr("recording"), r.DurationSeconds/60, r.DurationSeconds%60,
			r.CreatedAt.UTC().Format("2006-01-02"))
	case Score:
		n, ok := v.(float64)
		if !ok {
			return ""
		}
		s := strconv.Itoa(int(n))
		if i := int(n); i >= 0 && i < len(f.ScoreLabels) {
			s += " (" + escape(f.ScoreLabels[i]) + ")"
		}
		return s
	case YesNo:
		if b, _ := v.(bool); b {
			return tr("yes")
		}
		return tr("no")
	case Check:
		if b, _ := v.(bool); b {
			return "[x]"
		}
		return "[ ]"
	case Multi:
		list, _ := v.([]any)
		parts := make([]string, 0, len(list))
		for _, x := range list {
			if s, ok := x.(string); ok {
				parts = append(parts, escape(f.optionText(s)))
			}
		}
		return strings.Join(parts, ", ")
	}
	s, _ := v.(string)
	if f.Type == Choice {
		s = f.optionText(s)
	}
	// A long answer keeps its paragraphs as Markdown line breaks.
	return strings.ReplaceAll(escape(s), "\n", "  \n")
}

func writeTable(b *strings.Builder, f Field, v any, recs map[string]Recording, tr func(string) string) {
	rows, _ := v.([]any)
	var header []string
	if len(f.Rows) > 0 {
		header = append(header, escape(orDefault(f.RowHeader, " ")))
	}
	for _, c := range f.Columns {
		header = append(header, escape(c.Label))
	}
	fmt.Fprintf(b, "| %s |\n|%s\n", strings.Join(header, " | "), strings.Repeat(" --- |", len(header)))
	cellsOf := func(row any) map[string]any {
		m, _ := row.(map[string]any)
		cells, _ := m["cells"].(map[string]any)
		return cells
	}
	writeRow := func(rowKey string, label *string, cells map[string]any) {
		var out []string
		if label != nil {
			out = append(out, escape(*label))
		}
		for _, c := range f.Columns {
			if c.Type == Label {
				out = append(out, escape(c.LabelText(rowKey, cells)))
				continue
			}
			out = append(out, strings.ReplaceAll(inline(c, cells[c.Key], recs, tr), "  \n", "<br>"))
		}
		fmt.Fprintf(b, "| %s |\n", strings.Join(out, " | "))
	}
	if len(f.Rows) > 0 {
		for _, r := range f.Rows {
			var cells map[string]any
			for _, row := range rows {
				if m, _ := row.(map[string]any); m != nil && m["row"] == r.Key {
					cells = cellsOf(row)
				}
			}
			label := r.Label
			writeRow(r.Key, &label, cells)
		}
	} else {
		for _, row := range rows {
			writeRow("", nil, cellsOf(row))
		}
	}
	b.WriteString("\n")
}

// earlierKeys are stored "section.field" paths the kind no longer has, kept
// and shown as "From an earlier version" rather than dropped.
func earlierKeys(k *Kind, a Answers) []string {
	var out []string
	for section, fields := range a {
		for key := range fields {
			if k.field(section, key) == nil {
				out = append(out, section+"."+key)
			}
		}
	}
	sort.Strings(out)
	return out
}

// EarlierKeys is earlierKeys for the API, which sends them beside the
// answers so the form can show them read-only.
func EarlierKeys(k *Kind, a Answers) []string { return earlierKeys(k, a) }

var markdownSpecial = regexp.MustCompile("[\\\\`*_{}\\[\\]()<>#+!|~]")

// escape keeps text as text: every character Markdown or HTML could read as
// syntax is backslash-escaped, and a line cannot start a heading, a list or a
// thematic break. The same rule as videonotes' export, applied per line.
func escape(s string) string {
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		line = markdownSpecial.ReplaceAllString(line, `\$0`)
		line = strings.TrimLeft(line, " \t")
		if strings.HasPrefix(line, "-") || strings.HasPrefix(line, "=") {
			line = `\` + line
		}
		if n := leadingDigits(line); n > 0 && n < len(line) && (line[n] == '.' || line[n] == ')') {
			line = line[:n] + `\` + line[n:]
		}
		lines[i] = line
	}
	return strings.Join(lines, "\n")
}

func leadingDigits(s string) int {
	n := 0
	for n < len(s) && s[n] >= '0' && s[n] <= '9' {
		n++
	}
	return n
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// ExportName is the file name offered for download.
func ExportName(w *Worksheet) string {
	name := strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == '"' || r < ' ' {
			return '-'
		}
		return r
	}, w.Title)
	if len([]rune(name)) > 80 {
		name = string([]rune(name)[:80])
	}
	return strings.TrimSpace(name) + ".md"
}
