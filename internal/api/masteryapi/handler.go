// Package masteryapi is the mastery path's HTTP surface.
//
// Same rule as everywhere else: the caller's identity comes from
// httpx.MustUserID(ctx), never from the request, and every path id is handed to
// a service that filters on the authenticated user in SQL.
package masteryapi

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/mastery"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Handler serves the mastery routes.
type Handler struct {
	svc *mastery.Service
}

// NewHandler builds the handler.
func NewHandler(svc *mastery.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/mastery/due", h.due)
	mux.HandleFunc("GET /v1/mastery/paths", h.listPaths)
	mux.HandleFunc("POST /v1/mastery/paths", h.createPath) // budget: generate
	mux.HandleFunc("GET /v1/mastery/paths/{id}", h.getPath)
	mux.HandleFunc("DELETE /v1/mastery/paths/{id}", h.archivePath)         // budget: none
	mux.HandleFunc("PATCH /v1/mastery/paths/{id}", h.patchPath)            // budget: none
	mux.HandleFunc("POST /v1/mastery/paths/{id}/propose", h.propose)       // budget: generate
	mux.HandleFunc("POST /v1/mastery/paths/{id}/approve", h.approve)       // budget: none
	mux.HandleFunc("POST /v1/mastery/paths/{id}/diagnostic", h.diagnostic) // budget: generate
	mux.HandleFunc("GET /v1/mastery/paths/{id}/next", h.next)              // budget: generate
	mux.HandleFunc("GET /v1/mastery/paths/{id}/errors", h.openErrors)
	mux.HandleFunc("GET /v1/mastery/review/next", h.reviewNext)                      // budget: generate
	mux.HandleFunc("POST /v1/mastery/points/{id}/learn", h.learn)                    // budget: generate
	mux.HandleFunc("POST /v1/mastery/points/{id}/explain-back", h.explainBack)       // budget: generate
	mux.HandleFunc("POST /v1/mastery/explain-back/{id}/override", h.overrideExplain) // budget: none
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"GET /v1/mastery/due",
		"GET /v1/mastery/paths",
		"POST /v1/mastery/paths",
		"GET /v1/mastery/paths/{id}",
		"DELETE /v1/mastery/paths/{id}",
		"PATCH /v1/mastery/paths/{id}",
		"POST /v1/mastery/paths/{id}/propose",
		"POST /v1/mastery/paths/{id}/approve",
		"POST /v1/mastery/paths/{id}/diagnostic",
		"GET /v1/mastery/paths/{id}/next",
		"GET /v1/mastery/paths/{id}/errors",
		"GET /v1/mastery/review/next",
		"POST /v1/mastery/points/{id}/learn",
		"POST /v1/mastery/points/{id}/explain-back",
		"POST /v1/mastery/explain-back/{id}/override",
	}
}

// due is the live queue, computed on read. It is what the Due widget and the
// session queue both call, and it is the reason there is no nightly
// materializer (red-team RT-12).
func (h *Handler) due(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	items, err := h.svc.Due(r.Context(), userID, limitParam(r, 50))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	// A status surface: a cached copy showing three cards due after they have
	// been answered is worse than a round trip.
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"due": items, "count": len(items)})
}

func (h *Handler) listPaths(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	paths, err := h.svc.Paths(r.Context(), userID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"paths": paths})
}

func (h *Handler) createPath(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req mastery.CreateRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	result, err := h.svc.Create(r.Context(), userID, req)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, result)
}

func (h *Handler) getPath(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	detail, err := h.svc.Detail(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, detail)
}

func (h *Handler) archivePath(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := h.svc.Archive(r.Context(), userID, id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type patchPathRequest struct {
	// ExplainLang: "" the learner's language, "source", or a code.
	ExplainLang *string `json:"explain_lang"`
}

// patchPath changes what a path is explained in (the private design notes, phase 4). It is the only field a path's PATCH takes.
func (h *Handler) patchPath(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var req patchPathRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil || req.ExplainLang == nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	path, err := h.svc.SetExplainLang(r.Context(), userID, id, *req.ExplainLang)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, path)
}

func (h *Handler) propose(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	proposal, err := h.svc.Propose(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, proposal)
}

func (h *Handler) approve(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var req mastery.ApproveRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	detail, err := h.svc.Approve(r.Context(), userID, id, req)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, detail)
}

