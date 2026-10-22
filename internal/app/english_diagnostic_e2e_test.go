package app

// english_diagnostic_e2e_test.go — up-methods phase 1 over HTTP: the
// diagnostic is served with its CEFR self-check, a barrier from another
// skill's list and a score of 3 are 400 naming the cell, and the Day 7 row
// written three days after the first version is 409. Since f13ff2d
// (the private design notes, phase 0) the kind is version 2 with
// up's §2A, and a version 1 worksheet keeps every value.

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestTheEnglishDiagnosticEndToEnd(t *testing.T) {
	e := buildE2E(t, "http://127.0.0.1:9", nil, nil)

	var kind map[string]any
	for _, k := range e.json(http.MethodGet, "/v1/worksheet-kinds", nil, http.StatusOK)["kinds"].([]any) {
		if m := k.(map[string]any); m["kind"] == "english_diagnostic" {
			kind = m
		}
	}
	if kind == nil || kind["group"] != "language" || kind["private"] != false || len(kind["reviews"].([]any)) != 3 {
		t.Fatalf("the diagnostic is not served as a language kind with three reviews: %v", kind)
	}
	var keys []string
	for _, s := range kind["sections"].([]any) {
		keys = append(keys, s.(map[string]any)["key"].(string))
	}
	if len(keys) != 11 || keys[2] != "collaboration" || keys[9] != "cefr" || keys[10] != "next" {
		t.Fatalf("sections %v: §2A follows §2, and the CEFR self-check comes just before the next cycle", keys)
	}
	if kind["version"] != float64(2) {
		t.Fatalf("version %v, want 2", kind["version"])
	}

	created := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": "english_diagnostic", "title": "October baseline"}, http.StatusCreated)
	id, rev := created["id"].(string), created["updated_at"].(string)
	// The quick version's first-version date starts as today, so the three
	// reviews are scheduled at once (the private design notes, phase
	// 5); moving the date below moves them.
	if len(mapAt(created, "reviews")) != 3 || mapAt(mapAt(created, "answers"), "first_version")["first_version_on"] == nil {
		t.Fatalf("a new diagnostic: reviews %v, answers %v", created["reviews"], created["answers"])
	}

	bad := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": rev,
		"answers": map[string]any{"barriers": map[string]any{"barriers": []any{
			map[string]any{"row": "listening", "cells": map[string]any{"barrier": "sentence"}}}}}}, http.StatusBadRequest)
	if bad["field"] != "barriers.barriers[0].barrier" {
		t.Fatalf("a writing barrier on the listening row = %v", bad)
	}
	bad = e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": rev,
		"answers": map[string]any{"scores": map[string]any{"scores": []any{
			map[string]any{"row": "writing", "cells": map[string]any{"task": 3}}}}}}, http.StatusBadRequest)
	if bad["field"] != "scores.scores[0].task" {
		t.Fatalf("a score of 3 = %v", bad)
	}

	// The first version three days ago: day 7 is four days off, whatever the
	// learner's zone does to today by a day.
	first := time.Now().UTC().AddDate(0, 0, -3)
	saved := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": rev,
		"answers": map[string]any{"first_version": map[string]any{"first_version_on": first.Format(time.DateOnly)}}}, http.StatusOK)
	reviews := mapAt(saved, "reviews")
	for key, days := range map[string]int{"day7": 7, "day30": 30, "week12": 84} {
		want := first.AddDate(0, 0, days).Format(time.DateOnly)
		if r, _ := reviews[key].(map[string]any); r == nil || r["due"] != want {
			t.Errorf("%s = %v, want due %s", key, reviews[key], want)
		}
	}
	early := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": saved["updated_at"],
		"answers": map[string]any{"retest": map[string]any{"timeline": []any{
			map[string]any{"row": "day7", "cells": map[string]any{"result": "parallel topic"}}}}}}, http.StatusConflict)
	if early["code"] != "too_early" {
		t.Fatalf("the Day 7 row on day 3 = %v", early)
	}
}

