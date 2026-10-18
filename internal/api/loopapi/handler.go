// Package loopapi is the learning loop's HTTP surface.
//
// Same rule as everywhere else: the caller's identity comes from
// httpx.MustUserID(ctx), never from the request, and every id — in the path
// or the query — is handed to a service that filters on the authenticated user
// in SQL. Another user's id, a malformed id and a missing id are the same 404.
package loopapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/learning/loop"
)

// Handler serves the learning-loop routes.
type Handler struct{ svc *loop.Service }

// NewHandler builds the handler.
func NewHandler(svc *loop.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/learning/states", h.listStates)
	mux.HandleFunc("POST /v1/learning/states", h.startState) // budget: none
	mux.HandleFunc("GET /v1/learning/states/{id}", h.getState)
	mux.HandleFunc("PATCH /v1/learning/states/{id}", h.patchState)         // budget: none
	mux.HandleFunc("DELETE /v1/learning/states/{id}", h.deleteState)       // budget: none
	mux.HandleFunc("POST /v1/learning/states/{id}/interrupt", h.interrupt) // budget: none
	mux.HandleFunc("POST /v1/learning/states/{id}/cycles", h.newCycle)     // budget: none
	mux.HandleFunc("POST /v1/learning/states/{id}/resume", h.resume)       // budget: none
	mux.HandleFunc("POST /v1/learning/states/{id}/handover", h.handover)   // budget: none
	mux.HandleFunc("GET /v1/learning/states/{id}/chains", h.listChains)
	mux.HandleFunc("POST /v1/learning/states/{id}/chains", h.createChain) // budget: none
	mux.HandleFunc("GET /v1/learning/states/{id}/briefs", h.listBriefs)
	mux.HandleFunc("POST /v1/learning/states/{id}/briefs", h.createBrief) // budget: none
	mux.HandleFunc("GET /v1/cycles/{id}", h.getCycle)
	mux.HandleFunc("PATCH /v1/cycles/{id}", h.patchCycle)          // budget: none
	mux.HandleFunc("POST /v1/cycles/{id}/advance", h.advance)      // budget: none
	mux.HandleFunc("POST /v1/cycles/{id}/reviews", h.createReview) // budget: none
	mux.HandleFunc("GET /v1/weekly-reviews/{id}", h.getReview)
	mux.HandleFunc("PATCH /v1/weekly-reviews/{id}", h.patchReview)               // budget: none
	mux.HandleFunc("POST /v1/weekly-reviews/{id}/writeback", h.writeback)        // budget: none
	mux.HandleFunc("POST /v1/weekly-reviews/{id}/evidence", h.addReviewEvidence) // budget: none
	mux.HandleFunc("GET /v1/learning/evidence/suggest", h.suggest)
	mux.HandleFunc("PATCH /v1/learning/evidence/{id}", h.patchEvidence)   // budget: none
	mux.HandleFunc("DELETE /v1/learning/evidence/{id}", h.deleteEvidence) // budget: none
	mux.HandleFunc("GET /v1/learning/chains/{id}", h.getChain)
	mux.HandleFunc("PATCH /v1/learning/chains/{id}", h.patchChain)               // budget: none
	mux.HandleFunc("DELETE /v1/learning/chains/{id}", h.deleteChain)             // budget: none
	mux.HandleFunc("POST /v1/learning/chains/{id}/evidence", h.addChainEvidence) // budget: none
	mux.HandleFunc("GET /v1/learning/briefs/{id}", h.getBrief)
	mux.HandleFunc("PATCH /v1/learning/briefs/{id}", h.patchBrief)    // budget: none
	mux.HandleFunc("DELETE /v1/learning/briefs/{id}", h.deleteBrief)  // budget: none
	mux.HandleFunc("POST /v1/learning/briefs/{id}/logs", h.createLog) // budget: none
	mux.HandleFunc("GET /v1/learning/logs/{id}", h.getLog)
	mux.HandleFunc("PATCH /v1/learning/logs/{id}", h.patchLog)   // budget: none
	mux.HandleFunc("DELETE /v1/learning/logs/{id}", h.deleteLog) // budget: none
	mux.HandleFunc("GET /v1/learning/card-kinds", h.cardKinds)
	mux.HandleFunc("GET /v1/learning/retests", h.retestsDue)
	mux.HandleFunc("POST /v1/learning/states/{id}/cards", h.createCard) // budget: none
	mux.HandleFunc("GET /v1/learning/cards/{id}", h.getCard)
	mux.HandleFunc("POST /v1/learning/cards/{id}/entries", h.addCardEntry) // budget: none
	mux.HandleFunc("POST /v1/learning/cards/{id}/close", h.closeCard)      // budget: none
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
// TestRegisteredPatternsMatchesSource fails if the two lists drift.
func Patterns() []string {
	return []string{
		"GET /v1/learning/states",
		"POST /v1/learning/states",
		"GET /v1/learning/states/{id}",
		"PATCH /v1/learning/states/{id}",
		"DELETE /v1/learning/states/{id}",
		"POST /v1/learning/states/{id}/interrupt",
		"POST /v1/learning/states/{id}/cycles",
		"POST /v1/learning/states/{id}/resume",
		"POST /v1/learning/states/{id}/handover",
		"GET /v1/learning/states/{id}/chains",
		"POST /v1/learning/states/{id}/chains",
		"GET /v1/learning/states/{id}/briefs",
		"POST /v1/learning/states/{id}/briefs",
		"GET /v1/cycles/{id}",
		"PATCH /v1/cycles/{id}",
		"POST /v1/cycles/{id}/advance",
		"POST /v1/cycles/{id}/reviews",
		"GET /v1/weekly-reviews/{id}",
		"PATCH /v1/weekly-reviews/{id}",
		"POST /v1/weekly-reviews/{id}/writeback",
		"POST /v1/weekly-reviews/{id}/evidence",
		"GET /v1/learning/evidence/suggest",
		"PATCH /v1/learning/evidence/{id}",
		"DELETE /v1/learning/evidence/{id}",
		"GET /v1/learning/chains/{id}",
		"PATCH /v1/learning/chains/{id}",
		"DELETE /v1/learning/chains/{id}",
		"POST /v1/learning/chains/{id}/evidence",
		"GET /v1/learning/briefs/{id}",
		"PATCH /v1/learning/briefs/{id}",
		"DELETE /v1/learning/briefs/{id}",
		"POST /v1/learning/briefs/{id}/logs",
		"GET /v1/learning/logs/{id}",
		"PATCH /v1/learning/logs/{id}",
		"DELETE /v1/learning/logs/{id}",
		"GET /v1/learning/card-kinds",
		"GET /v1/learning/retests",
		"POST /v1/learning/states/{id}/cards",
		"GET /v1/learning/cards/{id}",
		"POST /v1/learning/cards/{id}/entries",
		"POST /v1/learning/cards/{id}/close",
	}
}

// ── shared plumbing ───────────────────────────────────────────────────────

func pathID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	return parseID(w, r.PathValue("id"))
}

