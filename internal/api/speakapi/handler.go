// Package speakapi is the read-aloud check's HTTP surface (the private design notes, phase 2): one multipart POST with the passage and the
// take, answered with the word-by-word comparison. Nothing is stored.
package speakapi

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/capabilities/speakcheck"
	"github.com/D0bby999/anytools/internal/vocab"
)

// Handler serves the check.
type Handler struct{ svc *speakcheck.Service }

// NewHandler builds the Handler.
func NewHandler(svc *speakcheck.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/speaking/check", h.check)     // budget: upload
	mux.HandleFunc("POST /v1/speaking/dictate", h.dictate) // budget: upload
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string { return []string{"POST /v1/speaking/check", "POST /v1/speaking/dictate"} }

// maxRequest is the take and the small fields beside it.
const maxRequest = speakcheck.MaxBytes + 64<<10

func (h *Handler) check(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, maxRequest)
	mr, err := r.MultipartReader()
	if err != nil {
		badRequest(w, "send the take as a multipart form with an audio part")
		return
	}
	var in speakcheck.Input
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			badRequest(w, "malformed multipart body")
			return
		}
		limit := int64(speakcheck.MaxTextLen * 4)
		if part.FormName() == "audio" {
			limit = speakcheck.MaxBytes
		}
		data, over, err := blob.ReadAllLimited(part, limit)
		if over {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge,
				"a take is at most "+strconv.Itoa(speakcheck.MaxSeconds)+" seconds", "too_large")
			return
		}
		if err != nil {
			badRequest(w, "malformed multipart body")
			return
		}
		switch part.FormName() {
		case "audio":
			in.Take = data
		case "workspace_id":
			id, err := uuid.Parse(strings.TrimSpace(string(data)))
			if err != nil {
				httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
				return
			}
			in.WorkspaceID = id
		case "page":
			n, err := strconv.Atoi(strings.TrimSpace(string(data)))
			if err != nil || n < 0 {
				badRequest(w, "page is a page number")
				return
			}
			in.Page = n
		case "text":
			in.Text = string(data)
		}
	}
	res, err := h.svc.Check(r.Context(), userID, in)
	if err != nil {
		fail(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, res)
}

// dictate hears a question spoken into the chat composer, where the browser
// has no speech recognition of its own: a multipart body with an audio part
// and an optional lang ("vi"). It answers the text; nothing is kept.
func (h *Handler) dictate(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, maxRequest)
	mr, err := r.MultipartReader()
	if err != nil {
		badRequest(w, "send the take as a multipart form with an audio part")
		return
	}
	var take []byte
	lang := ""
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			badRequest(w, "malformed multipart body")
			return
		}
		limit := int64(16)
		if part.FormName() == "audio" {
			limit = speakcheck.MaxBytes
		}
		data, over, err := blob.ReadAllLimited(part, limit)
		if over {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge,
				"a take is at most "+strconv.Itoa(speakcheck.MaxSeconds)+" seconds", "too_large")
			return
		}
		if err != nil {
			badRequest(w, "malformed multipart body")
			return
		}
		switch part.FormName() {
		case "audio":
			take = data
		case "lang":
			lang = strings.ToLower(strings.TrimSpace(string(data)))
			if !langCode(lang) {
				badRequest(w, "lang is a language code")
				return
			}
		}
	}
	res, err := h.svc.Dictate(r.Context(), userID, take, lang)
	if err != nil {
		fail(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, res)
}

// langCode accepts "" or two or three lowercase letters.
func langCode(s string) bool {
	if s == "" {
		return true
	}
	if len(s) < 2 || len(s) > 3 {
		return false
	}
	for _, r := range s {
		if r < 'a' || r > 'z' {
			return false
		}
	}
	return true
}

func badRequest(w http.ResponseWriter, msg string) {
	httpx.WriteError(w, http.StatusBadRequest, msg, "bad_request")
}

// fail maps the check's errors. A sentence of the service's own reaches the
// client; anything else is logged and answered with one word.
func fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, speakcheck.ErrInvalid):
		badRequest(w, strings.TrimPrefix(err.Error(), speakcheck.ErrInvalid.Error()+": "))
	case errors.Is(err, vocab.ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
	case errors.Is(err, vocab.ErrNoText):
		httpx.WriteError(w, http.StatusConflict, "this document has not been parsed yet", "not_ready")
	case errors.Is(err, speakcheck.ErrUnreadable):
		badRequest(w, "the recording could not be read")
	case errors.Is(err, speakcheck.ErrNoEngine):
		httpx.WriteError(w, http.StatusConflict,
			"set up speech-to-text first: add a connection to the stt route in Settings", "no_stt")
	case errors.Is(err, speakcheck.ErrQuota):
		httpx.WriteError(w, http.StatusTooManyRequests,
			"today's free transcription minutes are used up; try again tomorrow, or add your own speech-to-text key", "stt_quota")
	case errors.Is(err, speakcheck.ErrBusy):
		httpx.WriteError(w, http.StatusServiceUnavailable,
			"the server's speech engine did not answer; try again in a minute", "stt_busy")
	case errors.Is(err, speakcheck.ErrEngine):
		httpx.WriteError(w, http.StatusBadGateway, "your speech-to-text connection could not be reached", "stt_failed")
	default:
		slog.Error("speakcheck: check failed", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
