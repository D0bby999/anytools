// Package outline is the counted shape of an up worksheet, read mechanically
// from up's Markdown (red team AS-7): the outline a kind is compared with is
// generated, never written by hand.
//
// For each selected `##` section of a file it records:
//   - labels: the `Label:` lines inside code blocks (and `Question?` lines,
//     which up's worksheets also leave to be answered), plus list items
//     ending in `?` outside code blocks — up's numbered weekly questions;
//   - checks: `- [ ]` checklist items;
//   - tables: each Markdown table's body rows × columns, or "free" rows when
//     every body row is a template — no row label, and every cell empty or
//     an option list (rows the reader adds, the options shown once);
//   - options: each `a / b / c` option list's count, after a label's colon
//     or in a table cell. A list that continues on the next line of a code
//     block (a line starting with "/ ") is one list.
//
// A line ending in `:` followed by `- ` items is a heading for those items,
// not a field, and is not counted. The generator (../testdata/gen) writes
// Format's output to testdata/outlines/<kind>.txt, committed unedited.
package outline

import (
	"bufio"
	"bytes"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Outline is one kind's counted shape.
type Outline struct {
	Source    string
	Commit    string
	Selection string
	// Fenced records that the outline was read with GenerateFenced.
	Fenced   bool
	Sections []Section
}

// Section is one `##` section's counts.
type Section struct {
	Title   string
	Labels  int
	Checks  int
	Tables  []string // "5x4" or "freex3"
	Options []int    // sorted
}

// Table formats a table's shape: rows × columns, or free rows × columns.
func Table(rows, cols int, free bool) string {
	if free {
		return fmt.Sprintf("freex%d", cols)
	}
	return fmt.Sprintf("%dx%d", rows, cols)
}

var (
	listMarker = regexp.MustCompile(`^(?:[-*+]|\d+[.)])\s+`)
	checkItem  = regexp.MustCompile(`^[-*+]\s+\[[ xX]\]\s+`)
	separator  = regexp.MustCompile(`^\|?\s*:?-{3,}`)
)

// Generate reads a Markdown file's `##` sections and counts the selected
// ones. selection is "" (all), "3", "2-5" or "1,3,4" — ordinals of the `##`
// sections in file order, from 1.
func Generate(md []byte, selection string) ([]Section, error) {
	return generate(md, selection, false)
}

// GenerateFenced is Generate for a template written inside a code block
// whose own headings mark its sections: ai-case-review.md and
// ai-project-scorecard.md are each one block, and the narrative chapter's
// case review adds two `##` gates inside one. A `#` or `##` heading inside a
// code block starts a section too, and the ordinals count every heading in
// file order, inside code blocks or not.
func GenerateFenced(md []byte, selection string) ([]Section, error) {
	return generate(md, selection, true)
}

func generate(md []byte, selection string, fenced bool) ([]Section, error) {
	type raw struct {
		title string
		lines []string
	}
	var all []raw
	sc := bufio.NewScanner(bytes.NewReader(md))
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	inFence := false
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(strings.TrimSpace(line), "```") {
			inFence = !inFence
		}
		if !inFence && strings.HasPrefix(line, "## ") {
			all = append(all, raw{title: strings.TrimSpace(strings.TrimPrefix(line, "## "))})
			continue
		}
		if fenced && inFence && (strings.HasPrefix(line, "## ") || strings.HasPrefix(line, "# ")) {
			// The section opens inside the code block: count its lines as such.
			title := strings.TrimSpace(strings.TrimLeft(line, "#"))
			all = append(all, raw{title: title, lines: []string{"```"}})
			continue
		}
		if len(all) > 0 {
			all[len(all)-1].lines = append(all[len(all)-1].lines, line)
		}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	picked, err := pick(selection, len(all))
	if err != nil {
		return nil, err
	}
	out := make([]Section, 0, len(picked))
	for _, i := range picked {
		s := count(all[i].lines)
		s.Title = all[i].title
		out = append(out, s)
	}
	return out, nil
}

func pick(selection string, n int) ([]int, error) {
	if strings.TrimSpace(selection) == "" {
		out := make([]int, n)
		for i := range out {
			out[i] = i
		}
		return out, nil
	}
	var out []int
	for _, part := range strings.Split(selection, ",") {
		lo, hi, isRange := strings.Cut(strings.TrimSpace(part), "-")
		a, err := strconv.Atoi(lo)
		if err != nil {
			return nil, fmt.Errorf("selection %q", selection)
		}
		b := a
		if isRange {
			if b, err = strconv.Atoi(hi); err != nil {
				return nil, fmt.Errorf("selection %q", selection)
			}
		}
		for i := a; i <= b; i++ {
			if i < 1 || i > n {
				return nil, fmt.Errorf("selection %q: the file has %d sections", selection, n)
			}
			out = append(out, i-1)
		}
	}
	return out, nil
}

func count(lines []string) Section {
	var s Section
	inFence := false
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if strings.HasPrefix(line, "```") {
			inFence = !inFence
			continue
		}
		if strings.HasPrefix(line, "|") {
			j := i
			for j < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[j]), "|") {
				j++
			}
			table(lines[i:j], &s)
			i = j - 1
			continue
		}
		if checkItem.MatchString(line) {
			s.Checks++
			continue
		}
		if !inFence {
			if listMarker.MatchString(line) && strings.HasSuffix(line, "?") {
				s.Labels++
			}
			continue
		}
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// up wraps a long option list onto the next line: "/ c / d".
		for i+1 < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[i+1]), "/ ") {
			i++
			line += " " + strings.TrimSpace(lines[i])
		}
		body := listMarker.ReplaceAllString(line, "")
		_, value, hasValue := strings.Cut(body, ": ")
		switch {
		case hasValue && strings.TrimSpace(value) != "":
			s.Labels++
			if n := optionCount(value); n > 0 {
				s.Options = append(s.Options, n)
			}
		case strings.HasSuffix(body, ":"):
			// Only a plain line can head a list; a list item is a field.
			if body != line || !headsAList(lines[i+1:]) {
				s.Labels++
			}
		case strings.HasSuffix(body, "?"):
			s.Labels++
		}
	}
	sort.Ints(s.Options)
	return s
}

