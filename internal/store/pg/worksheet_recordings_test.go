package pg_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/learning/worksheet/worksheettest"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// flakyObjects is a real object store whose writes and deletes can be made
// to fail.
type flakyObjects struct {
	*blob.Local
	failPut, failDelete atomic.Bool
}

func (o *flakyObjects) PutObject(ctx context.Context, user uuid.UUID, ns string, id uuid.UUID, data []byte) error {
	if o.failPut.Load() {
		return errors.New("disk full")
	}
	return o.Local.PutObject(ctx, user, ns, id, data)
}

func (o *flakyObjects) DeleteObject(ctx context.Context, user uuid.UUID, ns string, id uuid.UUID) error {
	if o.failDelete.Load() {
		return errors.New("read-only file system")
	}
	return o.Local.DeleteObject(ctx, user, ns, id)
}

var (
	webmTake = append([]byte{0x1A, 0x45, 0xDF, 0xA3}, bytes.Repeat([]byte{7}, 60)...)
	oggTake  = append([]byte("OggS"), bytes.Repeat([]byte{7}, 60)...)
	mp4Take  = append([]byte("\x00\x00\x00\x20ftypM4A "), bytes.Repeat([]byte{7}, 60)...)
)

func newRecordingFixture(t *testing.T) (context.Context, *worksheetFixture, *flakyObjects) {
	ctx, f := newWorksheetFixture(t)
	local, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	objects := &flakyObjects{Local: local}
	f.sheets.WithObjects(objects)
	return ctx, f, objects
}

func (f *worksheetFixture) speaking(t *testing.T, ctx context.Context, user uuid.UUID) *worksheet.Worksheet {
	t.Helper()
	return f.create(t, ctx, user, "speaking_evidence", nil)
}

func (f *worksheetFixture) keep(t *testing.T, ctx context.Context, user, sheet uuid.UUID) *worksheet.Recording {
	t.Helper()
	r, err := f.svc.AddRecording(ctx, user, sheet, worksheet.NewRecording{Data: webmTake, DeclaredMIME: "audio/webm", DurationSeconds: 95})
	if err != nil {
		t.Fatalf("keep a recording: %v", err)
	}
	return r
}