func parseID(w http.ResponseWriter, raw string) (uuid.UUID, bool) {
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil || id == uuid.Nil {
		notFound(w)
		return uuid.Nil, false
	}
	return id, true
}

func intParam(r *http.Request, name string) int {
	n, _ := strconv.Atoi(r.URL.Query().Get(name))
	return n
}

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := httpx.DecodeJSON(w, r, v); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return false
	}
	return true
}

// notReadyBody is the 409 a shut gate or an unfinished review answers with:
// the reasons, and for a gate the whole decision, so the page can show what
// is missing and what even an open gate would not prove.
type notReadyBody struct {
	Error    string           `json:"error"`
	Code     string           `json:"code"`
	Problems []string         `json:"problems"`
	Gate     *loop.GateResult `json:"gate,omitempty"`
}

func fail(w http.ResponseWriter, r *http.Request, err error) {
	var nr *loop.NotReadyError
	switch {
	case errors.As(err, &nr):
		code := "not_ready"
		if nr.Gate != nil {
			code = "gate_closed"
		}
		httpx.WriteJSON(w, http.StatusConflict, notReadyBody{
			Error: strings.Join(nr.Problems, " "), Code: code, Problems: nr.Problems, Gate: nr.Gate,
		})
	case errors.Is(err, loop.ErrNotFound):
		notFound(w)
	case errors.Is(err, loop.ErrRetestNotDue):
		httpx.WriteError(w, http.StatusConflict, strings.TrimPrefix(err.Error(), "loop: retest not due: "), "retest_not_due")
	case errors.Is(err, loop.ErrInvalid):
		httpx.WriteError(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), "loop: invalid: "), "bad_request")
	case errors.Is(err, loop.ErrConflict):
		httpx.WriteError(w, http.StatusConflict, strings.TrimPrefix(err.Error(), "loop: conflict: "), "conflict")
	default:
		slog.Error("loopapi: request failed", "path", r.URL.Path, "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
