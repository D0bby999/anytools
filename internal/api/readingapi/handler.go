// Package readingapi is the immersive reading surface's HTTP layer: per
// document workspaces, highlights, the original file the viewer renders, the
// four selection actions, and capturing an answer into the notebook.
//
// Identity comes from httpx.MustUserID(ctx) and nowhere else. Every route with
// an id authorizes FIRST — the workspace by its owner filter, the document
// through the Authorizer — and answers 404 for both "not yours" and "no such
// thing", because any endpoint that can tell them apart is an existence oracle
// for another account's library.
package readingapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/capabilities/reading"
	"github.com/D0bby999/anytools/internal/capabilities/visualize"
	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/notebook"
	"github.com/D0bby999/anytools/internal/runtime"
)

// DocumentAuthorizer answers "does this user own this document".
//
// It returns the containing knowledge base id, which this package does not use
// — the signature is authz.Authorizer's, matched exactly so the wiring passes
// the real thing rather than an adapter that could drift from it.
type DocumentAuthorizer interface {
	OwnsDocument(ctx context.Context, userID, docID uuid.UUID) (uuid.UUID, error)
}

// DocumentReader reads a document row. knowledge.Service implements it.
type DocumentReader interface {
	GetDocument(ctx context.Context, userID, docID uuid.UUID) (*knowledge.Document, error)
}

// SessionStore is the slice of chat persistence a reading turn needs.
// pg.ChatStore implements it.
type SessionStore interface {
	CreateSession(ctx context.Context, s runtime.Session) (*runtime.Session, error)
	GetSession(ctx context.Context, userID, sessionID uuid.UUID) (*runtime.Session, error)
	AppendMessage(ctx context.Context, m runtime.ChatMessage) (*runtime.ChatMessage, error)
	ListTurns(ctx context.Context, userID, sessionID uuid.UUID, limit int) ([]runtime.Turn, error)
	TouchSession(ctx context.Context, userID, sessionID uuid.UUID) error
}

// TranscriptReader reads a video's stored transcript. knowledge.Service
// implements it; nil turns the video tutor's window off (the tutor then says
// transcript grounding is unavailable).
type TranscriptReader interface {
	TranscriptCues(ctx context.Context, userID, docID uuid.UUID) (*youtube.Transcript, error)
}

// Deps are the collaborators the handler needs.
type Deps struct {
	Workspaces *reading.Workspaces
	Notes      *notebook.Service
	Authz      DocumentAuthorizer
	Documents  DocumentReader
	Blobs      blob.Store
	Sessions   SessionStore
	Orch       *runtime.Orchestrator
	// Diagrams draws a selected passage ("Draw it", learning-depth phase 5).
	Diagrams SelectionDrawer
	// Pages and Providers serve "Find words to save" (terms.go): the stored
	// page a selection is checked against, and the learner's `reading` route.
	Pages     PageTexts
	Providers runtime.ChatProviderResolver
	// Transcripts is optional (learning-depth phase 4).
	Transcripts TranscriptReader
}

// SelectionDrawer draws a passage into the workspace's session.
// visualize.Service implements it.
type SelectionDrawer interface {
	DrawSelection(ctx context.Context, userID, sessionID uuid.UUID, title, selection, request string) (*visualize.Result, error)
}

// Handler serves the reading routes.
type Handler struct{ d Deps }

// NewHandler returns a Handler.
func NewHandler(d Deps) *Handler { return &Handler{d: d} }

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/reading/workspaces", h.listWorkspaces)
	mux.HandleFunc("POST /v1/reading/workspaces", h.openWorkspace) // budget: none
	// `highlights` is registered above `{id}` for readability only; net/http's
	// mux picks the most specific pattern regardless of registration order.
	mux.HandleFunc("PATCH /v1/reading/highlights/{hid}", h.patchHighlight)   // budget: none
	mux.HandleFunc("DELETE /v1/reading/highlights/{hid}", h.deleteHighlight) // budget: none
	mux.HandleFunc("GET /v1/reading/{id}", h.getWorkspace)
	mux.HandleFunc("PATCH /v1/reading/{id}", h.patchWorkspace)   // budget: none
	mux.HandleFunc("DELETE /v1/reading/{id}", h.deleteWorkspace) // budget: none
	mux.HandleFunc("GET /v1/reading/{id}/file", h.file)
	mux.HandleFunc("GET /v1/reading/{id}/highlights", h.listHighlights)
	mux.HandleFunc("POST /v1/reading/{id}/highlights", h.createHighlight) // budget: none
	mux.HandleFunc("POST /v1/reading/{id}/actions", h.action)             // budget: generate
	mux.HandleFunc("POST /v1/reading/{id}/terms", h.terms)                // budget: generate
	mux.HandleFunc("POST /v1/reading/{id}/notes", h.capture)              // budget: none
	mux.HandleFunc("POST /v1/reading/{id}/diagram", h.diagram)            // budget: generate
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"GET /v1/reading/workspaces",
		"POST /v1/reading/workspaces",
		"PATCH /v1/reading/highlights/{hid}",
		"DELETE /v1/reading/highlights/{hid}",
		"GET /v1/reading/{id}",
		"PATCH /v1/reading/{id}",
		"DELETE /v1/reading/{id}",
		"GET /v1/reading/{id}/file",
		"GET /v1/reading/{id}/highlights",
		"POST /v1/reading/{id}/highlights",
		"POST /v1/reading/{id}/actions",
		"POST /v1/reading/{id}/terms",
		"POST /v1/reading/{id}/notes",
		"POST /v1/reading/{id}/diagram",
	}
}

