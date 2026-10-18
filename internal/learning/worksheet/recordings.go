package worksheet

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"mime"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/google/uuid"
)

// recordings.go is the learner's own voice on a worksheet (phase 7): the raw
// takes up's speaking evidence card keeps — baselines, shadowing levels,
// delayed retests. The chapter asks for the original: no denoising, no cut
// pauses, no rewriting. So a recording is stored as the browser made it, and
// an `audio` field holds its id.
//
// What the engine decides:
//
//   - a recording belongs to ONE worksheet of ONE user; an audio value naming
//     any other id (another worksheet's, another user's, none at all) is
//     ErrRecordingNotFound, the same answer for each;
//   - its bytes are sniffed: WebM/Matroska, Ogg or ISO BMFF, and the type the
//     client declared must agree;
//   - limits: 10 MB and ten minutes a take, 30 takes a worksheet, 500 MB a
//     learner — the cap and the quota are checked under the worksheet's row
//     lock (and a per-user lock for the quota), so two parallel uploads
//     cannot both pass;
//   - objects go before rows: a deleted recording's file goes first, and its
//     id is cleared from the answers in the same transaction, so a section is
//     never locked by an id that no longer resolves.

// Recording limits (owner decision 4, 2026-10-01).
const (
	MaxRecordingBytes         = 10 << 20
	MaxRecordingSeconds       = 600
	MaxRecordingsPerWorksheet = 30
	RecordingQuotaBytes       = 500 << 20
)

// RecordingNamespace is the blob.ObjectStore namespace of recordings.
const RecordingNamespace = "recordings"

// The stored MIME types: what the bytes are, never what the client said.
const (
	MIMEWebM = "audio/webm"
	MIMEOgg  = "audio/ogg"
	MIMEMP4  = "audio/mp4"
)

var (
	// ErrRecordingNotFound is an audio value that is not one of this
	// worksheet's recordings. Another user's id answers exactly like a
	// made-up one.
	ErrRecordingNotFound = errors.New("worksheet: no such recording on this worksheet")
	// ErrRecordingMissing is a recording row whose file is gone (a crash
	// between the row and the file). It can still be deleted.
	ErrRecordingMissing = errors.New("worksheet: recording missing")
	// ErrNoRecordings is an upload to a worksheet whose kind has no audio
	// field.
	ErrNoRecordings = errors.New("worksheet: this worksheet holds no recordings")
	// ErrRecordingFormat is bytes that are not WebM, Ogg or MP4 audio, or
	// that disagree with the declared type.
	ErrRecordingFormat = errors.New("worksheet: not a WebM, Ogg or MP4 recording")
	// ErrRecordingsFull is the 31st recording of a worksheet.
	ErrRecordingsFull = fmt.Errorf("worksheet: a worksheet holds at most %d recordings", MaxRecordingsPerWorksheet)
	// ErrRecordingQuota is an upload past the learner's 500 MB.
	ErrRecordingQuota = fmt.Errorf("worksheet: your recordings use the %d MB you have; delete some to keep new ones",
		RecordingQuotaBytes>>20)
)

// Recording is one take on a worksheet. Its file is the ObjectStore object
// RecordingNamespace/<id>.
type Recording struct {
	ID              uuid.UUID `json:"id"`
	WorksheetID     uuid.UUID `json:"worksheet_id"`
	MIME            string    `json:"mime"`
	Bytes           int       `json:"bytes"`
	DurationSeconds int       `json:"duration_seconds"`
	CreatedAt       time.Time `json:"created_at"`
}

// NewRecording is an upload: the bytes, the type the client declared, and
// the duration the browser measured.
type NewRecording struct {
	Data            []byte
	DeclaredMIME    string
	DurationSeconds int
}

