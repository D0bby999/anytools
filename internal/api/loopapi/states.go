package loopapi

import (
	"net/http"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/learning/loop"
)

// ── learning states ───────────────────────────────────────────────────────

func (h *Handler) listStates(w http.ResponseWriter, r *http.Request) {
	states, err := h.svc.States(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"states": states})
}

// startState is the minimal start: four fields, one state, one cycle.
func (h *Handler) startState(w http.ResponseWriter, r *http.Request) {
	var in loop.MinimalStart
	if !decode(w, r, &in) {
		return
	}
	st, c, err := h.svc.Start(r.Context(), httpx.MustUserID(r.Context()), in)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"state": st, "cycle": c})
}

func (h *Handler) getState(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	d, err := h.svc.State(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, d)
}

func (h *Handler) patchState(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var patch loop.StatePatch
	if !decode(w, r, &patch) {
		return
	}
	st, err := h.svc.UpdateState(r.Context(), httpx.MustUserID(r.Context()), id, patch)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, st)
}

func (h *Handler) deleteState(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteState(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// interrupt is "I got interrupted": the next task shrinks to its minimum.
func (h *Handler) interrupt(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in loop.InterruptRequest
	if !decode(w, r, &in) {
		return
	}
	st, c, err := h.svc.Interrupt(r.Context(), httpx.MustUserID(r.Context()), id, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"state": st, "cycle": c})
}

func (h *Handler) newCycle(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	c, err := h.svc.NewCycle(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, c)
}

// resume opens a chat linked to the state; the chat capability injects it.
func (h *Handler) resume(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	sess, err := h.svc.Resume(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"session_id": sess.ID.String(), "title": sess.Title})
}

// handover validates a paste-back and, with accept=true, writes it. An
// invalid block is 200 with valid=false and the problems: the request was
// fine, the block was not, and the page shows why.
func (h *Handler) handover(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in loop.HandoverRequest
	if !decode(w, r, &in) {
		return
	}
	res, err := h.svc.Handover(r.Context(), httpx.MustUserID(r.Context()), id, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, res)
}
