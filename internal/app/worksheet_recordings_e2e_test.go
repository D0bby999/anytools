package app

// worksheet_recordings_e2e_test.go — up-methods phase 7 over HTTP, through
// the wiring: a take is uploaded as a multipart form, sniffed, served back
// with ranges to its owner only, named by an audio answer, deleted with its
// answer cleared; another user's worksheet is refused before the body is
// read; and deleting a document or a knowledge base deletes the recording
// files of the worksheets attached to it (knowledge.RecordingCleaner).

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/learning/worksheet/worksheettest"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// recordingForm is a multipart body with one audio part of the given type
// and a duration.
func recordingForm(t *testing.T, mime string, data []byte, duration string) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if duration != "" {
		if err := w.WriteField("duration_seconds", duration); err != nil {
			t.Fatal(err)
		}
	}
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", `form-data; name="audio"; filename="take.webm"`)
	h.Set("Content-Type", mime)
	part, err := w.CreatePart(h)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return &buf, w.FormDataContentType()
}

// send is one request as user, with a raw body.
func (e *e2e) send(user uuid.UUID, method, path string, body io.Reader, contentType string, header map[string]string) (*http.Response, []byte) {
	e.t.Helper()
	req, err := http.NewRequest(method, e.server.URL+path, body)
	if err != nil {
		e.t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+e2eToken)
	req.Header.Set(httpx.UserIDHeader, user.String())
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := e.server.Client().Do(req)
	if err != nil {
		e.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res, raw
}

func TestWorksheetRecordingsEndToEnd(t *testing.T) {
	e := buildE2E(t, "http://127.0.0.1:9", nil, nil)
	sheet := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": "speaking_evidence", "title": "Standup"}, http.StatusCreated)
	id := sheet["id"].(string)
	base := "/v1/worksheets/" + id + "/recordings"

	webm := append([]byte{0x1A, 0x45, 0xDF, 0xA3}, []byte("0123456789abcdefghijklmnopqrstuvwxyz")...)
	upload := func(user uuid.UUID, mime string, data []byte, duration string) (*http.Response, []byte) {
		body, ct := recordingForm(t, mime, data, duration)
		return e.send(user, http.MethodPost, base, body, ct, nil)
	}

	// The three containers are taken; anything else is refused.
	for mime, data := range map[string][]byte{
		"audio/ogg": append([]byte("OggS"), 1, 2, 3), "audio/mp4": []byte("\x00\x00\x00\x18ftypM4A \x00\x00"),
	} {
		if res, raw := upload(e.user, mime, data, "12.4"); res.StatusCode != http.StatusCreated {
			t.Fatalf("%s: %d %s", mime, res.StatusCode, raw)
		}
	}
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR")
	if res, raw := upload(e.user, "audio/webm", png, "5"); res.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("a PNG called a WebM: %d %s", res.StatusCode, raw)
	}
	if res, raw := upload(e.user, "audio/webm", webm, "600.5"); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("601 seconds: %d %s", res.StatusCode, raw)
	}
	if res, raw := upload(e.user, "audio/webm", webm, ""); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("no duration: %d %s", res.StatusCode, raw)
	}
	big := append(bytes.Clone(webm), make([]byte, worksheet.MaxRecordingBytes)...)
	if res, raw := upload(e.user, "audio/webm", big, "5"); res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("10 MB and more: %d %s", res.StatusCode, raw)
	}

	// Another user's worksheet answers 404 before its 11 MB body is read.
	bob := testutil.NewUser(t, e.pool)
	if res, raw := upload(bob, "audio/webm", big, "5"); res.StatusCode != http.StatusNotFound {
		t.Fatalf("bob's upload to alice's worksheet: %d %s", res.StatusCode, raw)
	}

	res, raw := upload(e.user, "audio/webm;codecs=opus", webm, "95")
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("keep: %d %s", res.StatusCode, raw)
	}
	var rec struct {
		ID   string `json:"id"`
		MIME string `json:"mime"`
	}
	if err := json.Unmarshal(raw, &rec); err != nil {
		t.Fatal(err)
	}
	if rec.MIME != "audio/webm" {
		t.Fatalf("stored type %q", rec.MIME)
	}

	// Served with ranges, its own type, inline and nosniff — to its owner.
	res, body := e.send(e.user, http.MethodGet, base+"/"+rec.ID, nil, "", map[string]string{"Range": "bytes=4-9"})
	if res.StatusCode != http.StatusPartialContent || string(body) != "012345" ||
		res.Header.Get("Content-Type") != "audio/webm" || res.Header.Get("X-Content-Type-Options") != "nosniff" ||
		res.Header.Get("Content-Disposition") != "inline" {
		t.Fatalf("range: %d %q %v", res.StatusCode, body, res.Header)
	}
	if res, _ := e.send(bob, http.MethodGet, base+"/"+rec.ID, nil, "", nil); res.StatusCode != http.StatusNotFound {
		t.Fatalf("bob plays alice's recording: %d", res.StatusCode)
	}

	// An audio answer names it; the page shows it with the worksheet.
	saved := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": sheet["updated_at"],
		"answers": map[string]any{"baselines": map[string]any{"samples": []any{
			map[string]any{"row": "monologue", "cells": map[string]any{"recording": rec.ID, "completed": true}}}}}}, http.StatusOK)
	if len(saved["recordings"].([]any)) != 3 || mapAt(saved, "reviews")["days_3_7"] == nil {
		t.Fatalf("saved %v", saved)
	}
	got := e.json(http.MethodGet, "/v1/worksheets/"+id, nil, http.StatusOK)
	if len(mapAt(got, "worksheet")["recordings"].([]any)) != 3 {
		t.Fatalf("get %v", got)
	}

	// Deleted: its file, its row, and its answer.
	if res, _ := e.send(bob, http.MethodDelete, base+"/"+rec.ID, nil, "", nil); res.StatusCode != http.StatusNotFound {
		t.Fatalf("bob deletes alice's recording: %d", res.StatusCode)
	}
	if got := e.status(http.MethodDelete, base+"/"+rec.ID, nil); got != http.StatusNoContent {
		t.Fatalf("delete: %d", got)
	}
	if got := e.status(http.MethodGet, base+"/"+rec.ID, nil); got != http.StatusNotFound {
		t.Fatalf("after delete: %d", got)
	}
	after := e.json(http.MethodGet, "/v1/worksheets/"+id, nil, http.StatusOK)
	cells := mapAt(after, "worksheet", "answers", "baselines")["samples"].([]any)[0].(map[string]any)["cells"].(map[string]any)
	if _, held := cells["recording"]; held || cells["completed"] != true {
		t.Fatalf("the answer after the delete: %v", cells)
	}
	if e.recordingThere(rec.ID) {
		t.Fatalf("the file outlived its recording: %s", rec.ID)
	}

	// Deleting the worksheet deletes the rest of its files.
	left := mapAt(after, "worksheet")["recordings"].([]any)
	if got := e.status(http.MethodDelete, "/v1/worksheets/"+id, nil); got != http.StatusNoContent {
		t.Fatalf("delete worksheet: %d", got)
	}
	for _, r := range left {
		if rid := r.(map[string]any)["id"].(string); e.recordingThere(rid) {
			t.Fatalf("a file outlived its worksheet: %s", rid)
		}
	}
}

