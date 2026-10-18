package outline

import (
	"reflect"
	"testing"
)

// up's writing-evidence card (docs/en/templates/writing-evidence.md §3, §8)
// has both shapes these tests pin: a table whose only body row shows the
// options a reader's rows take, and an option list wrapped onto a second
// line of its code block.

func TestATemplateRowOfOptionsIsAFreeTable(t *testing.T) {
	md := []byte("## 1. Ledger\n\n" +
		"| Claim | Type | Source |\n| --- | --- | --- |\n| | fact / number / inference | |\n\n" +
		"## 2. Fixed\n\n" +
		"| Pass | Kind | Note |\n| --- | --- | --- |\n| First | a / b | |\n")
	got, err := Generate(md, "")
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"freex3"}; !reflect.DeepEqual(got[0].Tables, want) {
		t.Errorf("template row: tables %v, want %v", got[0].Tables, want)
	}
	if want := []int{3}; !reflect.DeepEqual(got[0].Options, want) {
		t.Errorf("template row: options %v, want %v", got[0].Options, want)
	}
	// A row with a label is a row of its own, whatever its other cells hold.
	if want := []string{"1x3"}; !reflect.DeepEqual(got[1].Tables, want) {
		t.Errorf("labelled row: tables %v, want %v", got[1].Tables, want)
	}
}

func TestAWrappedOptionListIsOneList(t *testing.T) {
	md := []byte("## 1. Record\n\n```markdown\nTool:\nRequest: a / b / c\n         / d / other\nScope:\n```\n")
	got, err := Generate(md, "")
	if err != nil {
		t.Fatal(err)
	}
	if got[0].Labels != 3 {
		t.Errorf("labels %d, want 3", got[0].Labels)
	}
	if want := []int{5}; !reflect.DeepEqual(got[0].Options, want) {
		t.Errorf("options %v, want %v", got[0].Options, want)
	}
}

// up's AI templates (docs/en/templates/ai-case-review.md,
// ai-project-scorecard.md) are each one code block with their own headings;
// GenerateFenced reads those as sections, and Generate still does not.
func TestFencedHeadingsAreSectionsOnlyWhenAskedFor(t *testing.T) {
	md := []byte("# Template\n\nIntro.\n\n```markdown\n# Card — YYYY-MM-DD\n\nProject:\nOwner:\n\n" +
		"| Metric | Result |\n| --- | --- |\n| Speed | |\n\n## Gates\n- Tested: yes / no\n\n## Decision\n- Keep:\n```\n")
	plain, err := Generate(md, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(plain) != 0 {
		t.Fatalf("Generate read headings inside a code block: %+v", plain)
	}
	got, err := GenerateFenced(md, "")
	if err != nil {
		t.Fatal(err)
	}
	want := []Section{
		{Title: "Card — YYYY-MM-DD", Labels: 2, Tables: []string{"1x2"}},
		{Title: "Gates", Labels: 1, Options: []int{2}},
		{Title: "Decision", Labels: 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("GenerateFenced:\n got %+v\nwant %+v", got, want)
	}
	// The mode is recorded, and read back.
	o, err := Parse(Format(Outline{Source: "x.md", Commit: "c", Fenced: true, Sections: got}))
	if err != nil || !o.Fenced || len(o.Sections) != 3 {
		t.Fatalf("Parse(Format(fenced)) = %+v, %v", o, err)
	}
}
