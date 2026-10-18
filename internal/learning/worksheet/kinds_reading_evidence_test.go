package worksheet

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/learning"
)

// The reading evidence card (up-methods phase 5): attached to a readable
// document, never a video; its barrier layers each carry the chapter's next
// step; its answers are held to the kind (AC2); and its retests count from
// the first pass (AC4).

func TestReadingEvidenceAttachesToReadableDocumentsOnly(t *testing.T) {
	k, ok := Lookup("reading_evidence")
	if !ok {
		t.Fatal("reading_evidence is not registered")
	}
	if k.Attach != AttachDocument || k.Private || k.Group != GroupLanguage {
		t.Fatalf("attach %q, private %v, group %q", k.Attach, k.Private, k.Group)
	}
	if contains(k.DocumentKinds, "youtube") || !contains(k.DocumentKinds, "upload") || !contains(k.DocumentKinds, "web") {
		t.Fatalf("document kinds %v: uploads and web pages, never YouTube", k.DocumentKinds)
	}
}

func TestEveryBarrierLayerHasItsNextStep(t *testing.T) {
	k, _ := Lookup("reading_evidence")
	var layer *Field
	for i, c := range k.field("barriers", "map").Columns {
		if c.Key == "layer" {
			layer = &k.field("barriers", "map").Columns[i]
		}
	}
	if layer == nil || len(layer.Options) != 6 {
		t.Fatalf("the barrier layer column: %+v", layer)
	}
	for _, o := range layer.Options {
		if strings.TrimSpace(layer.OptionHints[o]) == "" {
			t.Errorf("layer %q has no next step", o)
		}
	}
}

func TestRegisterRefusesAMisplacedOptionHint(t *testing.T) {
	cases := map[string]Field{
		"a hint for no option": {Key: "c", Label: "C", Type: Choice, Options: []string{"a"},
			OptionHints: map[string]string{"b": "?"}},
		"a hint on a line": {Key: "c", Label: "C", Type: Text, OptionHints: map[string]string{"a": "?"}},
		"a hint on a multi": {Key: "c", Label: "C", Type: Multi, Options: []string{"a"},
			OptionHints: map[string]string{"a": "?"}},
	}
	for name, f := range cases {
		k := Kind{Kind: "hinted", Name: "H", Group: GroupLife, Source: "s", Version: 1,
			Sections: []Section{{Key: "s", Title: "S", Fields: []Field{f}}}}
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("%s: register did not panic", name)
				}
			}()
			register(k)
		}()
	}
}

func TestReadingEvidenceRefusesWhatDoesNotFit(t *testing.T) {
	k, _ := Lookup("reading_evidence")
	barrier := map[string]any{"row": "", "cells": map[string]any{"page": "3", "stuck": "the second clause", "layer": LayerStructure}}
	if _, err := Validate(k, sections(t, map[string]any{"barriers": map[string]any{"map": []any{barrier}}})); err != nil {
		t.Fatalf("a barrier row: %v", err)
	}
	thirtyOne := make([]any, 31)
	for i := range thirtyOne {
		thirtyOne[i] = barrier
	}
	cases := map[string]map[string]any{
		"barriers.map[0].layer": {"barriers": map[string]any{"map": []any{
			map[string]any{"row": "", "cells": map[string]any{"layer": "pronunciation"}}}}},
		"barriers.map":                {"barriers": map[string]any{"map": thirtyOne}},
		"passes.passes[0].job":        {"passes": map[string]any{"passes": []any{map[string]any{"row": "orient", "cells": map[string]any{"job": "x"}}}}},
		"passes.passes[0]":            {"passes": map[string]any{"passes": []any{map[string]any{"row": "sixth", "cells": map[string]any{"done": true}}}}},
		"score.scores[0].day1":        {"score": map[string]any{"scores": []any{map[string]any{"row": "main_line", "cells": map[string]any{"day1": 3}}}}},
		"output.deliveries[0].output": {"output": map[string]any{"deliveries": []any{map[string]any{"row": "", "cells": map[string]any{"output": "essay"}}}}},
		"first_pass.gist":             {"first_pass": map[string]any{"gist": strings.Repeat("g", MaxText+1)}},
		"first_pass.colour":           {"first_pass": map[string]any{"colour": "blue"}},
	}
	for want, body := range cases {
		_, err := Validate(k, sections(t, body))
		var fe *FieldError
		if !errors.As(err, &fe) || !strings.HasPrefix(fe.Field, want) {
			t.Errorf("%s: got %v", want, err)
		}
	}
}

func TestReadingRetestsCountFromTheFirstPass(t *testing.T) {
	k, _ := Lookup("reading_evidence")
	created := learning.Day{Year: 2026, Month: time.October, Day: 1}
	reviews := map[string]ReviewDate{}
	schedule(k, Answers{}, reviews, created, created)
	if len(reviews) != 0 {
		t.Fatalf("scheduled before the first pass: %v", reviews)
	}
	firstPass := learning.Day{Year: 2026, Month: time.October, Day: 3}
	schedule(k, Answers{"first_pass": {"gist": "It argues for smaller releases."}}, reviews, created, firstPass)
	want := map[string]string{"days_3_7": "2026-10-08", "day14": "2026-10-17", "day30": "2026-11-02"}
	for key, due := range want {
		if reviews[key].Due != due {
			t.Errorf("%s due %q, want %q", key, reviews[key].Due, due)
		}
	}
	for _, row := range []string{"day3_7", "day14", "day30"} {
		found := false
		for _, rr := range k.RowReviews {
			found = found || (rr.Section == "retests" && rr.Field == "retest" && rr.Row == row)
		}
		if !found {
			t.Errorf("retest row %s opens at any time", row)
		}
	}
}
