// Package bodyapi is Body's HTTP layer: the training plan, workouts, body
// weight, progress, and the coach.
//
// Only the coach's three drafting routes call a model (budget: generate);
// everything else is `budget: none`.
//
// Identity comes from httpx.MustUserID(ctx) and nowhere else. Every id is
// resolved with the caller's user_id, and "not yours" and "no such thing"
// are the same 404.
package bodyapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/body"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Handler serves the Body routes.
type Handler struct {
	svc   *body.Service
	coach *body.Coach
}

// NewHandler returns a Handler.
func NewHandler(svc *body.Service, coach *body.Coach) *Handler {
	return &Handler{svc: svc, coach: coach}
}

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/body", h.overview)
	mux.HandleFunc("PUT /v1/body/profile", h.profile) // budget: none
	mux.HandleFunc("GET /v1/body/exercises", h.exercises)
	mux.HandleFunc("GET /v1/body/stats", h.stats)

	mux.HandleFunc("POST /v1/body/routines", h.createRoutine) // budget: none
	mux.HandleFunc("GET /v1/body/routines/{id}", h.routine)
	mux.HandleFunc("PUT /v1/body/routines/{id}", h.updateRoutine)    // budget: none
	mux.HandleFunc("DELETE /v1/body/routines/{id}", h.deleteRoutine) // budget: none
	mux.HandleFunc("PUT /v1/body/week", h.week)                      // budget: none

	mux.HandleFunc("POST /v1/body/workouts", h.start) // budget: none
	mux.HandleFunc("GET /v1/body/workouts", h.history)
	mux.HandleFunc("GET /v1/body/workouts/{id}", h.workout)
	mux.HandleFunc("PATCH /v1/body/workouts/{id}", h.saveWorkout)     // budget: none
	mux.HandleFunc("POST /v1/body/workouts/{id}/entries", h.addEntry) // budget: none
	mux.HandleFunc("POST /v1/body/workouts/{id}/finish", h.finish)    // budget: none
	mux.HandleFunc("DELETE /v1/body/workouts/{id}", h.deleteWorkout)  // budget: none

	mux.HandleFunc("POST /v1/body/weights", h.setWeight)            // budget: none
	mux.HandleFunc("DELETE /v1/body/weights/{day}", h.deleteWeight) // budget: none

	mux.HandleFunc("GET /v1/body/coach/proposals", h.proposals)
	mux.HandleFunc("POST /v1/body/coach/plan", h.coachPlan)                      // budget: generate
	mux.HandleFunc("POST /v1/body/coach/review", h.coachReview)                  // budget: generate
	mux.HandleFunc("POST /v1/body/coach/proposals/{id}/refine", h.coachRefine)   // budget: generate
	mux.HandleFunc("POST /v1/body/coach/proposals/{id}/accept", h.coachAccept)   // budget: none
	mux.HandleFunc("POST /v1/body/coach/proposals/{id}/decline", h.coachDecline) // budget: none
	mux.HandleFunc("POST /v1/body/coach/proposals/{id}/revert", h.coachRevert)   // budget: none
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"GET /v1/body",
		"PUT /v1/body/profile",
		"GET /v1/body/exercises",
		"GET /v1/body/stats",
		"POST /v1/body/routines",
		"GET /v1/body/routines/{id}",
		"PUT /v1/body/routines/{id}",
		"DELETE /v1/body/routines/{id}",
		"PUT /v1/body/week",
		"POST /v1/body/workouts",
		"GET /v1/body/workouts",
		"GET /v1/body/workouts/{id}",
		"PATCH /v1/body/workouts/{id}",
		"POST /v1/body/workouts/{id}/entries",
		"POST /v1/body/workouts/{id}/finish",
		"DELETE /v1/body/workouts/{id}",
		"POST /v1/body/weights",
		"DELETE /v1/body/weights/{day}",
		"GET /v1/body/coach/proposals",
		"POST /v1/body/coach/plan",
		"POST /v1/body/coach/review",
		"POST /v1/body/coach/proposals/{id}/refine",
		"POST /v1/body/coach/proposals/{id}/accept",
		"POST /v1/body/coach/proposals/{id}/decline",
		"POST /v1/body/coach/proposals/{id}/revert",
	}
}

// ── names ────────────────────────────────────────────────────────────────

// exerciseName is what a list needs to show a library id.
type exerciseName struct {
	Name      string `json:"name"`
	BodyPart  string `json:"body_part"`
	Equipment string `json:"equipment"`
	Target    string `json:"target"`
}

// names maps every library id the response mentions to its name, so the
// browser never needs the 800 KB library.
type names map[string]exerciseName

func (n names) add(id string) {
	if _, ok := n[id]; ok {
		return
	}
	if e, ok := body.Lookup(id); ok {
		n[id] = exerciseName{Name: e.Name, BodyPart: e.BodyPart, Equipment: e.Equipment, Target: e.Target}
	}
}

func (n names) routines(rs ...body.Routine) names {
	for _, r := range rs {
		for _, e := range r.Exercises {
			n.add(e.Exercise)
		}
	}
	return n
}