// ─────────────────────────────────────────────────────────────── workspaces

type openRequest struct {
	DocumentID string `json:"document_id"`
}

// openWorkspace returns the workspace for a document, creating it on first read.
//
// POST rather than GET because it may create a row, and 200 rather than 201
// because the caller neither knows nor cares which of the two happened — the
// viewer asks "where was I in this document" and gets an answer.
func (h *Handler) openWorkspace(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req openRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	docID, err := uuid.Parse(strings.TrimSpace(req.DocumentID))
	if err != nil || docID == uuid.Nil {
		// Same answer as an unowned document, for the same reason.
		notFound(w)
		return
	}
	// Ownership BEFORE the upsert. A workspace created for a document the
	// caller does not own would be a row this user could then list, which is
	// the existence oracle written into the database.
	if _, err := h.d.Authz.OwnsDocument(r.Context(), userID, docID); err != nil {
		h.fail(w, r, err)
		return
	}
	ws, err := h.d.Workspaces.Open(r.Context(), userID, docID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, ws)
}

func (h *Handler) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	list, err := h.d.Workspaces.List(r.Context(), userID, limitParam(r, 50))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"workspaces": list})
}

func (h *Handler) getWorkspace(w http.ResponseWriter, r *http.Request) {
	_, ws, ok := h.requireWorkspace(w, r)
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, ws)
}

type progressRequest struct {
	Progress reading.Progress `json:"progress"`
}

func (h *Handler) patchWorkspace(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := h.requireWorkspace(w, r)
	if !ok {
		return
	}
	var req progressRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	updated, err := h.d.Workspaces.SaveProgress(r.Context(), userID, ws.ID, req.Progress)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, updated)
}

func (h *Handler) deleteWorkspace(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := h.requireWorkspace(w, r)
	if !ok {
		return
	}
	if err := h.d.Workspaces.Delete(r.Context(), userID, ws.ID); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─────────────────────────────────────────────────────────────── internals

// requireWorkspace reads the caller, the `{id}` path value and the workspace.
//
// The store's query filters on user_id, so a workspace belonging to someone
// else comes back as ErrNotFound and is answered 404 — the ownership check and
// the read are one statement, which is what stops them from drifting apart.
func (h *Handler) requireWorkspace(w http.ResponseWriter, r *http.Request) (uuid.UUID, *reading.Workspace, bool) {
	userID := httpx.MustUserID(r.Context())
	id, err := uuid.Parse(strings.TrimSpace(r.PathValue("id")))
	if err != nil || id == uuid.Nil {
		notFound(w)
		return uuid.Nil, nil, false
	}
	ws, err := h.d.Workspaces.Get(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return uuid.Nil, nil, false
	}
	return userID, ws, true
}

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
}

func badRequest(w http.ResponseWriter, msg string) {
	httpx.WriteError(w, http.StatusBadRequest, msg, "bad_request")
}

func limitParam(r *http.Request, def int) int {
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

// fail maps an error to a response. Only the sentences written for people —
// reading.ErrInvalid and notebook.ErrInvalid — reach the client; everything
// else is logged with its path and answered with one word, because a database
// error string travels through the BFF straight into a browser.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	if httpx.WriteStorageError(w, err) {
		// A file in the learner's Drive that it cannot give or take now
		// (drive-user-storage phase 3).
		return
	}
	switch {
	case errors.Is(err, reading.ErrNotFound),
		errors.Is(err, notebook.ErrNotFound),
		errors.Is(err, authz.ErrNoAccess),
		errors.Is(err, knowledge.ErrNoParsedContent),
		errors.Is(err, blob.ErrNotFound):
		notFound(w)
	case errors.Is(err, reading.ErrNoText):
		httpx.WriteError(w, http.StatusConflict, "this document has not been parsed yet", "not_ready")
	case errors.Is(err, reading.ErrInvalid):
		badRequest(w, strings.TrimPrefix(err.Error(), "reading: invalid: "))
	case errors.Is(err, notebook.ErrInvalid):
		badRequest(w, strings.TrimPrefix(err.Error(), "notebook: invalid: "))
	default:
		slog.Error("readingapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
