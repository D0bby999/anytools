package worksheet

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func sections(t *testing.T, v map[string]any) map[string]json.RawMessage {
	t.Helper()
	out := map[string]json.RawMessage{}
	for k, s := range v {
		raw, err := json.Marshal(s)
		if err != nil {
			t.Fatal(err)
		}
		out[k] = raw
	}
	return out
}

func TestValidateAcceptsEveryFieldType(t *testing.T) {
	got, err := Validate(&example, sections(t, map[string]any{
		"boundary": map[string]any{
			"task":       "  Retell the clip\u0007 ",
			"situation":  "Line one\nline two\ttabbed",
			"context":    "a hackathon", // "other"
			"help":       []string{"captions", "AI"},
			"confidence": 2,
			"ready":      false,
			"review_on":  "2026-10-20",
		},
		"before": map[string]any{"saved": true, "no_key": false},
		"retest": map[string]any{"timeline": []any{
			map[string]any{"row": "day0", "cells": map[string]any{"barrier": "speed", "result": "ok", "score": 1}},
		}},
		"log": map[string]any{"entries": []any{
			map[string]any{"row": "", "cells": map[string]any{"date": "2026-10-01", "note": "n"}},
		}},
	}))
	if err != nil {
		t.Fatal(err)
	}
	b := got["boundary"]
	if b["task"] != "Retell the clip" || b["situation"] != "Line one\nline two\ttabbed" || b["context"] != "a hackathon" ||
		b["confidence"] != 2 || b["ready"] != false || b["review_on"] != "2026-10-20" {
		t.Fatalf("boundary cleaned to %#v", b)
	}
	if rows := got["retest"]["timeline"].([]TableRow); len(rows) != 1 || rows[0].Cells["barrier"] != "speed" {
		t.Fatalf("table cleaned to %#v", got["retest"])
	}
	// A null clears; it is not refused.
	got, err = Validate(&example, map[string]json.RawMessage{"boundary": json.RawMessage(`{"task": null}`)})
	if err != nil || got["boundary"]["task"] != nil {
		t.Fatalf("null: %v %v", got, err)
	}
}