// headsAList reports whether the next non-empty line of a code block is a
// list item: then a line ending in ":" is a heading for the items.
func headsAList(rest []string) bool {
	for _, l := range rest {
		l = strings.TrimSpace(l)
		if l == "" {
			continue
		}
		return strings.HasPrefix(l, "- ") && !checkItem.MatchString(l)
	}
	return false
}

func table(lines []string, s *Section) {
	cells := func(l string) []string {
		l = strings.TrimSpace(l)
		l = strings.TrimPrefix(l, "|")
		l = strings.TrimSuffix(l, "|")
		parts := strings.Split(l, "|")
		for i := range parts {
			parts[i] = strings.TrimSpace(parts[i])
		}
		return parts
	}
	if len(lines) < 2 || !separator.MatchString(strings.TrimSpace(lines[1])) {
		return
	}
	cols := len(cells(lines[0]))
	body := lines[2:]
	// A template row has no row label, and only empty cells or option lists:
	// it shows what a reader's rows hold, it is not a row of its own.
	free := len(body) > 0
	for _, l := range body {
		row := cells(l)
		for i, c := range row {
			n := optionCount(c)
			if c != "" && (i == 0 || n == 0) {
				free = false
			}
			if n > 0 {
				s.Options = append(s.Options, n)
			}
		}
	}
	s.Tables = append(s.Tables, Table(len(body), cols, free))
}

// optionCount is the number of items in an "a / b / c" list, or 0.
func optionCount(v string) int {
	parts := strings.Split(strings.TrimSpace(v), " / ")
	if len(parts) < 2 {
		return 0
	}
	for _, p := range parts {
		if strings.TrimSpace(p) == "" {
			return 0
		}
	}
	return len(parts)
}

// Format writes an outline in the committed text form.
func Format(o Outline) string {
	var b strings.Builder
	b.WriteString("# Generated by internal/learning/worksheet/testdata/gen. Do not edit.\n")
	fmt.Fprintf(&b, "source: %s\ncommit: %s\nsections: %s\n", o.Source, o.Commit, orAll(o.Selection))
	if o.Fenced {
		b.WriteString("headings: fenced\n")
	}
	for i, s := range o.Sections {
		fmt.Fprintf(&b, "§%d %s\n", i+1, s.Title)
		fmt.Fprintf(&b, "  labels %d\n  checks %d\n", s.Labels, s.Checks)
		fmt.Fprintf(&b, "  tables %s\n", strings.Join(s.Tables, " "))
		opts := make([]string, len(s.Options))
		for j, n := range s.Options {
			opts[j] = strconv.Itoa(n)
		}
		fmt.Fprintf(&b, "  options %s\n", strings.Join(opts, " "))
	}
	return b.String()
}

func orAll(s string) string {
	if s == "" {
		return "all"
	}
	return s
}

// Parse reads Format's output back.
func Parse(text string) (Outline, error) {
	var o Outline
	for n, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case trimmed == "" || strings.HasPrefix(trimmed, "#"):
		case strings.HasPrefix(line, "source: "):
			o.Source = strings.TrimPrefix(line, "source: ")
		case strings.HasPrefix(line, "commit: "):
			o.Commit = strings.TrimPrefix(line, "commit: ")
		case strings.HasPrefix(line, "sections: "):
			o.Selection = strings.TrimPrefix(line, "sections: ")
		case line == "headings: fenced":
			o.Fenced = true
		case strings.HasPrefix(line, "§"):
			_, title, _ := strings.Cut(line, " ")
			o.Sections = append(o.Sections, Section{Title: title})
		case len(o.Sections) > 0:
			s := &o.Sections[len(o.Sections)-1]
			key, rest, _ := strings.Cut(trimmed, " ")
			fields := strings.Fields(rest)
			var err error
			switch key {
			case "labels":
				s.Labels, err = strconv.Atoi(rest)
			case "checks":
				s.Checks, err = strconv.Atoi(rest)
			case "tables":
				s.Tables = fields
			case "options":
				for _, f := range fields {
					v, e := strconv.Atoi(f)
					if e != nil {
						err = e
					}
					s.Options = append(s.Options, v)
				}
			default:
				err = fmt.Errorf("unknown key %q", key)
			}
			if err != nil {
				return o, fmt.Errorf("line %d: %v", n+1, err)
			}
		default:
			return o, fmt.Errorf("line %d: %q outside a section", n+1, line)
		}
	}
	return o, nil
}
