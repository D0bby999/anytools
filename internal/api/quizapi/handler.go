// Package quizapi is the question bank's HTTP surface.
//
// One rule, the same one kbapi states: the caller's identity comes from
// httpx.MustUserID(ctx) and from nowhere else. No handler here reads a user id
// from a path, a query or a body, and every id that arrives in a request is
// passed to a service that filters on the authenticated user in SQL.
package quizapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Handler serves the quiz routes.
type Handler struct {
	svc *quiz.Service
	// graduate is called after an attempt that advanced a mastery knowledge
	// point, so a module that just crossed its bar is retired without the
	// client having to ask. It is a func rather than a mastery.Service so that
	// quizapi does not depend on the mastery package; nil means "no mastery
	// subsystem wired", which is a legitimate state, not a bug.
	graduate func(userID, kpID uuid.UUID)
}

// NewHandler builds the handler.
func NewHandler(svc *quiz.Service, graduate func(userID, kpID uuid.UUID)) *Handler {
	return &Handler{svc: svc, graduate: graduate}
}

// RegisterRoutes registers this package's patterns on the mux.
//
// Every pattern must also appear in api.RegisteredPatterns(); the allowlist
// test fails in both directions, so a route cannot ship without the
// authentication test covering it.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/quiz/generate", h.generate) // budget: generate
	mux.HandleFunc("GET /v1/quiz/questions", h.bank)
	mux.HandleFunc("GET /v1/quiz/questions/{id}", h.question)
	mux.HandleFunc("GET /v1/quiz/practice", h.practice)
	mux.HandleFunc("POST /v1/questions/{id}/attempt", h.attempt)       // budget: generate
	mux.HandleFunc("POST /v1/quiz/attempts/{id}/override", h.override) // budget: none
	// the private design notes, phase 4: a starter set.
	mux.HandleFunc("POST /v1/quiz/starters", h.addStarter) // budget: none
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"POST /v1/quiz/generate",
		"GET /v1/quiz/questions",
		"GET /v1/quiz/questions/{id}",
		"GET /v1/quiz/practice",
		"POST /v1/questions/{id}/attempt",
		"POST /v1/quiz/attempts/{id}/override",
		"POST /v1/quiz/starters",
	}
}

func (h *Handler) generate(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req quiz.GenerateRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	// The request may NOT set the fields the mastery session uses to link a
	// question to a path. Accepting a knowledge point id from a plain quiz call
	// would let a learner attach practice questions to a module and move its
	// mastery number without ever opening the path.
	req.KnowledgePointID, req.ModuleID = nil, nil

	result, err := h.svc.Generate(r.Context(), userID, req)
	if err != nil {
		h.fail(w, r, err)
		return
	}

	views := make([]map[string]any, 0, len(result.Questions))
	for _, q := range result.Questions {
		views = append(views, q.View(false))
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"questions":         views,
		"requested":         result.Requested,
		"dropped_citations": result.DroppedCitations,
		"provider":          result.Provider,
		"model":             result.Model,
		"note":              result.Note,
	})
}

func (h *Handler) bank(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())

	f := quiz.Filter{Limit: limitParam(r, 50)}
	if v := strings.TrimSpace(r.URL.Query().Get("kb_id")); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			notFound(w)
			return
		}
		f.KBID = &id
	}
	if v := strings.TrimSpace(r.URL.Query().Get("knowledge_point_id")); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			notFound(w)
			return
		}
		f.KnowledgePointID = &id
	}
	if v := strings.TrimSpace(r.URL.Query().Get("module_id")); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			notFound(w)
			return
		}
		f.ModuleID = &id
	}
	f.Type = strings.TrimSpace(r.URL.Query().Get("type"))
	if v := strings.TrimSpace(r.URL.Query().Get("answered")); v != "" {
		answered, err := strconv.ParseBool(v)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "answered must be true or false", "bad_request")
			return
		}
		f.Answered = &answered
	}

	entries, err := h.svc.Bank(r.Context(), userID, f)
	if err != nil {
		h.fail(w, r, err)
		return
	}

	// The bank shows the answer for a question the learner has ALREADY
	// attempted, and hides it otherwise. The list is where a browser would
	// otherwise be handed every answer key the user owns in one response.
	out := make([]map[string]any, 0, len(entries))
	revealed := make([]quiz.Question, 0, len(entries))
	for _, e := range entries {
		if e.Attempts > 0 {
			revealed = append(revealed, e.Question)
		}
		out = append(out, map[string]any{
			"question":             e.Question.View(e.Attempts > 0),
			"attempts":             e.Attempts,
			"last_correct":         e.LastCorrect,
			"last_attempt":         e.LastAttempt,
			"last_attempt_id":      e.LastAnswerID,
			"kb_name":              e.KBName,
			"module_name":          e.ModuleName,
			"knowledge_point_name": e.KPName,
		})
	}
	// Sources for every revealed explanation, resolved in one query rather
	// than one per row.
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"questions": out,
		"sources":   h.svc.Sources(r.Context(), userID, revealed...),
	})
}