func (h *Handler) diagnostic(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	questions, err := h.svc.Diagnostic(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"questions": questions})
}

func (h *Handler) next(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	next, err := h.svc.Next(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, next)
}

// reviewNext is the cross-path review's next item. `after` is the point the
// client just showed; one that is malformed or not the caller's is ignored,
// never an error, so the answer cannot confirm that an id exists.
func (h *Handler) reviewNext(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var after *uuid.UUID
	if id, err := uuid.Parse(strings.TrimSpace(r.URL.Query().Get("after"))); err == nil && id != uuid.Nil {
		after = &id
	}
	next, err := h.svc.ReviewNext(r.Context(), userID, after)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, next)
}

func (h *Handler) openErrors(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	records, err := h.svc.OpenErrors(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"errors": records})
}

// learn returns a point's cached explanation, or writes it. The body is
// optional: an empty one asks for the plain explanation.
func (h *Handler) learn(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var req mastery.LearnRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil && !errors.Is(err, io.EOF) {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	explanation, err := h.svc.Learn(r.Context(), userID, id, req)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, explanation)
}

// explainBack judges the learner's own explanation of a point. A replayed
// request_id answers 200 with the stored verdict; a new one 201.
func (h *Handler) explainBack(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var req mastery.ExplainBackRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	result, err := h.svc.ExplainBack(r.Context(), userID, id, req)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	status := http.StatusCreated
	if result.Replayed {
		status = http.StatusOK
	}
	httpx.WriteJSON(w, status, result)
}

// overrideExplain records "I think this was judged wrongly". No body: the
// override is the opposite of the judge's verdict, once.
func (h *Handler) overrideExplain(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	result, err := h.svc.OverrideExplainBack(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}

// ── shared plumbing ───────────────────────────────────────────────────────

func pathID(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(strings.TrimSpace(r.PathValue(name)))
	if err != nil || id == uuid.Nil {
		notFound(w)
		return uuid.Nil, false
	}
	return id, true
}

func limitParam(r *http.Request, def int) int {
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, mastery.ErrNoAccess), errors.Is(err, mastery.ErrNotFound),
		errors.Is(err, quiz.ErrNoAccess), errors.Is(err, quiz.ErrNotFound):
		notFound(w)
	case errors.Is(err, mastery.ErrBadRequest):
		httpx.WriteError(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), "mastery: "), "bad_request")
	case errors.Is(err, mastery.ErrNotApproved):
		httpx.WriteError(w, http.StatusConflict,
			"approve this path's modules before studying it", "not_approved")
	case errors.Is(err, mastery.ErrNothingDue):
		// 200 with an empty body would make "you are up to date" look like a
		// question the client failed to render. 409 with a code the UI can
		// match says it plainly.
		httpx.WriteError(w, http.StatusConflict,
			"nothing is waiting for review right now", "nothing_due")
	case errors.Is(err, runtime.ErrNoProvider):
		httpx.WriteError(w, http.StatusConflict,
			"no model is configured for mastery paths — add one in Settings", "no_provider")
	case errors.Is(err, mastery.ErrNoMaterial):
		httpx.WriteError(w, http.StatusConflict,
			"your documents do not cover this knowledge point", "no_material")
	case errors.Is(err, mastery.ErrStillJudging):
		httpx.WriteError(w, http.StatusConflict,
			"this explanation is still being judged — wait a moment", "still_judging")
	case errors.Is(err, mastery.ErrBadExplanation):
		httpx.WriteError(w, http.StatusBadGateway,
			"your model did not return a usable explanation — try again", "bad_model_output")
	case errors.Is(err, quiz.ErrNoQuestions):
		httpx.WriteError(w, http.StatusConflict,
			"these documents did not support a question for that knowledge point", "no_questions")
	case errors.Is(err, quiz.ErrBadModelOutput):
		httpx.WriteError(w, http.StatusBadGateway,
			"your model did not return a usable plan — try again", "bad_model_output")
	case errors.Is(err, runtime.ErrProvider):
		httpx.WriteError(w, http.StatusBadGateway, "your model could not be reached", "provider_failed")
	default:
		slog.Error("masteryapi: request failed", "path", r.URL.Path, "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
