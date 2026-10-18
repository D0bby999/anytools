package loopapi

import (
	"net/http"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/learning/loop"
)

// ── skill evidence cards ──────────────────────────────────────────────────

// cardKinds serves the one kinds table (loop.CardKinds); the web app renders
// these rather than keeping a copy.
func (h *Handler) cardKinds(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"kinds": loop.CardKinds()})
}

func (h *Handler) createCard(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in loop.NewCard
	if !decode(w, r, &in) {
		return
	}
	d, err := h.svc.CreateCard(r.Context(), httpx.MustUserID(r.Context()), id, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, d)
}

func (h *Handler) getCard(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	d, err := h.svc.Card(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, d)
}

// addCardEntry writes an entry. A retest before its day is 409
// retest_not_due; a second first attempt is 409 conflict.
func (h *Handler) addCardEntry(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in loop.CardEntryInput
	if !decode(w, r, &in) {
		return
	}
	d, err := h.svc.AddCardEntry(r.Context(), httpx.MustUserID(r.Context()), id, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, d)
}

func (h *Handler) closeCard(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in loop.CardReflection
	if !decode(w, r, &in) {
		return
	}
	d, err := h.svc.CloseCard(r.Context(), httpx.MustUserID(r.Context()), id, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, d)
}

// retestsDue is what the Loop home lists at the top and Home counts: retests
// due on or before the learner's today.
func (h *Handler) retestsDue(w http.ResponseWriter, r *http.Request) {
	due, today, err := h.svc.RetestsDue(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"retests": due, "count": len(due), "today": today})
}