func recordingCount(t *testing.T, ctx context.Context, f *worksheetFixture, sheet uuid.UUID) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM worksheet_recordings WHERE worksheet_id = $1`, sheet).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func fileExists(t *testing.T, objects *flakyObjects, user, id uuid.UUID) bool {
	t.Helper()
	f, err := objects.OpenObject(context.Background(), user, worksheet.RecordingNamespace, id)
	if errors.Is(err, blob.ErrNotFound) {
		return false
	}
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	return true
}

func TestRecordingUploadsAreSniffedAndBounded(t *testing.T) {
	ctx, f, objects := newRecordingFixture(t)
	w := f.speaking(t, ctx, f.alice)

	for declared, data := range map[string][]byte{"audio/webm;codecs=opus": webmTake, "audio/ogg": oggTake, "audio/mp4": mp4Take} {
		r, err := f.svc.AddRecording(ctx, f.alice, w.ID, worksheet.NewRecording{Data: data, DeclaredMIME: declared, DurationSeconds: 90})
		if err != nil {
			t.Fatalf("%s: %v", declared, err)
		}
		got, err := objects.GetObject(ctx, f.alice, worksheet.RecordingNamespace, r.ID)
		if err != nil || !bytes.Equal(got, data) || r.Bytes != len(data) {
			t.Errorf("%s: stored %d bytes (%v)", declared, len(got), err)
		}
	}

	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR")
	refusals := map[string]struct {
		in   worksheet.NewRecording
		want error
	}{
		"a PNG called a WebM":     {worksheet.NewRecording{Data: png, DeclaredMIME: "audio/webm", DurationSeconds: 5}, worksheet.ErrRecordingFormat},
		"a WebM declared as Ogg":  {worksheet.NewRecording{Data: webmTake, DeclaredMIME: "audio/ogg", DurationSeconds: 5}, worksheet.ErrRecordingFormat},
		"10 MB and one byte":      {worksheet.NewRecording{Data: append(bytes.Clone(webmTake), make([]byte, worksheet.MaxRecordingBytes)...), DeclaredMIME: "audio/webm", DurationSeconds: 5}, worksheet.ErrInvalid},
		"601 seconds":             {worksheet.NewRecording{Data: webmTake, DeclaredMIME: "audio/webm", DurationSeconds: 601}, worksheet.ErrInvalid},
		"an empty take":           {worksheet.NewRecording{DeclaredMIME: "audio/webm"}, worksheet.ErrInvalid},
		"a negative duration":     {worksheet.NewRecording{Data: webmTake, DeclaredMIME: "audio/webm", DurationSeconds: -1}, worksheet.ErrInvalid},
		"a type nobody declared ": {worksheet.NewRecording{Data: webmTake, DurationSeconds: 5}, worksheet.ErrRecordingFormat},
	}
	for name, c := range refusals {
		if _, err := f.svc.AddRecording(ctx, f.alice, w.ID, c.in); !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", name, err, c.want)
		}
	}
	if n := recordingCount(t, ctx, f, w.ID); n != 3 {
		t.Errorf("%d recordings after the refusals, want 3", n)
	}

	// Another user's worksheet is not found; a kind without audio takes none.
	if _, err := f.svc.AddRecording(ctx, f.bob, w.ID, worksheet.NewRecording{Data: webmTake, DeclaredMIME: "audio/webm"}); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("bob uploads to alice's worksheet: %v", err)
	}
	plain := f.create(t, ctx, f.alice, worksheettest.State, nil)
	if _, err := f.svc.AddRecording(ctx, f.alice, plain.ID, worksheet.NewRecording{Data: webmTake, DeclaredMIME: "audio/webm"}); !errors.Is(err, worksheet.ErrNoRecordings) {
		t.Errorf("a kind without an audio field took a recording: %v", err)
	}
}

// Thirty recordings a worksheet, checked under its row lock: two parallel
// uploads at 29 cannot both land.
func TestTheThirtyRecordingCapHoldsUnderConcurrency(t *testing.T) {
	ctx, f, _ := newRecordingFixture(t)
	w := f.speaking(t, ctx, f.alice)
	for i := 0; i < worksheet.MaxRecordingsPerWorksheet-1; i++ {
		f.keep(t, ctx, f.alice, w.ID)
	}
	var ok, full atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := f.svc.AddRecording(ctx, f.alice, w.ID, worksheet.NewRecording{Data: webmTake, DeclaredMIME: "audio/webm", DurationSeconds: 1})
			switch {
			case err == nil:
				ok.Add(1)
			case errors.Is(err, worksheet.ErrRecordingsFull):
				full.Add(1)
			default:
				t.Errorf("upload: %v", err)
			}
		}()
	}
	wg.Wait()
	if ok.Load() != 1 || full.Load() != 1 || recordingCount(t, ctx, f, w.ID) != worksheet.MaxRecordingsPerWorksheet {
		t.Fatalf("%d landed, %d refused, %d stored", ok.Load(), full.Load(), recordingCount(t, ctx, f, w.ID))
	}
}

// 500 MB a learner, summed over every worksheet.
func TestTheRecordingQuotaIsPerLearner(t *testing.T) {
	ctx, f, _ := newRecordingFixture(t)
	a, b := f.speaking(t, ctx, f.alice), f.speaking(t, ctx, f.alice)
	// 49 recordings of 10 MB across two worksheets, as rows: the quota reads
	// the rows, not the disk.
	for i := 0; i < 49; i++ {
		sheet := a.ID
		if i%2 == 1 {
			sheet = b.ID
		}
		if _, err := f.pool.Exec(ctx, `INSERT INTO worksheet_recordings (user_id, worksheet_id, mime, bytes, duration_seconds)
			VALUES ($1, $2, 'audio/webm', $3, 600)`, f.alice, sheet, worksheet.MaxRecordingBytes); err != nil {
			t.Fatal(err)
		}
	}
	// 490 MB used: a 10 MB take fits exactly, and nothing after it.
	full := append(bytes.Clone(webmTake), make([]byte, worksheet.MaxRecordingBytes-len(webmTake))...)
	if _, err := f.svc.AddRecording(ctx, f.alice, b.ID, worksheet.NewRecording{Data: full, DeclaredMIME: "audio/webm", DurationSeconds: 600}); err != nil {
		t.Fatalf("the last 10 MB: %v", err)
	}
	if _, err := f.svc.AddRecording(ctx, f.alice, a.ID, worksheet.NewRecording{Data: webmTake, DeclaredMIME: "audio/webm"}); !errors.Is(err, worksheet.ErrRecordingQuota) {
		t.Fatalf("past 500 MB: %v", err)
	}
	// Bob's quota is his own.
	bobs := f.speaking(t, ctx, f.bob)
	f.keep(t, ctx, f.bob, bobs.ID)
}

// A failed file write leaves no row; a row whose file went missing serves
// "missing" and can still be deleted.
func TestARecordingRowNeverOutlivesAFailedWrite(t *testing.T) {
	ctx, f, objects := newRecordingFixture(t)
	w := f.speaking(t, ctx, f.alice)
	objects.failPut.Store(true)
	if _, err := f.svc.AddRecording(ctx, f.alice, w.ID, worksheet.NewRecording{Data: webmTake, DeclaredMIME: "audio/webm"}); err == nil {
		t.Fatal("a failed write succeeded")
	}
	if n := recordingCount(t, ctx, f, w.ID); n != 0 {
		t.Fatalf("%d rows after a failed write", n)
	}
	objects.failPut.Store(false)

	r := f.keep(t, ctx, f.alice, w.ID)
	_, file, err := f.svc.OpenRecording(ctx, f.alice, w.ID, r.ID)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	got, err := io.ReadAll(file)
	file.Close()
	if err != nil || !bytes.Equal(got, webmTake) || file.Size != int64(len(webmTake)) {
		t.Fatalf("read %d bytes (size %d) of the %d kept: %v", len(got), file.Size, len(webmTake), err)
	}
	if _, _, err := f.svc.OpenRecording(ctx, f.bob, w.ID, r.ID); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("bob resolves alice's recording: %v", err)
	}
	other := f.speaking(t, ctx, f.alice)
	if _, _, err := f.svc.OpenRecording(ctx, f.alice, other.ID, r.ID); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("a recording resolved under another worksheet: %v", err)
	}
	if err := objects.Local.DeleteObject(ctx, f.alice, worksheet.RecordingNamespace, r.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := f.svc.OpenRecording(ctx, f.alice, w.ID, r.ID); !errors.Is(err, worksheet.ErrRecordingMissing) {
		t.Fatalf("a missing file: %v", err)
	}
	if err := f.svc.DeleteRecording(ctx, f.alice, w.ID, r.ID); err != nil {
		t.Fatalf("delete a recording whose file is missing: %v", err)
	}
}

// An audio value naming another worksheet's recording is refused.
func TestAnAudioAnswerNamesOnlyThisWorksheetsRecording(t *testing.T) {
	ctx, f, _ := newRecordingFixture(t)
	w, other := f.speaking(t, ctx, f.alice), f.speaking(t, ctx, f.alice)
	foreign := f.keep(t, ctx, f.alice, other.ID)
	bobs := f.speaking(t, ctx, f.bob)
	bobsTake := f.keep(t, ctx, f.bob, bobs.ID)
	own := f.keep(t, ctx, f.alice, w.ID)

	take := func(id uuid.UUID) map[string]json.RawMessage {
		return map[string]json.RawMessage{"baselines": section(t, map[string]any{
			"samples": []any{map[string]any{"row": "monologue", "cells": map[string]any{"recording": id}}}})}
	}
	for name, id := range map[string]uuid.UUID{"another worksheet's": foreign.ID, "bob's": bobsTake.ID, "a made-up": uuid.New()} {
		if _, err := f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: w.UpdatedAt, Answers: take(id)}); !errors.Is(err, worksheet.ErrRecordingNotFound) {
			t.Errorf("%s recording: %v", name, err)
		}
		row := json.RawMessage(`{"row": "mark", "cells": {"recording": "` + id.String() + `"}}`)
		if _, err := f.svc.AppendRow(ctx, f.alice, w.ID, "shadowing", "ladder", row); !errors.Is(err, worksheet.ErrRecordingNotFound) {
			t.Errorf("%s recording in an appended row: %v", name, err)
		}
	}
	saved, err := f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: w.UpdatedAt, Answers: take(own.ID)})
	if err != nil {
		t.Fatalf("its own recording: %v", err)
	}
	if len(saved.Recordings) != 1 || saved.Reviews["days_3_7"].Due == "" {
		t.Fatalf("saved %+v", saved)
	}
}

// Deleting a recording deletes its file, then its row, and clears its id
// from the answers, so the section can still be saved.
func TestDeletingARecordingClearsItsAnswer(t *testing.T) {
	ctx, f, objects := newRecordingFixture(t)
	w := f.speaking(t, ctx, f.alice)
	r := f.keep(t, ctx, f.alice, w.ID)
	saved, err := f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: w.UpdatedAt,
		Answers: map[string]json.RawMessage{"baselines": section(t, map[string]any{"main_point": "the outage", "samples": []any{
			map[string]any{"row": "monologue", "cells": map[string]any{"recording": r.ID, "first_break": "0:42"}}}})}})
	if err != nil {
		t.Fatal(err)
	}

	if err := f.svc.DeleteRecording(ctx, f.bob, w.ID, r.ID); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("bob deletes alice's recording: %v", err)
	}
	objects.failDelete.Store(true)
	if err := f.svc.DeleteRecording(ctx, f.alice, w.ID, r.ID); err == nil {
		t.Fatal("a delete whose file stayed succeeded")
	}
	if recordingCount(t, ctx, f, w.ID) != 1 || !fileExists(t, objects, f.alice, r.ID) {
		t.Fatal("a failed file delete changed something")
	}
	objects.failDelete.Store(false)
	if err := f.svc.DeleteRecording(ctx, f.alice, w.ID, r.ID); err != nil {
		t.Fatal(err)
	}
	if recordingCount(t, ctx, f, w.ID) != 0 || fileExists(t, objects, f.alice, r.ID) {
		t.Fatal("the recording or its file is still there")
	}

	got, err := f.svc.Get(ctx, f.alice, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	cells := got.Answers["baselines"]["samples"].([]any)[0].(map[string]any)["cells"].(map[string]any)
	if _, held := cells["recording"]; held || cells["first_break"] != "0:42" || got.Answers["baselines"]["main_point"] != "the outage" {
		t.Fatalf("answers after the delete: %v", got.Answers["baselines"])
	}
	// The page that still held the id is told the section changed.
	if _, err := f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: saved.UpdatedAt,
		Answers: map[string]json.RawMessage{"baselines": section(t, map[string]any{"main_point": "x"})}}); !errors.Is(err, worksheet.ErrConflict) {
		t.Errorf("a stale page rewrote the cleared section: %v", err)
	}
	// Reloaded, the section saves.
	if _, err := f.svc.Update(ctx, f.alice, w.ID, worksheet.Patch{Revision: got.UpdatedAt,
		Answers: map[string]json.RawMessage{"baselines": section(t, map[string]any{"samples": []any{
			map[string]any{"row": "monologue", "cells": map[string]any{"first_break": "0:40"}}}})}}); err != nil {
		t.Fatalf("the section after its recording went: %v", err)
	}
}

// Deleting a worksheet deletes its recordings' files first; a file that
// cannot be deleted keeps everything, so the delete can be retried.
func TestDeletingAWorksheetDeletesItsRecordingFilesFirst(t *testing.T) {
	ctx, f, objects := newRecordingFixture(t)
	w := f.speaking(t, ctx, f.alice)
	a, b := f.keep(t, ctx, f.alice, w.ID), f.keep(t, ctx, f.alice, w.ID)

	objects.failDelete.Store(true)
	if err := f.svc.Delete(ctx, f.alice, w.ID); err == nil {
		t.Fatal("a worksheet whose files stayed was deleted")
	}
	if _, err := f.svc.Get(ctx, f.alice, w.ID); err != nil {
		t.Fatalf("the worksheet went anyway: %v", err)
	}
	objects.failDelete.Store(false)
	if err := f.svc.Delete(ctx, f.bob, w.ID); !errors.Is(err, worksheet.ErrNotFound) {
		t.Errorf("bob deletes alice's worksheet: %v", err)
	}
	if err := f.svc.Delete(ctx, f.alice, w.ID); err != nil {
		t.Fatal(err)
	}
	for _, r := range []*worksheet.Recording{a, b} {
		if fileExists(t, objects, f.alice, r.ID) {
			t.Errorf("recording %s outlived its worksheet", r.ID)
		}
	}
	if recordingCount(t, ctx, f, w.ID) != 0 {
		t.Error("recording rows outlived their worksheet")
	}
}

// knowledge.RecordingCleaner: the files of recordings on worksheets attached
// to a document, or to any document of a knowledge base — and nothing else.
func TestTheRecordingCleanerDeletesOnlyThatDocumentsFiles(t *testing.T) {
	ctx, f, objects := newRecordingFixture(t)
	kbs := pg.NewKnowledgeStore(f.pool)
	kb, err := kbs.CreateKB(ctx, f.alice, "KB")
	if err != nil {
		t.Fatal(err)
	}
	other, err := kbs.CreateKB(ctx, f.alice, "Other")
	if err != nil {
		t.Fatal(err)
	}
	doc, sibling, elsewhere := seedDocument(t, kbs, f.alice, kb.ID, "a.pdf"), seedDocument(t, kbs, f.alice, kb.ID, "b.pdf"),
		seedDocument(t, kbs, f.alice, other.ID, "c.pdf")
	take := func(document uuid.UUID) *worksheet.Recording {
		w, err := f.svc.Create(ctx, f.alice, worksheet.NewWorksheet{Kind: worksheettest.Document, Title: "t", DocumentID: &document})
		if err != nil {
			t.Fatal(err)
		}
		// The store takes a recording on any worksheet; the service decides
		// which kinds hold them.
		r, err := f.sheets.AddRecording(ctx, f.alice, w.ID, worksheet.Recording{MIME: worksheet.MIMEWebM, DurationSeconds: 3}, webmTake)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	onDoc, onSibling, onElsewhere := take(doc.ID), take(sibling.ID), take(elsewhere.ID)
	onState := f.keep(t, ctx, f.alice, f.speaking(t, ctx, f.alice).ID)

	// Bob's ids reach nothing of Alice's.
	if err := f.sheets.DeleteDocumentRecordings(ctx, f.bob, doc.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.sheets.DeleteKBRecordings(ctx, f.bob, kb.ID); err != nil {
		t.Fatal(err)
	}
	if !fileExists(t, objects, f.alice, onDoc.ID) {
		t.Fatal("bob's cleaner call deleted alice's file")
	}

	objects.failDelete.Store(true)
	if err := f.sheets.DeleteDocumentRecordings(ctx, f.alice, doc.ID); err == nil {
		t.Fatal("a file that could not be deleted did not fail the cleaner")
	}
	objects.failDelete.Store(false)
	if err := f.sheets.DeleteDocumentRecordings(ctx, f.alice, doc.ID); err != nil {
		t.Fatal(err)
	}
	if fileExists(t, objects, f.alice, onDoc.ID) || !fileExists(t, objects, f.alice, onSibling.ID) {
		t.Fatal("the document cleaner missed its file or took its sibling's")
	}
	if err := f.sheets.DeleteKBRecordings(ctx, f.alice, kb.ID); err != nil {
		t.Fatal(err)
	}
	if fileExists(t, objects, f.alice, onSibling.ID) {
		t.Fatal("the knowledge base cleaner missed a document's file")
	}
	if !fileExists(t, objects, f.alice, onElsewhere.ID) || !fileExists(t, objects, f.alice, onState.ID) {
		t.Fatal("the cleaner took files outside its knowledge base")
	}
}
