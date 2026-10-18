package worksheetapi

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
)

// recordings.go is the learner's own voice on a worksheet (up-methods phase
// 7): upload one take, stream it back to its owner, delete it.
//
// The upload resolves the worksheet with the caller's id BEFORE it reads the
// body, so another user's worksheet costs no upload. The body is a multipart
// form with one `audio` part and a `duration_seconds` field, read through
// blob.ReadAllLimited; the bytes are sniffed and must agree with the part's
// declared type (worksheet.SniffAudio).

// maxRecordingRequest bounds the whole multipart body: one take plus the
// form's few small fields and boundaries.
const maxRecordingRequest = worksheet.MaxRecordingBytes + 64<<10

func (h *Handler) uploadRecording(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.RecordingTarget(r.Context(), userID, id); err != nil {
		h.fail(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRecordingRequest)
	mr, err := r.MultipartReader()
	if err != nil {
		badRequest(w, "send the recording as a multipart form with one audio part", "audio")
		return
	}
	var in worksheet.NewRecording
	var sawAudio, sawDuration bool
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			if isTooLarge(err) {
				tooLarge(w)
				return
			}
			badRequest(w, "malformed multipart body", "")
			return
		}
		switch part.FormName() {
		case "audio":
			if sawAudio {
				badRequest(w, "send one recording at a time", "audio")
				return
			}
			data, over, err := blob.ReadAllLimited(part, worksheet.MaxRecordingBytes)
			if over || isTooLarge(err) {
				tooLarge(w)
				return
			}
			if err != nil {
				badRequest(w, "malformed multipart body", "audio")
				return
			}
			in.Data, in.DeclaredMIME, sawAudio = data, part.Header.Get("Content-Type"), true
		case "duration_seconds":
			raw, _, err := blob.ReadAllLimited(part, 16)
			if err != nil {
				badRequest(w, "malformed multipart body", "duration_seconds")
				return
			}
			n, err := strconv.ParseFloat(strings.TrimSpace(string(raw)), 64)
			if err != nil || n < 0 {
				badRequest(w, "duration_seconds is a number of seconds", "duration_seconds")
				return
			}
			// A browser measures fractions of a second; the cap is on the
			// rounded-up length, so 600.4 seconds is refused.
			in.DurationSeconds, sawDuration = int(n+0.999), true
		}
		_ = part.Close()
	}
	if !sawAudio {
		badRequest(w, "send the recording in an audio part", "audio")
		return
	}
	if !sawDuration {
		badRequest(w, "send the recording's duration_seconds", "duration_seconds")
		return
	}
	rec, err := h.svc.AddRecording(r.Context(), userID, id, in)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, rec)
}

// recording streams a take to its owner, with range support so a player
// can seek. Both ids are resolved together with the caller's id.
func (h *Handler) recording(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	rid, ok := recordingID(w, r)
	if !ok {
		return
	}
	rec, f, err := h.svc.OpenRecording(r.Context(), userID, id, rid)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", rec.MIME)
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeContent(w, r, "", f.ModTime, f)
}

func (h *Handler) deleteRecording(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	rid, ok := recordingID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteRecording(r.Context(), userID, id, rid); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// recordingID reads `{rid}`. A malformed id is the same 404 as another
// user's.
func recordingID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(strings.TrimSpace(r.PathValue("rid")))
	if err != nil || id == uuid.Nil {
		notFound(w)
		return uuid.Nil, false
	}
	return id, true
}

func isTooLarge(err error) bool {
	var mbe *http.MaxBytesError
	return errors.As(err, &mbe)
}

func tooLarge(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusRequestEntityTooLarge,
		"a recording is at most "+strconv.Itoa(worksheet.MaxRecordingBytes>>20)+" MB", "too_large")
}

// failRecording maps the recordings' errors; ok is false for any other
// error, which fail handles.
func failRecording(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, worksheet.ErrRecordingNotFound):
		// An audio answer naming a recording this worksheet does not have:
		// another user's answers exactly like a made-up one.
		httpx.WriteError(w, http.StatusNotFound, "that recording is not on this worksheet", "not_found")
	case errors.Is(err, worksheet.ErrRecordingMissing):
		httpx.WriteError(w, http.StatusNotFound, "recording missing — delete it and record again", "recording_missing")
	case errors.Is(err, worksheet.ErrNoRecordings):
		badRequest(w, "this worksheet holds no recordings", "audio")
	case errors.Is(err, worksheet.ErrRecordingFormat):
		httpx.WriteError(w, http.StatusUnsupportedMediaType,
			"this is not a WebM, Ogg or MP4 recording, or its type does not match its contents", "unsupported_media")
	case errors.Is(err, worksheet.ErrRecordingsFull):
		httpx.WriteError(w, http.StatusConflict, strings.TrimPrefix(err.Error(), "worksheet: "), "recordings_full")
	case errors.Is(err, worksheet.ErrRecordingQuota):
		httpx.WriteError(w, http.StatusRequestEntityTooLarge, strings.TrimPrefix(err.Error(), "worksheet: "), "quota")
	default:
		return false
	}
	return true
}