// A worksheet on a document is part of it: deleting the document, or its
// knowledge base, deletes the recordings' files before the rows cascade.
func TestDeletingADocumentDeletesItsWorksheetsRecordingFiles(t *testing.T) {
	e := buildE2E(t, "http://127.0.0.1:9", nil, nil)
	ctx := context.Background()
	kbs := pg.NewKnowledgeStore(e.pool)
	objects, err := blob.NewLocal(e.blobRoot)
	if err != nil {
		t.Fatal(err)
	}
	sheets := pg.NewWorksheetStore(e.pool).WithObjects(objects)
	kb, err := kbs.CreateKB(ctx, e.user, "KB")
	if err != nil {
		t.Fatal(err)
	}
	take := func(n int) (uuid.UUID, uuid.UUID) {
		doc, err := kbs.CreateDocument(ctx, knowledge.Document{UserID: e.user, KBID: kb.ID, SourceKind: "upload",
			Title: fmt.Sprintf("%d.pdf", n), MIME: "application/pdf", Bytes: 1, SHA256: strings.Repeat(fmt.Sprint(n), 64), Status: "ready"})
		if err != nil {
			t.Fatal(err)
		}
		w := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": worksheettest.Document, "title": "t",
			"document_id": doc.ID}, http.StatusCreated)
		// Phase 2's listening audit is the first document kind with an audio
		// cell; the store holds a recording on any worksheet.
		r, err := sheets.AddRecording(ctx, e.user, uuid.MustParse(w["id"].(string)),
			worksheet.Recording{MIME: worksheet.MIMEWebM, DurationSeconds: 8}, []byte{0x1A, 0x45, 0xDF, 0xA3, 1})
		if err != nil {
			t.Fatal(err)
		}
		return doc.ID, r.ID
	}
	doc, onDoc := take(1)
	_, onSibling := take(2)

	if got := e.status(http.MethodDelete, fmt.Sprintf("/v1/kb/%s/documents/%s", kb.ID, doc), nil); got != http.StatusNoContent {
		t.Fatalf("delete document: %d", got)
	}
	if e.recordingThere(onDoc.String()) || !e.recordingThere(onSibling.String()) {
		t.Fatal("the document's delete missed its recording file, or took its sibling's")
	}
	if got := e.status(http.MethodDelete, "/v1/kb/"+kb.ID.String(), nil); got != http.StatusNoContent {
		t.Fatalf("delete knowledge base: %d", got)
	}
	if e.recordingThere(onSibling.String()) {
		t.Fatal("the knowledge base's delete missed a recording file")
	}
	var rows int
	_ = e.pool.QueryRow(ctx, `SELECT count(*) FROM worksheet_recordings WHERE user_id = $1`, e.user).Scan(&rows)
	if rows != 0 {
		t.Fatalf("%d recording rows outlived their documents", rows)
	}
}

// recordingThere reports whether a recording's file is still stored.
func (e *e2e) recordingThere(id string) bool {
	e.t.Helper()
	objects, err := blob.NewLocal(e.blobRoot)
	if err != nil {
		e.t.Fatal(err)
	}
	f, err := objects.OpenObject(e.t.Context(), e.user, worksheet.RecordingNamespace, uuid.MustParse(id))
	if errors.Is(err, blob.ErrNotFound) {
		return false
	}
	if err != nil {
		e.t.Fatal(err)
	}
	f.Close()
	return true
}