func (n names) workouts(ws ...*body.Workout) names {
	for _, w := range ws {
		if w == nil {
			continue
		}
		for _, e := range w.Entries {
			n.add(e.Exercise)
		}
	}
	return n
}

func (n names) proposals(ps ...body.Proposal) names {
	for _, p := range ps {
		if p.Plan == nil {
			continue
		}
		for _, r := range p.Plan.Routines {
			for _, e := range r.Exercises {
				n.add(e.Exercise)
			}
		}
	}
	return n
}

// ── overview, profile, library, stats ────────────────────────────────────

func (h *Handler) overview(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	o, err := h.svc.Overview(r.Context(), userID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	n := names{}.routines(o.Routines...).workouts(o.Open)
	for i := range o.Recent {
		n.workouts(&o.Recent[i])
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"overview": o, "names": n})
}

type profileRequest struct {
	Unit       *string  `json:"unit"`
	GoalWeight *float64 `json:"goal_weight"`
	ClearGoal  bool     `json:"clear_goal"`
	RestSec    *int     `json:"rest_sec"`
}

func (h *Handler) profile(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req profileRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	p, err := h.svc.SaveProfile(r.Context(), userID, body.ProfileInput{
		Unit: req.Unit, GoalWeight: req.GoalWeight, ClearGoal: req.ClearGoal, RestSec: req.RestSec})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, p)
}

// exercises searches the library. `?id=` returns that one exercise with its
// steps; otherwise a page of matches and the filter facets.
func (h *Handler) exercises(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if id := q.Get("id"); id != "" {
		e, ok := body.Lookup(id)
		if !ok {
			notFound(w)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"exercise": e})
		return
	}
	list, total := body.Search(body.LibraryFilter{
		Q: q.Get("q"), BodyPart: q.Get("body_part"), Equipment: q["equipment"],
		Limit: intParam(r, "limit", 50), Offset: intParam(r, "offset", 0),
	})
	if list == nil {
		list = []body.Exercise{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"exercises": list, "total": total, "facets": body.LibraryFacets()})
}

func (h *Handler) stats(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	st, err := h.svc.Stats(r.Context(), userID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, st)
}

// ── routines and the week ────────────────────────────────────────────────

type routineRequest struct {
	Name      string              `json:"name"`
	Prog      string              `json:"prog"`
	Exercises []body.PlanExercise `json:"exercises"`
}

func (req routineRequest) input() body.RoutineInput {
	return body.RoutineInput{Name: req.Name, Prog: req.Prog, Exercises: req.Exercises}
}

func (h *Handler) createRoutine(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req routineRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	rt, err := h.svc.CreateRoutine(r.Context(), userID, req.input())
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"routine": rt, "names": names{}.routines(*rt)})
}

func (h *Handler) routine(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	rt, err := h.svc.Routine(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"routine": rt, "names": names{}.routines(*rt)})
}

func (h *Handler) updateRoutine(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req routineRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	rt, err := h.svc.UpdateRoutine(r.Context(), userID, id, req.input())
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"routine": rt, "names": names{}.routines(*rt)})
}

func (h *Handler) deleteRoutine(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteRoutine(r.Context(), userID, id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type weekRequest struct {
	// Week holds seven routine ids or nulls, Sunday first; each is resolved
	// with the caller's user_id.
	Week []*uuid.UUID `json:"week"`
}

func (h *Handler) week(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req weekRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil || len(req.Week) != 7 {
		badRequest(w, "week must list seven days, Sunday first")
		return
	}
	var wk body.Week
	copy(wk[:], req.Week)
	got, err := h.svc.SetWeek(r.Context(), userID, wk)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"week": got})
}

// ── workouts ─────────────────────────────────────────────────────────────

type startRequest struct {
	RoutineID  *uuid.UUID `json:"routine_id"`
	Bodyweight *float64   `json:"bodyweight"`
}

// start opens today's workout: 201 for a new one, 200 for the one already
// open, which the browser then resumes.
func (h *Handler) start(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req startRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	wk, created, err := h.svc.StartWorkout(r.Context(), userID, body.StartInput{RoutineID: req.RoutineID, Bodyweight: req.Bodyweight})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	httpx.WriteJSON(w, status, map[string]any{"workout": wk, "created": created, "names": names{}.workouts(wk)})
}

func (h *Handler) history(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	list, err := h.svc.History(r.Context(), userID, intParam(r, "limit", 50))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	n := names{}
	for i := range list {
		n.workouts(&list[i])
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"workouts": list, "names": n})
}

func (h *Handler) workout(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	wk, err := h.svc.Workout(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"workout": wk, "names": names{}.workouts(wk)})
}

type workoutPatchRequest struct {
	Entries    *[]body.Entry `json:"entries"`
	Bodyweight *float64      `json:"bodyweight"`
	ClearBW    bool          `json:"clear_bodyweight"`
	Note       *string       `json:"note"`
}