// RecordingStore is the persistence recordings need. pg.WorksheetStore
// implements it; every method names the owner and the worksheet.
type RecordingStore interface {
	// AddRecording locks the worksheet, checks the per-worksheet cap and the
	// user's quota under the lock, inserts the row, then writes the file; a
	// failed write leaves no row.
	AddRecording(ctx context.Context, userID, worksheetID uuid.UUID, r Recording, data []byte) (*Recording, error)
	// OpenRecording is the row and its file, opened for streaming. A row
	// whose file is gone is ErrRecordingMissing. The caller closes the file.
	OpenRecording(ctx context.Context, userID, worksheetID, recordingID uuid.UUID) (*Recording, *blob.File, error)
	// DeleteRecording locks the worksheet, deletes the file, then the row,
	// and writes the sections clear returns, in one transaction. A file that
	// cannot be deleted fails it with the row kept.
	DeleteRecording(ctx context.Context, userID, worksheetID, recordingID uuid.UUID,
		clear func(*Worksheet) map[string]map[string]any) error
}

// SniffAudio names the container the bytes start with: WebM/Matroska's EBML
// header, Ogg's capture pattern, or an ISO BMFF `ftyp` box.
func SniffAudio(data []byte) (string, bool) {
	switch {
	case bytes.HasPrefix(data, []byte{0x1A, 0x45, 0xDF, 0xA3}):
		return MIMEWebM, true
	case bytes.HasPrefix(data, []byte("OggS")):
		return MIMEOgg, true
	case len(data) >= 12 && string(data[4:8]) == "ftyp":
		return MIMEMP4, true
	}
	return "", false
}

// declaredAs is the stored type a client's declared type stands for. A
// browser names the same container in more than one way (a WebM made by
// MediaRecorder, an .m4a from a phone's voice memo app).
func declaredAs(declared string) string {
	base, _, err := mime.ParseMediaType(declared)
	if err != nil {
		return ""
	}
	switch strings.ToLower(base) {
	case "audio/webm", "video/webm":
		return MIMEWebM
	case "audio/ogg", "application/ogg":
		return MIMEOgg
	case "audio/mp4", "audio/x-m4a", "audio/m4a", "video/mp4":
		return MIMEMP4
	}
	return ""
}

// RecordingTarget resolves the worksheet an upload is for, before its body
// is read: another user's worksheet is ErrNotFound, and a kind without an
// audio field is ErrNoRecordings.
func (s *Service) RecordingTarget(ctx context.Context, userID, worksheetID uuid.UUID) error {
	w, err := s.store.Get(ctx, userID, worksheetID)
	if err != nil {
		return err
	}
	if k, ok := Lookup(w.Kind); !ok || !k.HasAudio() {
		return ErrNoRecordings
	}
	return nil
}

// AddRecording keeps one take. The bytes decide the type; the declared type
// must agree with them.
func (s *Service) AddRecording(ctx context.Context, userID, worksheetID uuid.UUID, in NewRecording) (*Recording, error) {
	if err := s.RecordingTarget(ctx, userID, worksheetID); err != nil {
		return nil, err
	}
	if len(in.Data) == 0 {
		return nil, invalid("audio", "the recording is empty")
	}
	if len(in.Data) > MaxRecordingBytes {
		return nil, invalid("audio", "a recording is at most %d MB", MaxRecordingBytes>>20)
	}
	if in.DurationSeconds < 0 || in.DurationSeconds > MaxRecordingSeconds {
		return nil, invalid("duration_seconds", "a recording is at most %d minutes", MaxRecordingSeconds/60)
	}
	sniffed, ok := SniffAudio(in.Data)
	if !ok || declaredAs(in.DeclaredMIME) != sniffed {
		return nil, ErrRecordingFormat
	}
	return s.recordings().AddRecording(ctx, userID, worksheetID, Recording{
		WorksheetID: worksheetID, MIME: sniffed, Bytes: len(in.Data), DurationSeconds: in.DurationSeconds,
	}, in.Data)
}

// OpenRecording resolves a recording with both ids and the owner, and opens
// its file for streaming.
func (s *Service) OpenRecording(ctx context.Context, userID, worksheetID, recordingID uuid.UUID) (*Recording, *blob.File, error) {
	return s.recordings().OpenRecording(ctx, userID, worksheetID, recordingID)
}

