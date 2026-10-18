package app

// listening_worksheets_e2e_test.go — up-methods phase 2 over HTTP, through the
// wiring: the listening audit and the fourteen-day experiment attach to a
// video only; §7's delayed shadow is a recording of the audit, stored and
// served back; a timestamp the page could not seek to is refused; day 5 of
// the experiment is refused before day 5; and deleting the video deletes the
// day 5 recording's file before the rows cascade.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/store/pg"
)

func TestListeningWorksheetsOnAVideoEndToEnd(t *testing.T) {
	e := buildE2E(t, "http://127.0.0.1:9", nil, nil)
	ctx := context.Background()
	kbs := pg.NewKnowledgeStore(e.pool)
	kb, err := kbs.CreateKB(ctx, e.user, "Listening")
	if err != nil {
		t.Fatal(err)
	}
	doc := func(kind, title string) uuid.UUID {
		d := knowledge.Document{UserID: e.user, KBID: kb.ID, SourceKind: kind, Title: title, Bytes: 1,
			SHA256: strings.Repeat(fmt.Sprint(len(title)%10), 64), Status: "ready"}
		create := kbs.CreateDocument
		if kind == "youtube" {
			d.MIME, d.MediaID, d.SourceURL = "text/markdown", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
			create = kbs.CreateLinkDocument
		} else {
			d.MIME = "application/pdf"
		}
		made, err := create(ctx, d)
		if err != nil {
			t.Fatal(err)
		}
		return made.ID
	}
	video, pdf := doc("youtube", "A talk"), doc("upload", "notes.pdf")

	// Both kinds attach to a video and to nothing else.
	for _, kind := range []string{"listening_audit", "listening_experiment"} {
		if got := e.status(http.MethodPost, "/v1/worksheets", map[string]any{"kind": kind, "title": "x", "document_id": pdf}); got != http.StatusBadRequest {
			t.Fatalf("%s on a PDF: %d", kind, got)
		}
		if got := e.status(http.MethodPost, "/v1/worksheets", map[string]any{"kind": kind, "title": "x"}); got != http.StatusBadRequest {
			t.Fatalf("%s on nothing: %d", kind, got)
		}
	}
	audit := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": "listening_audit", "title": "A talk",
		"document_id": video}, http.StatusCreated)
	auditID := audit["id"].(string)
	listed := e.json(http.MethodGet, "/v1/worksheets?kind=listening_audit&document_id="+video.String(), nil, http.StatusOK)
	if items, _ := listed["worksheets"].([]any); len(items) != 1 {
		t.Fatalf("the video's audits: %v", listed)
	}

	webm := append([]byte{0x1A, 0x45, 0xDF, 0xA3}, []byte("delayed shadow take")...)
	keep := func(id string) string {
		body, ct := recordingForm(t, "audio/webm;codecs=opus", webm, "11")
		res, raw := e.send(e.user, http.MethodPost, "/v1/worksheets/"+id+"/recordings", body, ct, nil)
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("keep a take: %d %s", res.StatusCode, raw)
		}
		var rec struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(raw, &rec)
		return rec.ID
	}
	patch := func(id string, revision any, answers map[string]any) (int, map[string]any) {
		res := e.do(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": revision, "answers": answers})
		defer res.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}

	// §7: the segment and its delayed shadow, kept and played back.
	shadow := keep(auditID)
	code, saved := patch(auditID, audit["updated_at"], map[string]any{"segment": map[string]any{
		"start": "1:05", "end": "1:17", "shadow": shadow}})
	if code != http.StatusOK {
		t.Fatalf("save §7: %d %v", code, saved)
	}
	res, raw := e.send(e.user, http.MethodGet, "/v1/worksheets/"+auditID+"/recordings/"+shadow, nil, "", nil)
	if res.StatusCode != http.StatusOK || string(raw) != string(webm) || res.Header.Get("Content-Type") != "audio/webm" {
		t.Fatalf("play the shadow back: %d %q %s", res.StatusCode, raw, res.Header.Get("Content-Type"))
	}
	if code, out := patch(auditID, saved["updated_at"], map[string]any{"segment": map[string]any{"end": "77"}}); code != http.StatusBadRequest {
		t.Fatalf("an end of %q: %d %v", "77", code, out)
	}

	// The experiment: day 5's row, with its recording, waits for day 5.
	exp := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": "listening_experiment", "title": "Two weeks",
		"document_id": video}, http.StatusCreated)
	expID := exp["id"].(string)
	take := keep(expID)
	day1 := map[string]any{"row": "day1", "cells": map[string]any{"done": true}}
	code, saved = patch(expID, exp["updated_at"], map[string]any{"days": map[string]any{"plan": []any{day1}}})
	if code != http.StatusOK {
		t.Fatalf("day 1: %d %v", code, saved)
	}
	day5 := map[string]any{"row": "day5", "cells": map[string]any{"recording": take, "evidence": "boundaries"}}
	if code, out := patch(expID, saved["updated_at"], map[string]any{"days": map[string]any{"plan": []any{day1, day5}}}); code != http.StatusConflict {
		t.Fatalf("day 5 on day 1: %d %v", code, out)
	}

	// Deleting the video deletes both worksheets' recording files first.
	if got := e.status(http.MethodDelete, fmt.Sprintf("/v1/kb/%s/documents/%s", kb.ID, video), nil); got != http.StatusNoContent {
		t.Fatalf("delete the video: %d", got)
	}
	for _, id := range []string{shadow, take} {
		if e.recordingThere(id) {
			t.Fatalf("recording %s outlived its video", id)
		}
	}
	var rows int
	_ = e.pool.QueryRow(ctx, `SELECT count(*) FROM worksheets WHERE user_id = $1`, e.user).Scan(&rows)
	if rows != 0 {
		t.Fatalf("%d worksheets outlived their video", rows)
	}
}
