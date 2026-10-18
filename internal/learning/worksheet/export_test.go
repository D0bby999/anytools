package worksheet

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func stored(t *testing.T, v any) Answers {
	t.Helper()
	raw, _ := json.Marshal(v)
	var a Answers
	if err := json.Unmarshal(raw, &a); err != nil {
		t.Fatal(err)
	}
	return a
}

func TestExportFollowsTheKindAndEscapesEveryValue(t *testing.T) {
	w := &Worksheet{
		Kind: "example", Title: "<script>alert(1)</script>", Status: StatusOpen,
		CreatedAt: time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 10, 2, 9, 0, 0, 0, time.UTC),
		Reviews: map[string]ReviewDate{"day7": {Due: "2026-10-08", Earliest: "2026-10-08"}},
		Answers: stored(t, map[string]any{
			"boundary": map[string]any{
				"task": "# not a heading", "situation": "first\n- not a list\n1. not numbered",
				"help": []string{"captions", "AI"}, "confidence": 1, "ready": true,
				"old_field": "kept from an earlier version",
			},
			"before": map[string]any{"saved": true},
			"retest": map[string]any{"timeline": []any{
				map[string]any{"row": "day0", "cells": map[string]any{"result": "a | b", "score": 2, "barrier": "sound"}},
			}},
			"log": map[string]any{"entries": []any{
				map[string]any{"row": "", "cells": map[string]any{"date": "2026-10-01", "note": "[link](javascript:x)"}},
			}},
		}),
	}
	md := Markdown(&example, w)

	for _, want := range []string{
		"kind: \"example\"\n", "title: \"\\u003cscript\\u003ealert(1)\\u003c/script\\u003e\"\n",
		"source: \"up: internal/learning/worksheet/testdata/example.md\"\n", "  day7: \"2026-10-08\"\n",
		"# \\<script\\>alert\\(1\\)\\</script\\>\n",
		"## Boundary\n",
		"Task: \\# not a heading",
		"\\- not a list", "1\\. not numbered",
		"Help used: captions, AI",
		"Confidence: 1 (partial or prompted)",
		"Ready to share?: yes",
		"The first version is saved: [x]",
		"| Time | What is removed | Barrier | Result | Score |",
		"| Day 0 | Nothing | sound | a \\| b | 2 |", // a cell's | cannot end the cell
		"| Day 7 | Captions |",
		"| 2026-10-01 | \\[link\\]\\(javascript:x\\) |",
		"## From an earlier version\n", "boundary.old\\_field: \"kept from an earlier version\"",
	} {
		if !strings.Contains(md, want) {
			t.Errorf("export lacks %q:\n%s", want, md)
		}
	}
	if strings.Contains(md, "<script>") || strings.Contains(md, "](javascript") {
		t.Errorf("unescaped markup in the export:\n%s", md)
	}
	if strings.Count(md, "\n# ") != 1 {
		t.Errorf("a value became a heading:\n%s", md)
	}
}

func TestExportNameIsSafe(t *testing.T) {
	got := ExportName(&Worksheet{Title: `a/b\"c` + "\n"})
	if strings.ContainsAny(got, "/\\\"\n") || !strings.HasSuffix(got, ".md") {
		t.Fatalf("%q", got)
	}
}