// DeleteRecording removes a take, its file first, and clears its id from
// every audio cell that holds it, so the section stays saveable.
func (s *Service) DeleteRecording(ctx context.Context, userID, worksheetID, recordingID uuid.UUID) error {
	return s.recordings().DeleteRecording(ctx, userID, worksheetID, recordingID, func(w *Worksheet) map[string]map[string]any {
		return clearRecording(w, recordingID.String())
	})
}

func (s *Service) recordings() RecordingStore {
	rs, ok := s.store.(RecordingStore)
	if !ok {
		panic("worksheet: the store keeps no recordings")
	}
	return rs
}

// checkRecordings refuses audio values in the cleaned sections that are not
// among the worksheet's own recordings (w.Recordings, read with the owner's
// id under the row lock).
func checkRecordings(k *Kind, w *Worksheet, sections map[string]map[string]any) error {
	own := make(map[string]bool, len(w.Recordings))
	for _, r := range w.Recordings {
		own[r.ID.String()] = true
	}
	var err error
	walkAudio(k, sections, func(path string, id string) {
		if err == nil && !own[id] {
			err = fmt.Errorf("%w: %s", ErrRecordingNotFound, path)
		}
	})
	return err
}

// walkAudio calls fn for every audio value in answers (cleaned or stored),
// with its path.
func walkAudio(k *Kind, answers map[string]map[string]any, fn func(path, id string)) {
	for _, s := range k.Sections {
		fields := answers[s.Key]
		for _, f := range s.Fields {
			v, ok := fields[f.Key]
			if !ok || v == nil {
				continue
			}
			path := s.Key + "." + f.Key
			switch f.Type {
			case Audio:
				if id, ok := v.(string); ok {
					fn(path, id)
				}
			case Table:
				for i, row := range tableRows(v) {
					for _, c := range f.Columns {
						if c.Type != Audio {
							continue
						}
						if id, ok := row[c.Key].(string); ok {
							fn(fmt.Sprintf("%s[%d].%s", path, i, c.Key), id)
						}
					}
				}
			}
		}
	}
}

// tableRows is each row's cells of a cleaned ([]TableRow) or stored ([]any)
// table value.
func tableRows(v any) []map[string]any {
	switch rows := v.(type) {
	case []TableRow:
		out := make([]map[string]any, len(rows))
		for i, r := range rows {
			out[i] = r.Cells
		}
		return out
	case []any:
		out := make([]map[string]any, 0, len(rows))
		for _, r := range rows {
			m, _ := r.(map[string]any)
			cells, _ := m["cells"].(map[string]any)
			out = append(out, cells)
		}
		return out
	}
	return nil
}

// clearRecording is every stored section whose field or table cell holds id,
// with that value removed. It searches value by value, whatever the kind, so
// a worksheet whose kind is no longer registered never keeps a dead id
// either; a recording id is a UUID, which no learner text equals by chance.
func clearRecording(w *Worksheet, id string) map[string]map[string]any {
	out := map[string]map[string]any{}
	for section, fields := range w.Answers {
		var changed bool
		next := make(map[string]any, len(fields))
		for key, v := range fields {
			switch x := v.(type) {
			case string:
				if x == id {
					changed = true
					continue
				}
			case []any:
				rows := make([]any, 0, len(x))
				for _, r := range x {
					m, _ := r.(map[string]any)
					cells, _ := m["cells"].(map[string]any)
					var hit bool
					kept := make(map[string]any, len(cells))
					for col, cell := range cells {
						if s, ok := cell.(string); ok && s == id {
							hit = true
							continue
						}
						kept[col] = cell
					}
					if hit {
						changed = true
						r = map[string]any{"row": m["row"], "cells": kept}
					}
					rows = append(rows, r)
				}
				v = rows
			}
			next[key] = v
		}
		if changed {
			out[section] = next
		}
	}
	return out
}
