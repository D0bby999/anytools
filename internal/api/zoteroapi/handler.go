// Package zoteroapi is a knowledge base's "Add from Zotero" over HTTP
// (up-methods phase 20). The caller's identity comes from httpx.MustUserID;
// the knowledge base is resolved with it before the learner's key is read
// or Zotero is called, and another user's answers exactly like a missing
// one.
package zoteroapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/zoterolib"
	"github.com/D0bby999/anytools/internal/connectors/zotero"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// Handler serves the Zotero routes.
type Handler struct{ svc *zoterolib.Service }

// NewHandler builds the handler.
func NewHandler(svc *zoterolib.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/kb/{id}/zotero/search", h.search)           // budget: search
	mux.HandleFunc("GET /v1/kb/{id}/zotero/collections", h.collections) // budget: search
	mux.HandleFunc("POST /v1/kb/{id}/zotero/items", h.add)              // budget: upload
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"GET /v1/kb/{id}/zotero/search",
		"GET /v1/kb/{id}/zotero/collections",
		"POST /v1/kb/{id}/zotero/items",
	}
}

func kbID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) search(w http.ResponseWriter, r *http.Request) {
	id, ok := kbID(w, r)
	if !ok {
		return
	}
	items, err := h.svc.Search(r.Context(), httpx.MustUserID(r.Context()), id, r.URL.Query().Get("q"))
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) collections(w http.ResponseWriter, r *http.Request) {
	id, ok := kbID(w, r)
	if !ok {
		return
	}
	cols, items, err := h.svc.Browse(r.Context(), httpx.MustUserID(r.Context()), id,
		strings.TrimSpace(r.URL.Query().Get("collection")))
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"collections": cols, "items": items})
}

type addRequest struct {
	// ItemKey names the item in the learner's library; the server reads
	// everything else from Zotero itself.
	ItemKey string `json:"item_key"`
}

func (h *Handler) add(w http.ResponseWriter, r *http.Request) {
	id, ok := kbID(w, r)
	if !ok {
		return
	}
	var req addRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	added, err := h.svc.Add(r.Context(), httpx.MustUserID(r.Context()), id, strings.TrimSpace(req.ItemKey))
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, added)
}

func fail(w http.ResponseWriter, r *http.Request, err error) {
	var zerr *zotero.Error
	switch {
	case errors.Is(err, zoterolib.ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
	case errors.Is(err, zoterolib.ErrNotConnected):
		httpx.WriteError(w, http.StatusConflict, "add a Zotero key in Settings → Search keys first", "zotero_not_connected")
	case errors.Is(err, zoterolib.ErrAlreadyAdded):
		httpx.WriteError(w, http.StatusConflict, "this item is already in the knowledge base", "already_added")
	case errors.Is(err, zoterolib.ErrBadKey):
		httpx.WriteError(w, http.StatusBadRequest, "that is not a Zotero key", "bad_request")
	case errors.Is(err, parse.ErrPageCapExceeded):
		httpx.WriteError(w, http.StatusRequestEntityTooLarge, "this item's PDF has more pages than a document may have", "page_cap")
	case errors.As(err, &zerr):
		// A fixed sentence written for the learner; it never carries the key.
		switch zerr.Code {
		case zotero.CodeRateLimited:
			httpx.WriteError(w, http.StatusTooManyRequests, zerr.Msg, "zotero_rate_limited")
		case zotero.CodeBadKey:
			httpx.WriteError(w, http.StatusConflict, zerr.Msg, "zotero_key")
		case zotero.CodeNotFound:
			httpx.WriteError(w, http.StatusNotFound, zerr.Msg, "zotero_not_found")
		default:
			httpx.WriteError(w, http.StatusBadGateway, zerr.Msg, "zotero_unavailable")
		}
	default:
		slog.Error("zoteroapi: request failed", "path", r.URL.Path, "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
