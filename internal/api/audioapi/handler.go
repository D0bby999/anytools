// Package audioapi is the audio overview over HTTP (learning-depth phase 10).
//
// The caller's identity comes from httpx.MustUserID and nowhere else; every
// id in a request is resolved with it by the service, and a foreign id
// answers exactly like a missing one.
package audioapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/audio"
)

// Handler serves the audio overview routes.
type Handler struct{ svc *audio.Service }

// NewHandler builds the handler.
func NewHandler(svc *audio.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/audio-overviews", h.create) // budget: generate
	mux.HandleFunc("GET /v1/audio-overviews", h.list)
	mux.HandleFunc("GET /v1/audio-overviews/{id}", h.get)
	mux.HandleFunc("GET /v1/audio-overviews/{id}/audio", h.audio)
	mux.HandleFunc("POST /v1/audio-overviews/{id}/speak", h.speak)   // budget: generate
	mux.HandleFunc("POST /v1/audio-overviews/{id}/cancel", h.cancel) // budget: none
	mux.HandleFunc("DELETE /v1/audio-overviews/{id}", h.delete)      // budget: none
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"POST /v1/audio-overviews",
		"GET /v1/audio-overviews",
		"GET /v1/audio-overviews/{id}",
		"GET /v1/audio-overviews/{id}/audio",
		"POST /v1/audio-overviews/{id}/speak",
		"POST /v1/audio-overviews/{id}/cancel",
		"DELETE /v1/audio-overviews/{id}",
	}
}

type createRequest struct {
	KBID     string `json:"kb_id"`
	ReportID string `json:"report_id"`
	Minutes  int    `json:"minutes"`
	Language string `json:"language"`
	Topic    string `json:"topic"`
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	in := audio.Request{Minutes: req.Minutes, Language: req.Language, Topic: req.Topic}
	for raw, dst := range map[string]**uuid.UUID{req.KBID: &in.KBID, req.ReportID: &in.ReportID} {
		if raw = strings.TrimSpace(raw); raw == "" {
			continue
		}
		id, err := uuid.Parse(raw)
		if err != nil {
			notFound(w)
			return
		}
		*dst = &id
	}
	o, err := h.svc.Create(r.Context(), httpx.MustUserID(r.Context()), in)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, o)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	var kbID, reportID *uuid.UUID
	for name, dst := range map[string]**uuid.UUID{"kb_id": &kbID, "report_id": &reportID} {
		if v := strings.TrimSpace(r.URL.Query().Get(name)); v != "" {
			id, err := uuid.Parse(v)
			if err != nil {
				notFound(w)
				return
			}
			*dst = &id
		}
	}
	list, err := h.svc.List(r.Context(), httpx.MustUserID(r.Context()), kbID, reportID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"overviews": list})
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	o, err := h.svc.Get(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, o)
}

// audio streams the finished WAV with range support (http.ServeContent), so
// the browser's player can seek without downloading the whole file.
func (h *Handler) audio(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	f, err := h.svc.OpenAudio(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeContent(w, r, "overview.wav", f.ModTime, f)
}

type speakRequest struct {
	// Engine is "builtin" or "byok"; ConnectionID names the byok connection.
	Engine       string `json:"engine"`
	ConnectionID string `json:"connection_id"`
}

// speak starts the second step: the finished script, spoken on the engine the
// learner chose (up-methods phase 22).
func (h *Handler) speak(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	user := httpx.MustUserID(r.Context())
	var req speakRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		// Ownership first: another user's overview answers 404 whatever the
		// body says, exactly like a missing one.
		if _, err := h.svc.Get(r.Context(), user, id); err != nil {
			h.fail(w, r, err)
			return
		}
		httpx.WriteError(w, http.StatusBadRequest, "choose who speaks it: builtin, or byok with a connection_id", "bad_request")
		return
	}
	choice := audio.EngineChoice{Engine: strings.TrimSpace(req.Engine)}
	if raw := strings.TrimSpace(req.ConnectionID); raw != "" {
		cid, err := uuid.Parse(raw)
		if err != nil {
			notFound(w)
			return
		}
		choice.ConnectionID = cid
	}
	o, err := h.svc.Speak(r.Context(), user, id, choice)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, o)
}

func (h *Handler) cancel(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Cancel(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func pathID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		notFound(w)
		return uuid.Nil, false
	}
	return id, true
}

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	if httpx.WriteStorageError(w, err) {
		// A file in the learner's Drive that it cannot give or take now
		// (drive-user-storage phase 3).
		return
	}
	switch {
	case errors.Is(err, audio.ErrNotFound):
		notFound(w)
	case errors.Is(err, audio.ErrNoSpeech):
		httpx.WriteError(w, http.StatusConflict,
			"that speech key is no longer on your Speech route in Settings → Routes", "no_provider")
	case errors.Is(err, audio.ErrNoVoice):
		httpx.WriteError(w, http.StatusConflict,
			"that engine has no voices for this script's language; choose another, or read it in the browser", "no_voice")
	case errors.Is(err, audio.ErrSpeechQuota):
		httpx.WriteError(w, http.StatusConflict, strings.TrimPrefix(err.Error(), audio.ErrSpeechQuota.Error()+": "), "tts_quota")
	case errors.Is(err, audio.ErrBuiltinUnavailable):
		httpx.WriteError(w, http.StatusConflict, "the built-in voices are not available on this server right now", "builtin_unavailable")
	case errors.Is(err, audio.ErrNotSpeakable):
		httpx.WriteError(w, http.StatusConflict, "this overview has no finished script to speak", "not_speakable")
	case errors.Is(err, audio.ErrBadRequest):
		httpx.WriteError(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), "audio: bad request: "), "bad_request")
	default:
		slog.Error("audioapi: request failed", "path", r.URL.Path, "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
