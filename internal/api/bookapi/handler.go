// Package bookapi is the living book over HTTP (learning-depth phase 11).
//
// The caller's identity comes from httpx.MustUserID and nowhere else; every
// id in a request — path, body or the anchors inside an outline — is
// resolved with it by the service, and a foreign id answers exactly like a
// missing one. A nested route checks that its inner id belongs to its outer
// one: a chapter to its book, a block to its book.
package bookapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/storageapi"
	"github.com/D0bby999/anytools/internal/capabilities/book"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Handler serves the living book routes.
type Handler struct {
	svc *book.Service
	// drive saves exports to the learner's Drive; nil without Drive.
	drive *storageapi.Exports
}

// NewHandler builds the handler.
func NewHandler(svc *book.Service) *Handler { return &Handler{svc: svc} }

// WithDriveExport enables "Save to my Drive" (drive-user-storage phase 2).
func (h *Handler) WithDriveExport(e *storageapi.Exports) *Handler {
	h.drive = e
	return h
}

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/books", h.create) // budget: generate
	mux.HandleFunc("GET /v1/books", h.list)
	mux.HandleFunc("GET /v1/books/{id}", h.get)
	mux.HandleFunc("PUT /v1/books/{id}/proposal", h.proposal) // budget: none
	// Confirming creates the chapters and compiles none of them.
	mux.HandleFunc("POST /v1/books/{id}/confirm", h.confirm)    // budget: none
	mux.HandleFunc("POST /v1/books/{id}/compile", h.compileAll) // budget: generate
	mux.HandleFunc("POST /v1/books/{id}/cancel", h.cancel)      // budget: none
	mux.HandleFunc("GET /v1/books/{id}/chapters/{cid}", h.chapter)
	mux.HandleFunc("POST /v1/books/{id}/chapters/{cid}/compile", h.compileChapter) // budget: generate
	mux.HandleFunc("POST /v1/books/{id}/chapters/{cid}/notes", h.note)             // budget: none
	mux.HandleFunc("POST /v1/books/{id}/blocks/{bid}/regenerate", h.regenerate)    // budget: generate
	mux.HandleFunc("PUT /v1/books/{id}/blocks/{bid}/review", h.review)             // budget: none
	mux.HandleFunc("GET /v1/books/{id}/export", h.export)
	if h.drive != nil {
		mux.HandleFunc("POST /v1/books/{id}/export/drive", h.exportToDrive) // budget: upload
	}
	mux.HandleFunc("DELETE /v1/books/{id}", h.delete) // budget: none
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"POST /v1/books",
		"GET /v1/books",
		"GET /v1/books/{id}",
		"PUT /v1/books/{id}/proposal",
		"POST /v1/books/{id}/confirm",
		"POST /v1/books/{id}/compile",
		"POST /v1/books/{id}/cancel",
		"GET /v1/books/{id}/chapters/{cid}",
		"POST /v1/books/{id}/chapters/{cid}/compile",
		"POST /v1/books/{id}/chapters/{cid}/notes",
		"POST /v1/books/{id}/blocks/{bid}/regenerate",
		"PUT /v1/books/{id}/blocks/{bid}/review",
		"GET /v1/books/{id}/export",
		"POST /v1/books/{id}/export/drive",
		"DELETE /v1/books/{id}",
	}
}

type createRequest struct {
	KBID     string `json:"kb_id"`
	Goal     string `json:"goal"`
	Chapters int    `json:"chapters"`
}

// create proposes a book. One model call (at most one repair), in the
// request; the answer is the outline to edit and confirm.
func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	kbID, err := uuid.Parse(strings.TrimSpace(req.KBID))
	if err != nil {
		notFound(w)
		return
	}
	b, err := h.svc.Create(r.Context(), httpx.MustUserID(r.Context()), book.CreateRequest{
		KBID: kbID, Goal: req.Goal, Chapters: req.Chapters,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, b)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	var kbID *uuid.UUID
	if v := strings.TrimSpace(r.URL.Query().Get("kb_id")); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			notFound(w)
			return
		}
		kbID = &id
	}
	list, err := h.svc.List(r.Context(), httpx.MustUserID(r.Context()), kbID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"books": list})
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	b, err := h.svc.Get(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, b)
}

// chapterRequest is one chapter of an edited outline. Anchors are chunk ids:
// each must be one of the outline's passages and the caller's chunk in the
// book's knowledge base, checked on save, on confirmation and on every
// compile.
type chapterRequest struct {
	Title      string      `json:"title"`
	Objectives []string    `json:"objectives"`
	Prereqs    []int       `json:"prereqs"`
	Anchors    []uuid.UUID `json:"anchors"`
}

type proposalRequest struct {
	Title    string           `json:"title"`
	Audience string           `json:"audience"`
	Chapters []chapterRequest `json:"chapters"`
}

func (h *Handler) proposal(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var req proposalRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	edit := book.EditRequest{Title: req.Title, Audience: req.Audience}
	for _, c := range req.Chapters {
		edit.Chapters = append(edit.Chapters, book.ProposedChapter{
			Title: c.Title, Objectives: c.Objectives, Prereqs: c.Prereqs, Anchors: c.Anchors,
		})
	}
	b, err := h.svc.UpdateProposal(r.Context(), httpx.MustUserID(r.Context()), id, edit)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, b)
}

