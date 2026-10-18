// Package feedapi is podcast feeds and YouTube playlists and channels over
// HTTP (up-methods phase 17). A feed is added through "Add a link"
// (POST /v1/kb/{id}/links, kbapi); these routes read, check and pick from
// it. The caller's identity comes from httpx.MustUserID; a knowledge base is
// authorized before anything is read, and a feed is resolved with the
// caller's id, so another user's answers exactly like a missing one.
package feedapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/authz"
	feedconn "github.com/D0bby999/anytools/internal/connectors/feeds"
	"github.com/D0bby999/anytools/internal/knowledge"
)

// Handler serves the feed routes.
type Handler struct {
	svc  *knowledge.Service
	auth *authz.Authorizer
}

// NewHandler builds the handler.
func NewHandler(svc *knowledge.Service, auth *authz.Authorizer) *Handler {
	return &Handler{svc: svc, auth: auth}
}

// RegisterRoutes registers this package's patterns on the mux. Checking a
// feed fetches it (and may spend the learner's Data API quota); picking
// downloads episodes and may embed captions on the learner's key: both are
// the upload budget.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/kb/{id}/feeds", h.listFeeds)
	mux.HandleFunc("GET /v1/feeds/{id}", h.getFeed)
	mux.HandleFunc("POST /v1/feeds/{id}/check", h.checkFeed)    // budget: upload
	mux.HandleFunc("POST /v1/feeds/{id}/entries", h.addEntries) // budget: upload
	mux.HandleFunc("POST /v1/feeds/{id}/seen", h.markSeen)      // budget: none
	mux.HandleFunc("PATCH /v1/feeds/{id}", h.updateFeed)        // budget: none
	mux.HandleFunc("DELETE /v1/feeds/{id}", h.deleteFeed)       // budget: none
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"GET /v1/kb/{id}/feeds",
		"GET /v1/feeds/{id}",
		"POST /v1/feeds/{id}/check",
		"POST /v1/feeds/{id}/entries",
		"POST /v1/feeds/{id}/seen",
		"PATCH /v1/feeds/{id}",
		"DELETE /v1/feeds/{id}",
	}
}

func pathID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		// A malformed id answers like an unowned one.
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) listFeeds(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	kbID, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.auth.OwnsKB(r.Context(), userID, kbID); err != nil {
		fail(w, r, err)
		return
	}
	list, err := h.svc.ListFeeds(r.Context(), userID, kbID)
	if err != nil {
		fail(w, r, err)
		return
	}
	newEntries := 0
	for _, f := range list {
		newEntries += f.New
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"feeds": list, "new": newEntries, "limits": limits()})
}

func limits() map[string]int {
	return map[string]int{
		"max_feeds": knowledge.MaxFeedsPerKB, "max_pick": knowledge.MaxPickPerRequest,
		"auto_add_per_day": knowledge.MaxAutoAddPerDay, "youtube_feed_limit": feedconn.YouTubeFeedLimit,
		"data_api_limit": feedconn.MaxDataEntries,
	}
}

func (h *Handler) getFeed(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	feed, entries, err := h.svc.GetFeed(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"feed": feed, "entries": entries, "limits": limits()})
}

func (h *Handler) checkFeed(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	feed, n, err := h.svc.CheckFeed(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"feed": feed, "new": n})
}

type addEntriesRequest struct {
	// Entries are entry keys of the feed in the path. They are not resource
	// ids: each is resolved within that (owned) feed only.
	Entries []string `json:"entries"`
}

func (h *Handler) addEntries(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	userID := httpx.MustUserID(r.Context())
	// The feed before the body: a foreign feed answers 404 whatever is sent.
	if _, _, err := h.svc.GetFeed(r.Context(), userID, id); err != nil {
		fail(w, r, err)
		return
	}
	var req addEntriesRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	jobID, queued, err := h.svc.AddFeedEntries(r.Context(), userID, id, req.Entries)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"job_id": jobID, "queued": queued})
}

func (h *Handler) markSeen(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.MarkFeedSeen(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type updateFeedRequest struct {
	AutoAdd *bool `json:"auto_add"`
}

func (h *Handler) updateFeed(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	userID := httpx.MustUserID(r.Context())
	if _, _, err := h.svc.GetFeed(r.Context(), userID, id); err != nil {
		fail(w, r, err)
		return
	}
	var req updateFeedRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil || req.AutoAdd == nil {
		httpx.WriteError(w, http.StatusBadRequest, "auto_add is required", "bad_request")
		return
	}
	feed, err := h.svc.SetFeedAutoAdd(r.Context(), userID, id, *req.AutoAdd)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"feed": feed})
}

func (h *Handler) deleteFeed(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteFeed(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// fail maps an error to a response. authz.ErrNoAccess is a 404, never a
// 403: "not yours" and "does not exist" must answer alike.
func fail(w http.ResponseWriter, r *http.Request, err error) {
	var le *knowledge.LinkError
	switch {
	case errors.Is(err, authz.ErrNoAccess):
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
	case errors.As(err, &le):
		status := http.StatusUnprocessableEntity
		switch le.Code {
		case knowledge.LinkBadURL:
			status = http.StatusBadRequest
		case knowledge.LinkBusy:
			status = http.StatusConflict
		}
		httpx.WriteError(w, status, le.Msg, le.Code)
	case errors.Is(err, knowledge.ErrFeedsUnavailable):
		httpx.WriteError(w, http.StatusServiceUnavailable, "feeds are not available on this server", "unavailable")
	default:
		slog.Error("feedapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
