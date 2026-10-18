package app

// worksheet_e2e_test.go — up-methods phase 0 over HTTP, through the wiring:
// the kinds are served, a worksheet is written one section at a time, a
// refusal names its field, a stale section and an early dated row are 409,
// a row is appended without a revision, and the export is a Markdown file.

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/learning/worksheet/worksheettest"
)

func TestWorksheetRoutesEndToEnd(t *testing.T) {
	e := buildE2E(t, "http://127.0.0.1:9", nil, nil)

	kinds := e.json(http.MethodGet, "/v1/worksheet-kinds", nil, http.StatusOK)["kinds"].([]any)
	served := map[string]map[string]any{}
	for _, k := range kinds {
		m := k.(map[string]any)
		served[m["kind"].(string)] = m
	}
	if served[worksheettest.State] == nil || served[worksheettest.State]["sections"] == nil {
		t.Fatalf("the fixture kind is not served with its sections: %v", kinds)
	}
	if _, leaked := served[worksheettest.State]["Check"]; leaked {
		t.Fatal("a kind's Go function was serialised")
	}

	created := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": worksheettest.State, "title": "Brief"}, http.StatusCreated)
	id, rev := created["id"].(string), created["updated_at"].(string)
	if mapAt(created, "reviews")["day7"] == nil || created["status"] != "open" {
		t.Fatalf("created %v", created)
	}

	// A refusal names its field.
	bad := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": rev,
		"answers": map[string]any{"retest": map[string]any{"timeline": []any{
			map[string]any{"row": "day0", "cells": map[string]any{"score": 3}}}}}}, http.StatusBadRequest)
	if bad["field"] != "retest.timeline[0].score" || bad["code"] != "bad_request" {
		t.Fatalf("400 = %v", bad)
	}
	if body := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"title": "x"}, http.StatusBadRequest); body["field"] != "revision" {
		t.Fatalf("a PATCH without a revision = %v", body)
	}

	saved := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": rev,
		"answers": map[string]any{"plan": map[string]any{"task": "Ship v1"}}}, http.StatusOK)
	if mapAt(saved, "answers", "plan")["task"] != "Ship v1" {
		t.Fatalf("saved %v", saved)
	}
	// The same section at the old revision: stale.
	if body := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": rev,
		"answers": map[string]any{"plan": map[string]any{"task": "older"}}}, http.StatusConflict); body["code"] != "stale" {
		t.Fatalf("stale = %v", body)
	}
	// The dated row before its date: too early, and the API says why.
	early := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": saved["updated_at"],
		"answers": map[string]any{"retest": map[string]any{"timeline": []any{
			map[string]any{"row": "day7", "cells": map[string]any{"result": "r"}}}}}}, http.StatusConflict)
	if early["code"] != "too_early" || !strings.Contains(early["error"].(string), "review date") {
		t.Fatalf("too early = %v", early)
	}

	// A row from another component, without a revision; the third is refused.
	row := map[string]any{"section": "notes", "field": "free", "row": map[string]any{"row": "", "cells": map[string]any{"text": "from the reader"}}}
	e.json(http.MethodPost, "/v1/worksheets/"+id+"/rows", row, http.StatusCreated)
	e.json(http.MethodPost, "/v1/worksheets/"+id+"/rows", row, http.StatusCreated)
	if body := e.json(http.MethodPost, "/v1/worksheets/"+id+"/rows", row, http.StatusBadRequest); body["field"] != "notes.free" {
		t.Fatalf("a third row = %v", body)
	}

	list := e.json(http.MethodGet, "/v1/worksheets?kind="+worksheettest.State, nil, http.StatusOK)["worksheets"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["answers"] != nil {
		t.Fatalf("the list carries answers, or the wrong rows: %v", list)
	}
	if got := e.status(http.MethodGet, "/v1/worksheets?state_id=nope", nil); got != http.StatusBadRequest {
		t.Fatalf("a malformed query id: %d", got)
	}

	res := e.do(http.MethodGet, "/v1/worksheets/"+id+"/export", nil)
	md, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/markdown") ||
		!strings.Contains(res.Header.Get("Content-Disposition"), `filename="Brief.md"`) {
		t.Fatalf("export: %d %v", res.StatusCode, res.Header)
	}
	if !strings.Contains(string(md), "Task: Ship v1") || !strings.Contains(string(md), "| from the reader |") {
		t.Fatalf("export body:\n%s", md)
	}

	due := e.json(http.MethodGet, "/v1/worksheets/due", nil, http.StatusOK)
	if due["count"].(float64) != 0 {
		t.Fatalf("nothing is due on day 0: %v", due)
	}
	if got := e.status(http.MethodDelete, "/v1/worksheets/"+id, nil); got != http.StatusNoContent {
		t.Fatalf("delete: %d", got)
	}
	if got := e.status(http.MethodGet, "/v1/worksheets/"+id, nil); got != http.StatusNotFound {
		t.Fatalf("after delete: %d", got)
	}
}
