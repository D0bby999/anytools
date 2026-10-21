// Package playlistapi is a YouTube playlist as a course
// (learning-tool-connections phase 7): list a playlist, then add the videos
// the learner keeps to a knowledge base, in the playlist's order, each the
// way a single video link is added.
package playlistapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"slices"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/connectors/youtube"
)

// Reader lists playlists.
type Reader interface {
	Read(ctx context.Context, raw string) (*youtube.Playlist, error)
}

// Links adds a video link to a knowledge base, after checking ownership.
type Links interface {
	OwnsKB(ctx context.Context, userID, kbID uuid.UUID) error
	AddLink(ctx context.Context, userID, kbID uuid.UUID, rawURL string) error
}

// Handler serves the routes.
type Handler struct {
	reader Reader
	links  Links
}

// NewHandler returns a Handler.
func NewHandler(reader Reader, links Links) *Handler { return &Handler{reader: reader, links: links} }

// RegisterRoutes attaches the routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/playlists/preview", h.preview) // budget: none
	mux.HandleFunc("POST /v1/kb/{id}/playlist", h.add)      // budget: upload
}

// Patterns lists what RegisterRoutes registers.
func Patterns() []string {
	return []string{"POST /v1/playlists/preview", "POST /v1/kb/{id}/playlist"}
}

func (h *Handler) preview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL string `json:"url"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	pl, err := h.reader.Read(r.Context(), body.URL)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, pl)
}

func (h *Handler) add(w http.ResponseWriter, r *http.Request) {
	user := httpx.MustUserID(r.Context())
	kbID, err := uuid.Parse(r.PathValue("id"))
	if err != nil || h.links.OwnsKB(r.Context(), user, kbID) != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return
	}
	var body struct {
		URL      string   `json:"url"`
		VideoIDs []string `json:"video_ids"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil || len(body.VideoIDs) == 0 || len(body.VideoIDs) > youtube.MaxPlaylist {
		httpx.WriteError(w, http.StatusBadRequest, "choose the videos to add", "bad_request")
		return
	}
	// The playlist is read again: the ids the browser sent are a choice
	// among its videos, not URLs to fetch.
	pl, err := h.reader.Read(r.Context(), body.URL)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	added, failed := 0, 0
	for _, v := range pl.Videos {
		if !slices.Contains(body.VideoIDs, v.ID) {
			continue
		}
		if err := h.links.AddLink(r.Context(), user, kbID, v.URL); err != nil {
			failed++
			continue
		}
		added++
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"kb_id": kbID, "added": added, "failed": failed, "title": pl.Title})
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, youtube.ErrNotAPlaylist):
		httpx.WriteError(w, http.StatusBadRequest, err.Error(), "not_a_playlist")
	case errors.Is(err, youtube.ErrPlaylistUnavailable):
		httpx.WriteError(w, http.StatusNotFound, err.Error(), "unavailable")
	default:
		slog.Warn("playlistapi: listing failed", "error", err)
		httpx.WriteError(w, http.StatusBadGateway, "YouTube could not be reached; try again", "youtube_failed")
	}
}