func (h *Handler) confirm(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	b, err := h.svc.Confirm(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, b)
}

func (h *Handler) compileAll(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	b, err := h.svc.CompileAll(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, b)
}

func (h *Handler) cancel(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := h.svc.Cancel(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) chapter(w http.ResponseWriter, r *http.Request) {
	id, cid, ok := pathIDs(w, r, "cid")
	if !ok {
		return
	}
	view, err := h.svc.Chapter(r.Context(), httpx.MustUserID(r.Context()), id, cid)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, view)
}

func (h *Handler) compileChapter(w http.ResponseWriter, r *http.Request) {
	id, cid, ok := pathIDs(w, r, "cid")
	if !ok {
		return
	}
	b, err := h.svc.CompileChapter(r.Context(), httpx.MustUserID(r.Context()), id, cid)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, b)
}

type noteRequest struct {
	Markdown string `json:"markdown"`
}

func (h *Handler) note(w http.ResponseWriter, r *http.Request) {
	id, cid, ok := pathIDs(w, r, "cid")
	if !ok {
		return
	}
	var req noteRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	blk, err := h.svc.AddNote(r.Context(), httpx.MustUserID(r.Context()), id, cid, req.Markdown)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, blk)
}

func (h *Handler) regenerate(w http.ResponseWriter, r *http.Request) {
	id, bid, ok := pathIDs(w, r, "bid")
	if !ok {
		return
	}
	blk, err := h.svc.Regenerate(r.Context(), httpx.MustUserID(r.Context()), id, bid)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, blk)
}

type reviewRequest struct {
	On *bool `json:"on"`
}

// review puts a flash-card block's cards in or out of the Book cards queue.
func (h *Handler) review(w http.ResponseWriter, r *http.Request) {
	id, bid, ok := pathIDs(w, r, "bid")
	if !ok {
		return
	}
	var req reviewRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil || req.On == nil {
		badRequest(w, "say whether the cards are in review: {\"on\": true}")
		return
	}
	if err := h.svc.SetInReview(r.Context(), httpx.MustUserID(r.Context()), id, bid, *req.On); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) export(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	md, name, err := h.svc.Export(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(name, `"`, "")+`"`)
	_, _ = w.Write([]byte(md))
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func pathID(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue(name))
	if err != nil {
		notFound(w)
		return uuid.Nil, false
	}
	return id, true
}

// pathIDs reads the book and the nested id. Either malformed is the same 404
// as another user's.
func pathIDs(w http.ResponseWriter, r *http.Request, inner string) (uuid.UUID, uuid.UUID, bool) {
	id, err1 := uuid.Parse(r.PathValue("id"))
	sub, err2 := uuid.Parse(r.PathValue(inner))
	if err1 != nil || err2 != nil {
		notFound(w)
		return uuid.Nil, uuid.Nil, false
	}
	return id, sub, true
}

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
}

func badRequest(w http.ResponseWriter, msg string) {
	httpx.WriteError(w, http.StatusBadRequest, msg, "bad_request")
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, book.ErrNotFound):
		notFound(w)
	case errors.Is(err, book.ErrBadRequest):
		badRequest(w, strings.TrimPrefix(err.Error(), book.ErrBadRequest.Error()+": "))
	case errors.Is(err, book.ErrNotConfirmed):
		httpx.WriteError(w, http.StatusConflict, "confirm the outline before anything is written", "not_confirmed")
	case errors.Is(err, book.ErrNotEditable):
		httpx.WriteError(w, http.StatusConflict, "the outline is confirmed and can no longer be edited", "not_editable")
	case errors.Is(err, book.ErrBusy):
		httpx.WriteError(w, http.StatusConflict, "this book is being written — wait for it, or cancel", "busy")
	case errors.Is(err, book.ErrNothingToCompile):
		httpx.WriteError(w, http.StatusConflict, "every chapter is already written", "nothing_to_compile")
	case errors.Is(err, book.ErrThinMaterial):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "not enough material for this chapter", "thin_material")
	case errors.Is(err, book.ErrThinKB):
		httpx.WriteError(w, http.StatusUnprocessableEntity,
			"this knowledge base has too little text for a book yet — add or finish indexing documents", "thin_material")
	case errors.Is(err, book.ErrInvalidOutput):
		httpx.WriteError(w, http.StatusUnprocessableEntity,
			"the model's answer broke a rule ("+strings.TrimPrefix(err.Error(), book.ErrInvalidOutput.Error()+": ")+") — try again",
			"invalid_output")
	case errors.Is(err, runtime.ErrNoProvider):
		httpx.WriteError(w, http.StatusConflict, "no model is configured for this — add one in Settings", "no_provider")
	case errors.Is(err, runtime.ErrProvider):
		httpx.WriteError(w, http.StatusBadGateway, "your model could not be reached", "provider_failed")
	default:
		slog.Error("bookapi: request failed", "path", r.URL.Path, "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