// AC2: an answer that does not fit its kind is refused, naming the field.
func TestValidateRefusesWhatDoesNotFit(t *testing.T) {
	long := strings.Repeat("x", MaxText+1)
	cases := map[string]struct {
		body  map[string]any
		field string
	}{
		"unknown section":     {map[string]any{"nope": map[string]any{}}, "nope"},
		"unknown field":       {map[string]any{"boundary": map[string]any{"nope": "x"}}, "boundary.nope"},
		"reserved key":        {map[string]any{"boundary": map[string]any{"_engine": "x"}}, "boundary._engine"},
		"wrong type":          {map[string]any{"boundary": map[string]any{"task": 3}}, "boundary.task"},
		"not an option":       {map[string]any{"boundary": map[string]any{"help": []string{"telepathy"}}}, "boundary.help"},
		"option twice":        {map[string]any{"boundary": map[string]any{"help": []string{"AI", "AI"}}}, "boundary.help"},
		"score above 2":       {map[string]any{"boundary": map[string]any{"confidence": 3}}, "boundary.confidence"},
		"score below 0":       {map[string]any{"boundary": map[string]any{"confidence": -1}}, "boundary.confidence"},
		"fractional score":    {map[string]any{"boundary": map[string]any{"confidence": 1.5}}, "boundary.confidence"},
		"bad date":            {map[string]any{"boundary": map[string]any{"review_on": "20 Oct"}}, "boundary.review_on"},
		"over-long text":      {map[string]any{"boundary": map[string]any{"task": long}}, "boundary.task"},
		"over-long prose":     {map[string]any{"boundary": map[string]any{"situation": strings.Repeat("y", MaxLong+1)}}, "boundary.situation"},
		"yes/no as text":      {map[string]any{"boundary": map[string]any{"ready": "yes"}}, "boundary.ready"},
		"section not object":  {map[string]any{"boundary": []any{}}, "boundary"},
		"table not list":      {map[string]any{"log": map[string]any{"entries": "x"}}, "log.entries"},
		"unknown row label":   {map[string]any{"retest": map[string]any{"timeline": []any{map[string]any{"row": "day99", "cells": map[string]any{}}}}}, "retest.timeline[0]"},
		"row twice":           {map[string]any{"retest": map[string]any{"timeline": []any{map[string]any{"row": "day0"}, map[string]any{"row": "day0"}}}}, "retest.timeline[1]"},
		"label on free table": {map[string]any{"log": map[string]any{"entries": []any{map[string]any{"row": "x", "cells": map[string]any{}}}}}, "log.entries[0]"},
		"too many rows":       {map[string]any{"log": map[string]any{"entries": make([]any, 11)}}, "log.entries"},
		"unknown column":      {map[string]any{"log": map[string]any{"entries": []any{map[string]any{"row": "", "cells": map[string]any{"nope": "x"}}}}}, "log.entries[0].nope"},
		"label column written": {map[string]any{"retest": map[string]any{"timeline": []any{
			map[string]any{"row": "day0", "cells": map[string]any{"removed": "x"}}}}}, "retest.timeline[0].removed"},
		"another row's option": {map[string]any{"retest": map[string]any{"timeline": []any{
			map[string]any{"row": "day0", "cells": map[string]any{"barrier": "layout"}}}}}, "retest.timeline[0].barrier"},
		"extra row key": {map[string]any{"log": map[string]any{"entries": []any{map[string]any{"row": "", "cells": map[string]any{}, "x": 1}}}}, "log.entries[0]"},
	}
	for name, c := range cases {
		_, err := Validate(&example, sections(t, c.body))
		var fe *FieldError
		if !errors.As(err, &fe) || !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v, want a FieldError", name, err)
			continue
		}
		if fe.Field != c.field {
			t.Errorf("%s: names %q, want %q (%s)", name, fe.Field, c.field, fe.Reason)
		}
	}
}

// An audio value is a recording's id (phase 7): anything else is refused
// here, and that the id is this worksheet's own is checked under the row
// lock (recordings_test.go, and the store's tests).
func TestAnAudioValueIsARecordingID(t *testing.T) {
	k := Kind{Kind: "audio_probe", Name: "A", Group: GroupLanguage, Source: "s", Version: 1,
		Sections: []Section{{Key: "s", Title: "S", Fields: []Field{{Key: "clip", Label: "Clip", Type: Audio}}}}}
	if err := checkKind(&k); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{`"x"`, `"00000000-0000-0000-0000-000000000000"`, `42`, `["a"]`} {
		if _, err := Validate(&k, map[string]json.RawMessage{"s": json.RawMessage(`{"clip": ` + bad + `}`)}); !errors.Is(err, ErrInvalid) {
			t.Errorf("audio value %s: %v", bad, err)
		}
	}
	id := "6F9619FF-8B86-D011-B42D-00C04FC964FF"
	got, err := Validate(&k, map[string]json.RawMessage{"s": json.RawMessage(`{"clip": "` + id + `"}`)})
	if err != nil || got["s"]["clip"] != strings.ToLower(id) {
		t.Fatalf("a recording id: %v %v", got, err)
	}
}

func TestTitlesAreCleanedAndBounded(t *testing.T) {
	if got, err := CleanTitle("  My\nbrief\u0000 "); err != nil || got != "My brief" {
		t.Fatalf("%q %v", got, err)
	}
	for _, bad := range []string{"", "   ", strings.Repeat("t", MaxTitle+1)} {
		if _, err := CleanTitle(bad); !errors.Is(err, ErrInvalid) {
			t.Errorf("title %q: %v", bad, err)
		}
	}
}
