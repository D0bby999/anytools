package loopapi

import (
	"net/http"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/learning/loop"
)

// ── AI learning logs ──────────────────────────────────────────────────────

func (h *Handler) createLog(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in loop.LogInput
	if !decode(w, r, &in) {
		return
	}
	d, err := h.svc.CreateLog(r.Context(), httpx.MustUserID(r.Context()), id, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, d)
}

func (h *Handler) getLog(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	d, err := h.svc.Log(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, d)
}

func (h *Handler) patchLog(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in loop.LogInput
	if !decode(w, r, &in) {
		return
	}
	d, err := h.svc.UpdateLog(r.Context(), httpx.MustUserID(r.Context()), id, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, d)
}

func (h *Handler) deleteLog(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteLog(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
