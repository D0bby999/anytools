package ownversion

import (
	"strings"
	"testing"
)

func full() *Lines {
	return &Lines{Understanding: " a ", Uncertain: "b", Proof: "c"}
}

func TestCheck(t *testing.T) {
	cases := []struct {
		name     string
		required bool
		sent     *Lines
		code     string
		kept     bool
	}{
		{"on, none", true, nil, "own_version_required", false},
		{"on, blank", true, &Lines{}, "own_version_required", false},
		{"on, partial", true, &Lines{Understanding: "a"}, "own_version_invalid", false},
		{"on, full", true, full(), "", true},
		{"off, none", false, nil, "", false},
		{"off, partial", false, &Lines{Proof: "c"}, "own_version_invalid", false},
		{"off, full", false, full(), "", true},
		{"on, too long", true, &Lines{Understanding: strings.Repeat("é", MaxLine+1), Uncertain: "b", Proof: "c"}, "own_version_invalid", false},
		{"on, at the cap", true, &Lines{Understanding: strings.Repeat("é", MaxLine), Uncertain: "b", Proof: "c"}, "", true},
	}
	for _, c := range cases {
		got, refusal := Check(c.required, c.sent)
		code := ""
		if refusal != nil {
			code = refusal.Code
		}
		if code != c.code || (got != nil) != c.kept {
			t.Errorf("%s: code %q kept %v, want %q %v", c.name, code, got != nil, c.code, c.kept)
		}
	}
	if got, _ := Check(true, full()); got.Understanding != "a" {
		t.Errorf("lines are not trimmed: %q", got.Understanding)
	}
}

func TestFromAttachmentsAcceptsBothShapes(t *testing.T) {
	if FromAttachments([]byte(`[]`)) != nil || FromAttachments(nil) != nil {
		t.Fatal("an array carries no lines")
	}
	if FromAttachments([]byte(`{"sources":[]}`)) != nil {
		t.Fatal("an object without own_version carries no lines")
	}
	l := FromAttachments(Attachments(Lines{Understanding: "u", Uncertain: "n", Proof: "p"}))
	if l == nil || l.Uncertain != "n" {
		t.Fatalf("round trip: %+v", l)
	}
}

func TestWithQuestionPutsTheLinesUnderTheHeading(t *testing.T) {
	got := WithQuestion("Why?", &Lines{Understanding: "U1", Uncertain: "N1", Proof: "P1"})
	head := strings.Index(got, Heading)
	if !strings.HasPrefix(got, "Why?") || head < 0 {
		t.Fatalf("got %q", got)
	}
	for _, s := range []string{"U1", "N1", "P1"} {
		if i := strings.Index(got, s); i < head {
			t.Errorf("%s is not under the heading: %q", s, got)
		}
	}
	if WithQuestion("Why?", nil) != "Why?" {
		t.Error("no lines, no block")
	}
}

func TestNormalizeRetell(t *testing.T) {
	if _, ok := NormalizeRetell("  "); ok {
		t.Error("blank retell accepted")
	}
	if _, ok := NormalizeRetell(strings.Repeat("x", MaxRetell+1)); ok {
		t.Error("over-long retell accepted")
	}
	if s, ok := NormalizeRetell(" ok "); !ok || s != "ok" {
		t.Errorf("got %q %v", s, ok)
	}
}
