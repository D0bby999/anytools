package kbapi

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// media.go — audio and video files (up-methods phase 15): the upload's file
// part, the recording served to the viewer's native player, and stopping a
// transcription.

// maxFormField bounds a non-file part of the upload form.
const maxFormField = 64 << 10

// uploadForm is what an upload request carried: its file parts, in order,
// and whether photos are one document (up-methods phase 16).
type uploadForm struct {
	files       []knowledge.PhotoFile
	oneDocument bool
}

// readUploadForm streams the multipart body and reads each part named "file"
// through blob.ReadAllLimited at its own cap (knowledge.UploadLimit: 500 MB
// for an audio or video name, 50 MB for anything else), so nothing is spooled
// to disk first. The one_document field is read bounded. At most one more file
// than a photo document may hold is read; uploadPhotos refuses the count. A
// non-zero status is the refusal to write.
func readUploadForm(r *http.Request) (form uploadForm, status int, msg string) {
	mr, err := r.MultipartReader()
	if err != nil {
		return form, http.StatusBadRequest, "send the file as multipart/form-data"
	}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				return form, http.StatusRequestEntityTooLarge, tooLarge("")
			}
			return form, http.StatusBadRequest, "the upload could not be read"
		}
		if part.FormName() != "file" || part.FileName() == "" {
			value, err := io.ReadAll(io.LimitReader(part, maxFormField))
			if err != nil {
				return form, http.StatusBadRequest, "the upload could not be read"
			}
			if part.FormName() == "one_document" {
				form.oneDocument = strings.TrimSpace(string(value)) == "true"
			}
			continue
		}
		if len(form.files) > parse.MaxPhotosPerDocument {
			break
		}
		filename := part.FileName()
		data, over, err := blob.ReadAllLimited(part, knowledge.UploadLimit(filename))
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				return form, http.StatusRequestEntityTooLarge, tooLarge(filename)
			}
			return form, http.StatusBadRequest, "the upload could not be read"
		}
		if over {
			return form, http.StatusRequestEntityTooLarge, tooLarge(filename)
		}
		form.files = append(form.files, knowledge.PhotoFile{Name: filename, Data: data})
	}
	if len(form.files) == 0 {
		return form, http.StatusBadRequest, "a file part named \"file\" is required"
	}
	return form, 0, ""
}

// tooLarge names the cap that applies to a file of this name.
func tooLarge(filename string) string {
	if filename == "" {
		return fmt.Sprintf("the file must be %d MB or smaller (audio and video: %d MB)",
			knowledge.MaxUploadBytes>>20, knowledge.MaxMediaBytes>>20)
	}
	return fmt.Sprintf("the file must be %d MB or smaller", knowledge.UploadLimit(filename)>>20)
}

// media serves an uploaded recording to its owner for the viewer's <audio>
// or <video>. The document is authorized first; another learner's id, an id
// that does not exist and a document that is not a recording all answer 404.
//
// Headers, as readingapi's file route sets them and for the same reasons:
//   - Content-Type is the type sniffed from the file's bytes at upload, from
//     a closed list of audio and video types, never from the request;
//   - nosniff, so no browser decides the bytes are something else;
//   - inline with no filename, and a sandbox CSP for the response itself;
//   - private caching with the content digest as the ETag;
//   - http.ServeContent answers the Range requests a player seeks with (206).
func (h *Handler) media(w http.ResponseWriter, r *http.Request) {
	userID, docID, ok := h.requireDocument(w, r)
	if !ok {
		return
	}
	rec, err := h.svc.OpenRecording(r.Context(), userID, docID)
	if errors.Is(err, knowledge.ErrNotRecording) {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return
	}
	if err != nil {
		h.fail(w, r, err)
		return
	}
	defer rec.Content.Close()
	if _, _, err := mime.ParseMediaType(rec.MIME); err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return
	}
	w.Header().Set("Content-Type", rec.MIME)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("ETag", `"`+rec.Digest+`"`)
	http.ServeContent(w, r, "", rec.ModTime, rec.Content)
}

// cancelTranscription stops a running transcription after the window in
// flight. Nothing is billed for the windows it never reaches.
func (h *Handler) cancelTranscription(w http.ResponseWriter, r *http.Request) {
	userID, docID, ok := h.requireDocument(w, r)
	if !ok {
		return
	}
	if err := h.svc.CancelTranscription(r.Context(), userID, docID); err != nil {
		h.linkFail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}