// A worksheet stored at version 1, before §2A, with every section filled:
// it opens with every value, takes a §2A write, and exports every earlier
// value as before. Nothing is moved: §2A starts empty.
//
// testdata/english_diagnostic_v1.json is the answers a version 1 worksheet
// stores: every field of every section, every row of every table, written
// through the version 1 kind's validation at f8ffd43. It is frozen, so a
// later change that renames or moves a version 1 field fails here.
func TestAVersionOneDiagnosticKeepsEveryValue(t *testing.T) {
	e := buildE2E(t, "http://127.0.0.1:9", nil, nil)

	stored, err := os.ReadFile(filepath.Join("testdata", "english_diagnostic_v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var id string
	if err := e.pool.QueryRow(context.Background(), `
		INSERT INTO worksheets (user_id, kind, kind_version, title, answers, private, reviews)
		VALUES ($1, 'english_diagnostic', 1, 'September baseline', $2, false,
		        '{"day7":{"due":"2026-01-12","earliest":"2026-01-12","done":true},
		          "day30":{"due":"2026-02-04","earliest":"2026-02-04","done":true},
		          "week12":{"due":"2026-03-30","earliest":"2026-03-30","done":true}}')
		RETURNING id`, e.user, stored).Scan(&id); err != nil {
		t.Fatal(err)
	}
	var want map[string]any
	_ = json.Unmarshal(stored, &want)

	got := e.json(http.MethodGet, "/v1/worksheets/"+id, nil, http.StatusOK)
	if earlier, _ := got["earlier"].([]any); len(earlier) != 0 {
		t.Fatalf("version 1 values listed as an earlier version's: %v", earlier)
	}
	opened := mapAt(got, "worksheet")
	if opened["kind_version"] != float64(1) || !reflect.DeepEqual(opened["answers"], want) {
		t.Fatalf("version 1 opened as version %v with answers\n%v\nwant\n%v", opened["kind_version"], opened["answers"], want)
	}
	before := e.raw(http.MethodGet, "/v1/worksheets/"+id+"/export", nil)

	saved := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": opened["updated_at"],
		"answers": map[string]any{"collaboration": map[string]any{"dimensions": []any{
			map[string]any{"row": "online", "cells": map[string]any{"evidence": "Status thread 3 Oct: picked up without a call"}}}}}},
		http.StatusOK)
	answers := mapAt(saved, "answers")
	collab := answers["collaboration"]
	delete(answers, "collaboration")
	if !reflect.DeepEqual(answers, want) || collab == nil || saved["kind_version"] != float64(1) {
		t.Fatalf("after the §2A write: version %v, §2A %v, answers\n%v\nwant\n%v", saved["kind_version"], collab, answers, want)
	}
	reopened := mapAt(e.json(http.MethodGet, "/v1/worksheets/"+id, nil, http.StatusOK), "worksheet", "answers")
	delete(reopened, "collaboration")
	if !reflect.DeepEqual(reopened, want) {
		t.Fatalf("reopened answers\n%v\nwant\n%v", reopened, want)
	}

	after := e.raw(http.MethodGet, "/v1/worksheets/"+id+"/export", nil)
	if !strings.Contains(after, "Status thread 3 Oct: picked up without a call") {
		t.Fatalf("the §2A evidence is not exported:\n%s", after)
	}
	if strings.Contains(before, "From an earlier version") || strings.Contains(after, "From an earlier version") {
		t.Fatalf("a version 1 value was read as an earlier version's leftover:\n%s", after)
	}
	if got, want := withoutCollaboration(after), withoutCollaboration(before); got != want {
		t.Fatalf("the §2A write changed the rest of the export:\n%s\nwant:\n%s", got, want)
	}
	// Every written value, including each table cell, is in the export.
	var texts []string
	var walk func(v any)
	walk = func(v any) {
		switch v := v.(type) {
		case string:
			if strings.HasPrefix(v, "v1 ") {
				texts = append(texts, v)
			}
		case map[string]any:
			for _, x := range v {
				walk(x)
			}
		case []any:
			for _, x := range v {
				walk(x)
			}
		}
	}
	walk(want)
	if len(texts) < 60 {
		t.Fatalf("only %d written values in the fixture", len(texts))
	}
	for _, s := range texts {
		if !strings.Contains(after, s) {
			t.Errorf("%q is missing from the export", s)
		}
	}
}

// withoutCollaboration drops §2A and the "updated" date from an export.
func withoutCollaboration(md string) string {
	var keep []string
	inSection := false
	for _, line := range strings.Split(md, "\n") {
		if strings.HasPrefix(line, "## ") {
			inSection = line == "## Collaboration dimensions"
		}
		if !inSection && !strings.HasPrefix(line, "updated: ") {
			keep = append(keep, line)
		}
	}
	return strings.Join(keep, "\n")
}
