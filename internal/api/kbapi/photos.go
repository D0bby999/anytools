package kbapi

// Photos of pages and notes as sources (up-methods phase 16).

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// uploadPhotos adds the request's "file" parts as one document, one page per
// photo in the order of the parts. The request is already capped at one
// upload's size by uploadDocument.
func (h *Handler) uploadPhotos(w http.ResponseWriter, r *http.Request, userID, kbID uuid.UUID, files []knowledge.PhotoFile) {
	if len(files) > parse.MaxPhotosPerDocument {
		h.uploaded(w, r, nil, parse.ErrTooManyPhotos)
		return
	}
	for _, f := range files {
		if int64(len(f.Data)) > parse.MaxPhotoBytes {
			h.uploaded(w, r, nil, parse.ErrPhotoTooLarge)
			return
		}
	}
	res, err := h.svc.UploadPhotos(r.Context(), userID, kbID, files)
	h.uploaded(w, r, res, err)
}

// documentPhoto serves page n's photo of a photo document, for the reading
// view to show beside the text read from it. The headers are readingapi.file's
// and for the same reasons: the type from the sniff, never from the request;
// nosniff; inline with no filename; a sandbox so nothing in it runs; private
// caching keyed on the content digest.
func (h *Handler) documentPhoto(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	docID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return
	}
	if _, err := h.auth.OwnsDocument(r.Context(), userID, docID); err != nil {
		h.fail(w, r, err)
		return
	}
	page, err := strconv.Atoi(r.URL.Query().Get("page"))
	if err != nil || page < 1 {
		httpx.WriteError(w, http.StatusBadRequest, "page must be a positive integer", "bad_request")
		return
	}

	doc, photo, err := h.svc.DocumentPhoto(r.Context(), userID, docID, page)
	if err != nil {
		if errors.Is(err, knowledge.ErrNotAPhoto) {
			httpx.WriteError(w, http.StatusNotFound, "this document has no photo for that page", "not_found")
			return
		}
		h.fail(w, r, err)
		return
	}
	etag := fmt.Sprintf(`"%s-%d"`, doc.SHA256, page)
	if match := r.Header.Get("If-None-Match"); match != "" && match == etag {
		w.Header().Set("ETag", etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", photo.MIME)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("ETag", etag)
	http.ServeContent(w, r, "", doc.UpdatedAt, bytes.NewReader(photo.Data))
}