// practice is the queue of open mistakes. Each question is served UNREVEALED:
// the point is to answer it again, and the answer goes through the attempt
// route like any other.
func (h *Handler) practice(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var f quiz.PracticeFilter
	for name, dst := range map[string]**uuid.UUID{"kb_id": &f.KBID, "path_id": &f.PathID} {
		if v := strings.TrimSpace(r.URL.Query().Get(name)); v != "" {
			id, err := uuid.Parse(v)
			if err != nil {
				notFound(w)
				return
			}
			*dst = &id
		}
	}
	queue, err := h.svc.Practice(r.Context(), userID, f)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	items := make([]map[string]any, 0, len(queue.Items))
	for _, it := range queue.Items {
		items = append(items, map[string]any{
			"question":  it.Question.View(false),
			"status":    it.Status,
			"opened_at": it.OpenedAt,
			"misses":    it.Misses,
			"kb_name":   it.KBName,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "remaining": queue.Remaining})
}

func (h *Handler) question(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	q, attempts, err := h.svc.Get(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	revealed := len(attempts) > 0
	sources := []citations.Source{}
	if revealed {
		sources = h.svc.Sources(r.Context(), userID, *q)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"question": q.View(revealed),
		"attempts": attempts,
		"sources":  sources,
	})
}

func (h *Handler) attempt(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var req quiz.AttemptRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}

	result, err := h.svc.Attempt(r.Context(), userID, id, req)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	h.afterAttempt(userID, result)
	httpx.WriteJSON(w, http.StatusCreated, result)
}

type overrideRequest struct {
	IsCorrect bool `json:"is_correct"`
}

func (h *Handler) override(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var req overrideRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}

	result, err := h.svc.Override(r.Context(), userID, id, req.IsCorrect)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	h.afterAttempt(userID, result)
	httpx.WriteJSON(w, http.StatusOK, result)
}

// afterAttempt lets the mastery subsystem retire a module that just crossed its
// bar. It is best-effort and synchronous: a graduation that failed to record is
// logged, and the next attempt will find the same module still eligible, since
// Graduate is idempotent.
func (h *Handler) afterAttempt(userID uuid.UUID, result *quiz.AttemptResult) {
	if h.graduate == nil || result == nil || result.Scheduled == nil {
		return
	}
	h.graduate(userID, result.Scheduled.KnowledgePointID)
}

// ── shared plumbing ───────────────────────────────────────────────────────

// pathID reads a uuid path value, answering 404 for anything malformed.
//
// 404 and not 400, for the reason chatapi gives: a request for a badly formed
// id and a request for another user's id must be indistinguishable, or the
// status code tells an attacker which guesses were well-formed.
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

// fail maps a service error onto a status.
//
// ErrNoAccess and ErrNotFound are BOTH 404, identically. That is the existence
// oracle rule: "this knowledge base is not yours" and "there is no such
// knowledge base" must be the same answer, or an endpoint that takes an id
// becomes a way to enumerate other people's.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, quiz.ErrNoAccess), errors.Is(err, quiz.ErrNotFound):
		notFound(w)
	case errors.Is(err, quiz.ErrUnreadableMath):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "this answer could not be read as maths", "unreadable_math")
	case errors.Is(err, quiz.ErrBadRequest):
		httpx.WriteError(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), "quiz: "), "bad_request")
	case errors.Is(err, runtime.ErrNoProvider):
		httpx.WriteError(w, http.StatusConflict,
			"no model is configured for quizzes — add one in Settings", "no_provider")
	case errors.Is(err, quiz.ErrNoQuestions):
		httpx.WriteError(w, http.StatusConflict,
			"these documents did not support any questions on that topic", "no_questions")
	case errors.Is(err, quiz.ErrBadModelOutput):
		httpx.WriteError(w, http.StatusBadGateway,
			"your model did not return usable questions — try again", "bad_model_output")
	case errors.Is(err, runtime.ErrProvider):
		httpx.WriteError(w, http.StatusBadGateway, "your model could not be reached", "provider_failed")
	default:
		slog.Error("quizapi: request failed", "path", r.URL.Path, "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}

type starterRequest struct {
	KBID uuid.UUID `json:"kb_id"`
	Set  string    `json:"set"`
}

// addStarter adds a starter set's exercises to the caller's knowledge base.
func (h *Handler) addStarter(w http.ResponseWriter, r *http.Request) {
	var req starterRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	res, err := h.svc.AddStarter(r.Context(), httpx.MustUserID(r.Context()), req.KBID, req.Set)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, res)
}
