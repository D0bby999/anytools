package loopapi

import (
	"net/http"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/learning/loop"
)

// ── evidence chains ───────────────────────────────────────────────────────

func (h *Handler) listChains(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	chains, err := h.svc.Chains(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"chains": chains})
}

func (h *Handler) createChain(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in loop.ChainInput
	if !decode(w, r, &in) {
		return
	}
	c, err := h.svc.CreateChain(r.Context(), httpx.MustUserID(r.Context()), id, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, c)
}

func (h *Handler) getChain(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	d, err := h.svc.Chain(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, d)
}

func (h *Handler) patchChain(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in loop.ChainInput
	if !decode(w, r, &in) {
		return
	}
	c, err := h.svc.UpdateChain(r.Context(), httpx.MustUserID(r.Context()), id, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, c)
}

func (h *Handler) deleteChain(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteChain(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) addChainEvidence(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in loop.NewEvidence
	if !decode(w, r, &in) {
		return
	}
	ref, err := h.svc.AddChainEvidence(r.Context(), httpx.MustUserID(r.Context()), id, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, ref)
}