func (h *Handler) saveWorkout(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req workoutPatchRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	wk, err := h.svc.SaveWorkout(r.Context(), userID, id, body.WorkoutPatch{
		Entries: req.Entries, Bodyweight: req.Bodyweight, ClearBW: req.ClearBW, Note: req.Note})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"workout": wk, "names": names{}.workouts(wk)})
}

type addEntryRequest struct {
	// Exercise is a library key ("0025"), not a row.
	Exercise string `json:"exercise"`
}

func (h *Handler) addEntry(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req addEntryRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	wk, err := h.svc.AddEntry(r.Context(), userID, id, req.Exercise)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"workout": wk, "names": names{}.workouts(wk)})
}

func (h *Handler) finish(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	done, err := h.svc.FinishWorkout(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"workout": done.Workout, "records": done.Records, "names": names{}.workouts(done.Workout)})
}

func (h *Handler) deleteWorkout(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteWorkout(r.Context(), userID, id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── body weight ──────────────────────────────────────────────────────────

type weightRequest struct {
	Day    string  `json:"day"`
	Weight float64 `json:"weight"`
}

func (h *Handler) setWeight(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req weightRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	got, err := h.svc.SetWeight(r.Context(), userID, strings.TrimSpace(req.Day), req.Weight)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, got)
}

func (h *Handler) deleteWeight(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	if err := h.svc.DeleteWeight(r.Context(), userID, r.PathValue("day")); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── the coach ────────────────────────────────────────────────────────────

func (h *Handler) proposals(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	list, err := h.coach.Proposals(r.Context(), userID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"proposals": list, "names": names{}.proposals(list...)})
}

func (h *Handler) writeProposal(w http.ResponseWriter, r *http.Request, status int, p *body.Proposal, err error) {
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, status, map[string]any{"proposal": p, "names": names{}.proposals(*p)})
}

func (h *Handler) coachPlan(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req body.Intake
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	p, err := h.coach.Plan(r.Context(), userID, req)
	h.writeProposal(w, r, http.StatusCreated, p, err)
}

type textRequest struct {
	Text string `json:"text"`
}

func (h *Handler) coachReview(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req textRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	p, err := h.coach.Review(r.Context(), userID, req.Text)
	h.writeProposal(w, r, http.StatusCreated, p, err)
}

func (h *Handler) coachRefine(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req textRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	p, err := h.coach.Refine(r.Context(), userID, id, req.Text)
	h.writeProposal(w, r, http.StatusCreated, p, err)
}

func (h *Handler) coachAccept(w http.ResponseWriter, r *http.Request) {
	if userID, id, ok := pathID(w, r); ok {
		p, err := h.coach.Accept(r.Context(), userID, id)
		h.writeProposal(w, r, http.StatusOK, p, err)
	}
}

func (h *Handler) coachDecline(w http.ResponseWriter, r *http.Request) {
	if userID, id, ok := pathID(w, r); ok {
		p, err := h.coach.Decline(r.Context(), userID, id)
		h.writeProposal(w, r, http.StatusOK, p, err)
	}
}

func (h *Handler) coachRevert(w http.ResponseWriter, r *http.Request) {
	if userID, id, ok := pathID(w, r); ok {
		p, err := h.coach.Revert(r.Context(), userID, id)
		h.writeProposal(w, r, http.StatusOK, p, err)
	}
}

// ── helpers ──────────────────────────────────────────────────────────────

// pathID reads the caller and the `{id}` path value. A malformed id is the
// same 404 as another user's.
func pathID(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	userID := httpx.MustUserID(r.Context())
	id, err := uuid.Parse(strings.TrimSpace(r.PathValue("id")))
	if err != nil || id == uuid.Nil {
		notFound(w)
		return uuid.Nil, uuid.Nil, false
	}
	return userID, id, true
}

func intParam(r *http.Request, name string, def int) int {
	if v := r.URL.Query().Get(name); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return n
		}
	}
	return def
}

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
}

func badRequest(w http.ResponseWriter, msg string) {
	httpx.WriteError(w, http.StatusBadRequest, msg, "bad_request")
}

// fail maps an error to a response. Only body.ErrInvalid's and
// body.ErrConflict's sentences reach the client; anything else is logged and
// answered with one word.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, body.ErrNotFound):
		notFound(w)
	case errors.Is(err, body.ErrInvalid):
		badRequest(w, strings.TrimPrefix(err.Error(), "body: invalid: "))
	case errors.Is(err, body.ErrConflict):
		httpx.WriteError(w, http.StatusConflict, strings.TrimPrefix(err.Error(), "body: conflict: "), "conflict")
	case errors.Is(err, body.ErrCoachFailed):
		httpx.WriteError(w, http.StatusUnprocessableEntity,
			"your model's plan did not fit the exercise library twice — try again, or another model", "coach_failed")
	case errors.Is(err, runtime.ErrNoProvider):
		httpx.WriteError(w, http.StatusConflict, "no model is configured for this — add one in Settings", "no_provider")
	case errors.Is(err, runtime.ErrProvider):
		httpx.WriteError(w, http.StatusBadGateway, "your model could not be reached", "provider_failed")
	default:
		slog.Error("bodyapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
