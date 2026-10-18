package app

// reading_evidence_e2e_test.go — up-methods phase 5 over HTTP: the reading
// evidence card attaches to an uploaded document and refuses a YouTube one;
// the reader's "Mark a barrier" is a server-side row append that leaves the
// panel's other sections alone; the retests count from the first pass and
// open on their day.

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/store/pg"
)

func TestReadingEvidenceOnADocument(t *testing.T) {
	e := buildE2E(t, "http://127.0.0.1:9", nil, nil)
	ctx := context.Background()
	kbs := pg.NewKnowledgeStore(e.pool)
	kb, err := kbs.CreateKB(ctx, e.user, "KB")
	if err != nil {
		t.Fatal(err)
	}
	pdf, err := kbs.CreateDocument(ctx, knowledge.Document{UserID: e.user, KBID: kb.ID, SourceKind: knowledge.SourceUpload,
		Title: "paper.pdf", MIME: "application/pdf", Bytes: 1, SHA256: blob.Digest([]byte("paper")), Status: "ready"})
	if err != nil {
		t.Fatal(err)
	}
	video, err := kbs.CreateLinkDocument(ctx, knowledge.Document{UserID: e.user, KBID: kb.ID, SourceKind: knowledge.SourceYouTube,
		MediaID: "dQw4w9WgXcQ", SourceURL: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", Title: "v", MIME: "text/vtt",
		SHA256: blob.Digest([]byte("video")), Status: "ready"})
	if err != nil {
		t.Fatal(err)
	}

	// A video is the listening audit's; the reading card refuses it.
	refused := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": "reading_evidence", "title": "v",
		"document_id": video.ID}, http.StatusBadRequest)
	if refused["field"] != "document_id" {
		t.Fatalf("a YouTube document = %v", refused)
	}
	if body := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": "reading_evidence", "title": "v"},
		http.StatusBadRequest); body["field"] != "document_id" {
		t.Fatalf("no document = %v", body)
	}

	created := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": "reading_evidence", "title": "Reading paper.pdf",
		"document_id": pdf.ID}, http.StatusCreated)
	id, rev := created["id"].(string), created["updated_at"].(string)
	if len(mapAt(created, "reviews")) != 0 {
		t.Fatalf("retests scheduled before the first pass: %v", created["reviews"])
	}
	list := e.json(http.MethodGet, fmt.Sprintf("/v1/worksheets?kind=reading_evidence&document_id=%s", pdf.ID), nil, http.StatusOK)["worksheets"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["id"] != id {
		t.Fatalf("the document's worksheets: %v", list)
	}

	// The panel writes the first pass and pass 1 at the revision it loaded.
	saved := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": rev, "answers": map[string]any{
		"first_pass": map[string]any{"gist": "Smaller releases fail less."},
	}}, http.StatusOK)
	reviews := mapAt(saved, "reviews")
	for _, key := range []string{"days_3_7", "day14", "day30"} {
		if reviews[key] == nil {
			t.Fatalf("%s is not scheduled once the gist is written: %v", key, reviews)
		}
	}

	// "Mark a barrier": appended server-side, no revision, twice.
	for _, text := range []string{"the second clause", "what 'it' refers to"} {
		e.json(http.MethodPost, "/v1/worksheets/"+id+"/rows", map[string]any{"section": "barriers", "field": "map",
			"row": map[string]any{"row": "", "cells": map[string]any{"page": "3", "stuck": text}}}, http.StatusCreated)
	}
	// The panel, still at its revision, marks pass 1 done: another section,
	// so it lands and the barriers stay.
	e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": saved["updated_at"], "answers": map[string]any{
		"passes": map[string]any{"passes": []any{map[string]any{"row": "orient", "cells": map[string]any{"output": "gist", "done": true}}}},
	}}, http.StatusOK)
	// A layer picked afterwards would rewrite the table from a stale copy:
	// refused, so the second barrier is never lost.
	if body := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": saved["updated_at"], "answers": map[string]any{
		"barriers": map[string]any{"map": []any{map[string]any{"row": "", "cells": map[string]any{"stuck": "x", "layer": "structure and reference"}}}},
	}}, http.StatusConflict); body["code"] != "stale" {
		t.Fatalf("a stale barrier table = %v", body)
	}
	got := e.json(http.MethodGet, "/v1/worksheets/"+id, nil, http.StatusOK)
	sheet := mapAt(got, "worksheet")
	rows := mapAt(sheet, "answers", "barriers")["map"].([]any)
	if len(rows) != 2 {
		t.Fatalf("barriers: %v", rows)
	}
	if passes := mapAt(sheet, "answers", "passes")["passes"].([]any); len(passes) != 1 {
		t.Fatalf("passes: %v", passes)
	}

	// Days 3–7 is not open on the day of the first pass.
	if body := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": sheet["updated_at"], "answers": map[string]any{
		"retests": map[string]any{"retest": []any{map[string]any{"row": "day3_7", "cells": map[string]any{"result": "r"}}}},
	}}, http.StatusConflict); body["code"] != "too_early" {
		t.Fatalf("an early retest = %v", body)
	}
	// Day 1 is open at once.
	e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": sheet["updated_at"], "answers": map[string]any{
		"retests": map[string]any{"retest": []any{map[string]any{"row": "day1", "cells": map[string]any{"result": "five sentences"}}}},
	}}, http.StatusOK)
}
