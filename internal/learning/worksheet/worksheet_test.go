package worksheet

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/learning/worksheet/outline"
)

func init() { RegisterExample() }

// ─────────────────────────────────────────────────────── the AC1 harness

// upCommit is the up commit every kind follows; testdata/gen refuses any
// other (the private design notes, phase 0).
const upCommit = "f13ff2d"

// kindOutline counts a kind the way outline.Generate counts up's Markdown.
func kindOutline(k *Kind) []outline.Section {
	var out []outline.Section
	for _, s := range k.Sections {
		if s.Added {
			continue
		}
		o := outline.Section{Title: s.Title}
		for _, f := range s.Fields {
			switch f.Type {
			case Check:
				o.Checks++
			case Table:
				cols := len(f.Columns)
				if len(f.Rows) > 0 {
					cols++ // the row-label column
				}
				o.Tables = append(o.Tables, outline.Table(len(f.Rows), cols, len(f.Rows) == 0))
				for _, c := range f.Columns {
					// A free table's options are shown once, in up's
					// template row.
					if len(f.Rows) == 0 && (c.Type == Choice || c.Type == Multi) && len(c.Options) > 0 {
						o.Options = append(o.Options, len(c.Options)+boolInt(c.Other))
					}
					for _, r := range f.Rows {
						if opts, ok := c.RowOptions[r.Key]; ok {
							o.Options = append(o.Options, len(opts)+boolInt(c.Other))
						}
					}
				}
			default:
				o.Labels++
				if (f.Type == Choice || f.Type == Multi) && len(f.Options) > 0 {
					o.Options = append(o.Options, len(f.Options)+boolInt(f.Other))
				}
			}
		}
		sort.Ints(o.Options)
		if s.Continues && len(out) > 0 {
			last := &out[len(out)-1]
			last.Labels += o.Labels
			last.Checks += o.Checks
			last.Tables = append(last.Tables, o.Tables...)
			last.Options = append(last.Options, o.Options...)
			sort.Ints(last.Options)
			continue
		}
		out = append(out, o)
	}
	return out
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// compareOutline lists every difference as "element: up X, kind Y".
func compareOutline(k *Kind, up []outline.Section) map[string]string {
	diffs := map[string]string{}
	mine := kindOutline(k)
	for _, s := range k.Sections {
		if s.Added {
			diffs["§"+s.Key+" added"] = "a section up does not have"
		}
	}
	if len(mine) != len(up) {
		diffs["sections"] = fmt.Sprintf("up %d, kind %d", len(up), len(mine))
	}
	for i := 0; i < len(mine) && i < len(up); i++ {
		a, b := up[i], mine[i]
		n := fmt.Sprintf("§%d", i+1)
		if a.Labels != b.Labels {
			diffs[n+" labels"] = fmt.Sprintf("up %d, kind %d", a.Labels, b.Labels)
		}
		if a.Checks != b.Checks {
			diffs[n+" checks"] = fmt.Sprintf("up %d, kind %d", a.Checks, b.Checks)
		}
		if strings.Join(a.Tables, " ") != strings.Join(b.Tables, " ") {
			diffs[n+" tables"] = fmt.Sprintf("up %v, kind %v", a.Tables, b.Tables)
		}
		if !reflect.DeepEqual(nonNil(a.Options), nonNil(b.Options)) {
			diffs[n+" options"] = fmt.Sprintf("up %v, kind %v", a.Options, b.Options)
		}
	}
	return diffs
}

func nonNil(s []int) []int {
	if s == nil {
		return []int{}
	}
	return s
}

// loadDeviations reads testdata/deviations.txt: "kind | element" → reason.
func loadDeviations(t *testing.T) map[string]string {
	t.Helper()
	f, err := os.Open(filepath.Join("testdata", "deviations.txt"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	out := map[string]string{}
	sc := bufio.NewScanner(f)
	for n := 1; sc.Scan(); n++ {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Split(line, " | ")
		if len(parts) != 4 || strings.TrimSpace(parts[2]) == "" || strings.TrimSpace(parts[3]) == "" {
			t.Fatalf("deviations.txt:%d: want `kind | element | what differs | why`: %q", n, line)
		}
		out[parts[0]+" | "+parts[1]] = parts[3]
	}
	return out
}

// TestEveryKindMatchesItsUpOutline is AC1: every registered kind has the
// sections, fields, tables and options of its up outline, and every
// difference is a listed deviation.
func TestEveryKindMatchesItsUpOutline(t *testing.T) {
	deviations := loadDeviations(t)
	files, err := filepath.Glob(filepath.Join("testdata", "outlines", "*.txt"))
	if err != nil {
		t.Fatal(err)
	}
	outlines := map[string]outline.Outline{}
	for _, path := range files {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		o, err := outline.Parse(string(raw))
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		kind := strings.TrimSuffix(filepath.Base(path), ".txt")
		outlines[kind] = o
		if _, ok := Lookup(kind); !ok {
			t.Errorf("outline %s has no registered kind", path)
		}
	}
	matched := map[string]bool{}
	for _, k := range Kinds() {
		o, ok := outlines[k.Kind]
		if !ok {
			t.Errorf("%s: no outline — run testdata/gen for %s and commit the result", k.Kind, k.Source)
			continue
		}
		if o.Commit != upCommit && k.Kind != example.Kind {
			t.Errorf("%s: outline generated from up at %q, want %s", k.Kind, o.Commit, upCommit)
		}
		if !strings.HasSuffix(k.Source, o.Source) && !strings.HasPrefix(k.Source, o.Source) {
			t.Errorf("%s: the kind follows %q but its outline was read from %q", k.Kind, k.Source, o.Source)
		}
		for element, diff := range compareOutline(k, o.Sections) {
			key := k.Kind + " | " + element
			matched[key] = true
			if deviations[key] == "" {
				t.Errorf("%s %s differs from up (%s) and deviations.txt does not say why", k.Kind, element, diff)
			}
		}
	}
	for key := range deviations {
		kind, _, _ := strings.Cut(key, " | ")
		if _, registered := Lookup(kind); registered && !matched[key] {
			t.Errorf("deviations.txt lists %q, which no longer differs — remove the line", key)
		}
	}
}

// The example's outline is exactly what the generator writes for
// testdata/example.md: the committed file is generated, not edited.
func TestTheExampleOutlineIsTheGeneratorsOutput(t *testing.T) {
	md, err := os.ReadFile(filepath.Join("testdata", "example.md"))
	if err != nil {
		t.Fatal(err)
	}
	secs, err := outline.Generate(md, "")
	if err != nil {
		t.Fatal(err)
	}
	want := outline.Format(outline.Outline{Source: "example.md", Commit: "fixture", Sections: secs})
	got, err := os.ReadFile(filepath.Join("testdata", "outlines", "example.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != want {
		t.Fatalf("testdata/outlines/example.txt was edited by hand:\n%s\nwant:\n%s", got, want)
	}
	if len(compareOutline(&example, secs)) != 0 {
		t.Fatalf("the example kind differs from its own outline: %v", compareOutline(&example, secs))
	}
}

// The harness notices a kind drifting from its outline.
func TestTheHarnessCatchesADifference(t *testing.T) {
	md, _ := os.ReadFile(filepath.Join("testdata", "example.md"))
	secs, _ := outline.Generate(md, "")
	drifted := example
	drifted.Sections = append([]Section(nil), example.Sections...)
	drifted.Sections[0].Fields = append(append([]Field(nil), example.Sections[0].Fields...),
		Field{Key: "extra", Label: "An improvement", Type: Text})
	drifted.Sections = append(drifted.Sections, Section{Key: "bonus", Title: "Bonus", Added: true,
		Fields: []Field{{Key: "x", Label: "x", Type: Text}}})
	diffs := compareOutline(&drifted, secs)
	if diffs["§1 labels"] == "" || diffs["§bonus added"] == "" || len(diffs) != 2 {
		t.Fatalf("diffs = %v", diffs)
	}
}

// A section that continues the one before it is counted with it: splitting
// up's block over two sections matches, and a field lost in the split does
// not.
func TestAContinuingSectionCountsWithTheOneBefore(t *testing.T) {
	md, _ := os.ReadFile(filepath.Join("testdata", "example.md"))
	secs, _ := outline.Generate(md, "")
	split := example
	split.Sections = append([]Section(nil), example.Sections...)
	first := example.Sections[0]
	half := len(first.Fields) / 2
	split.Sections[0].Fields = first.Fields[:half]
	split.Sections = append(split.Sections[:1], append([]Section{{Key: "rest", Title: "Rest", Continues: true,
		Fields: first.Fields[half:]}}, split.Sections[1:]...)...)
	if diffs := compareOutline(&split, secs); len(diffs) != 0 {
		t.Fatalf("a split section differs: %v", diffs)
	}
	split.Sections[1].Fields = split.Sections[1].Fields[1:]
	if diffs := compareOutline(&split, secs); len(diffs) == 0 {
		t.Fatal("a field dropped from a continuing section went unnoticed")
	}
}

// ─────────────────────────────────────────────────────────── registration

func TestRegisterRefusesBrokenKinds(t *testing.T) {
	base := func() Kind {
		return Kind{Kind: "broken", Name: "B", Group: GroupLife, Source: "s", Version: 1,
			Sections: []Section{{Key: "s", Title: "S", Fields: []Field{{Key: "f", Label: "F", Type: Text}}}}}
	}
	cases := map[string]func(*Kind){
		"duplicate kind":         func(k *Kind) { k.Kind = example.Kind },
		"duplicate section":      func(k *Kind) { k.Sections = append(k.Sections, k.Sections[0]) },
		"duplicate field":        func(k *Kind) { k.Sections[0].Fields = append(k.Sections[0].Fields, k.Sections[0].Fields[0]) },
		"table without columns":  func(k *Kind) { k.Sections[0].Fields[0] = Field{Key: "t", Label: "T", Type: Table, MaxRows: 2} },
		"choice without options": func(k *Kind) { k.Sections[0].Fields[0] = Field{Key: "c", Label: "C", Type: Choice} },
		"free table without cap": func(k *Kind) {
			k.Sections[0].Fields[0] = Field{Key: "t", Label: "T", Type: Table, Columns: []Field{{Key: "a", Label: "A", Type: Text}}}
		},
		"reserved key":   func(k *Kind) { k.Sections[0].Fields[0].Key = "_engine" },
		"unknown type":   func(k *Kind) { k.Sections[0].Fields[0].Type = "colour" },
		"label as field": func(k *Kind) { k.Sections[0].Fields[0].Type = Label },
		"review on nothing": func(k *Kind) {
			k.Reviews = []Review{{Key: "r", Label: "R", Days: 1, From: Anchor{Section: "s", Field: "nope"}}}
		},
		"row review on a free table": func(k *Kind) {
			k.Reviews = []Review{{Key: "r", Label: "R", Days: 1}}
			k.RowReviews = []RowReview{{Section: "s", Field: "f", Row: "x", Review: "r"}}
		},
		"max length on text": func(k *Kind) {
			k.Sections[0].Fields[0].MaxLen = MaxLongCeiling
		},
		"max length over the ceiling": func(k *Kind) {
			k.Sections[0].Fields[0] = Field{Key: "d", Label: "D", Type: Long, MaxLen: MaxLongCeiling + 1}
		},
		"first section continues": func(k *Kind) { k.Sections[0].Continues = true },
		"continues an added section": func(k *Kind) {
			k.Sections[0].Added = true
			k.Sections = append(k.Sections, Section{Key: "t", Title: "T", Continues: true,
				Fields: []Field{{Key: "f", Label: "F", Type: Text}}})
		},
	}
	for name, mutate := range cases {
		k := base()
		mutate(&k)
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("%s: register did not panic", name)
				}
			}()
			register(k)
		}()
	}
	if _, ok := Lookup("broken"); ok {
		t.Fatal("a broken kind was registered")
	}
}

func TestKindsAreSortedByGroupThenName(t *testing.T) {
	kinds := Kinds()
	for i := 1; i < len(kinds); i++ {
		a, b := kinds[i-1], kinds[i]
		if groupOrder(a.Group) > groupOrder(b.Group) ||
			(a.Group == b.Group && a.Name > b.Name) {
			t.Fatalf("%s before %s", a.Kind, b.Kind)
		}
	}
	if !IsPrivate("no_such_kind") {
		t.Error("an unknown kind must count as private")
	}
	if IsPrivate(example.Kind) {
		t.Error("example is not private")
	}
}
