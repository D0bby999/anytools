package loopapi

import (
	"net/http"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/learning/loop"
)

// ── weekly reviews ────────────────────────────────────────────────────────

func (h *Handler) getReview(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	d, err := h.svc.Review(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, d)
}

func (h *Handler) patchReview(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var patch loop.ReviewPatch
	if !decode(w, r, &patch) {
		return
	}
	d, err := h.svc.UpdateReview(r.Context(), httpx.MustUserID(r.Context()), id, patch)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, d)
}

// writeback writes a finished review into its state, or answers 409
// not_ready with every reason it cannot be yet.
func (h *Handler) writeback(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	d, st, err := h.svc.Writeback(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"review": d, "state": st})
}

func (h *Handler) addReviewEvidence(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in loop.NewEvidence
	if !decode(w, r, &in) {
		return
	}
	ref, err := h.svc.AddReviewEvidence(r.Context(), httpx.MustUserID(r.Context()), id, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, ref)
}

// ── evidence ──────────────────────────────────────────────────────────────

// suggest is GET /v1/learning/evidence/suggest?cycle_id=&week= — what the
// user did that week, computed on read. week omitted or 0 means this week.
// cycle_id is a resource id like any path id: foreign or malformed is 404.
func (h *Handler) suggest(w http.ResponseWriter, r *http.Request) {
	cycleID, ok := parseID(w, r.URL.Query().Get("cycle_id"))
	if !ok {
		return
	}
	cands, week, err := h.svc.Suggest(r.Context(), httpx.MustUserID(r.Context()), cycleID, intParam(r, "week"))
	if err != nil {
		fail(w, r, err)
		return
	}
	if cands == nil {
		cands = []loop.Candidate{}
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"week": week, "suggestions": cands})
}

func (h *Handler) patchEvidence(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var patch loop.EvidencePatch
	if !decode(w, r, &patch) {
		return
	}
	ref, err := h.svc.UpdateEvidence(r.Context(), httpx.MustUserID(r.Context()), id, patch)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, ref)
}

func (h *Handler) deleteEvidence(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteEvidence(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
