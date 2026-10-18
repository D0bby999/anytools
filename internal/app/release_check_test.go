package app

// release_check_test.go — up methods phase 14, the release check's own
// end-to-end proofs over what the other phases built separately.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// Phase 14, requirement 3: deleting a video deletes the recording files of
// its listening audit. Phase 7's test proves the cleaner with a fixture kind;
// this one goes through the real kinds and routes: a listening audit on a
// YouTube document (phase 2), a recording uploaded through the API, then the
// document's DELETE.
func TestDeletingAVideoDeletesItsListeningAuditsRecordings(t *testing.T) {
	e := buildE2E(t, "http://127.0.0.1:9", nil, nil)
	ctx := context.Background()
	kbs := pg.NewKnowledgeStore(e.pool)
	kb, err := kbs.CreateKB(ctx, e.user, "KB")
	if err != nil {
		t.Fatal(err)
	}
	video := func(n int) knowledge.Document {
		id := fmt.Sprintf("dQw4w9WgXc%d", n)
		doc, err := kbs.CreateLinkDocument(ctx, knowledge.Document{UserID: e.user, KBID: kb.ID, SourceKind: knowledge.SourceYouTube,
			MediaID: id, SourceURL: "https://www.youtube.com/watch?v=" + id, Title: "v", MIME: "text/vtt",
			SHA256: blob.Digest([]byte(id)), Status: "ready"})
		if err != nil {
			t.Fatal(err)
		}
		return *doc
	}
	webm := append([]byte{0x1A, 0x45, 0xDF, 0xA3}, []byte("delayed shadow")...)
	record := func(doc knowledge.Document) string {
		audit := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": "listening_audit", "title": "Audit",
			"document_id": doc.ID}, http.StatusCreated)
		body, ct := recordingForm(t, "audio/webm", webm, "12")
		res, raw := e.send(e.user, http.MethodPost, "/v1/worksheets/"+audit["id"].(string)+"/recordings", body, ct, nil)
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("record on the audit: %d %s", res.StatusCode, raw)
		}
		var rec struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &rec); err != nil || rec.ID == "" {
			t.Fatalf("recording answer %s: %v", raw, err)
		}
		if !e.recordingThere(rec.ID) {
			t.Fatal("the recording's file was not written")
		}
		return rec.ID
	}
	gone, kept := video(1), video(2)
	onGone, onKept := record(gone), record(kept)

	if got := e.status(http.MethodDelete, fmt.Sprintf("/v1/kb/%s/documents/%s", kb.ID, gone.ID), nil); got != http.StatusNoContent {
		t.Fatalf("delete the video: %d", got)
	}
	if e.recordingThere(onGone) {
		t.Fatal("the video's delete left its listening audit's recording file")
	}
	if !e.recordingThere(onKept) {
		t.Fatal("the video's delete took another video's recording file")
	}
	var audits int
	_ = e.pool.QueryRow(ctx, `SELECT count(*) FROM worksheets WHERE user_id = $1 AND document_id = $2`, e.user, gone.ID).Scan(&audits)
	if audits != 0 {
		t.Fatalf("%d listening audits outlived their video", audits)
	}
}

// Phase 14, requirement 3: no isolation exemption without a reason. Every
// write that names no resource, every placeholder that is not one, and every
// request id field says why in its entry; a blank one is an unreviewed hole.
func TestEveryIsolationExemptionHasAReason(t *testing.T) {
	for name, table := range map[string]map[string]string{
		"writesWithoutResourceIDs": writesWithoutResourceIDs,
		"notResourceIDs":           notResourceIDs,
		"requestIDFields":          requestIDFields,
	} {
		for key, reason := range table {
			if len(strings.Fields(reason)) < 2 {
				t.Errorf("%s[%q] has no reason: %q", name, key, reason)
			}
		}
	}
}
