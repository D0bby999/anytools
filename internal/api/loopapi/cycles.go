package loopapi

import (
	"net/http"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/learning/loop"
)

// ── cycles ────────────────────────────────────────────────────────────────

func (h *Handler) getCycle(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	d, err := h.svc.Cycle(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, d)
}

func (h *Handler) patchCycle(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var patch loop.CyclePatch
	if !decode(w, r, &patch) {
		return
	}
	c, err := h.svc.UpdateCycle(r.Context(), httpx.MustUserID(r.Context()), id, patch)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, c)
}

// advance moves the cycle through its gate, or answers 409 gate_closed with
// the gate's own account of what is missing and what it cannot prove.
func (h *Handler) advance(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	d, err := h.svc.Advance(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, d)
}

type createReviewRequest struct {
	// Week 0 (or absent) means the cycle's current week.
	Week int `json:"week"`
}

func (h *Handler) createReview(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in createReviewRequest
	if r.ContentLength != 0 && !decode(w, r, &in) {
		return
	}
	rv, err := h.svc.CreateReview(r.Context(), httpx.MustUserID(r.Context()), id, in.Week)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, rv)
}
