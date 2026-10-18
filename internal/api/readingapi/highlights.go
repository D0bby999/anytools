package readingapi

import (
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/reading"
)

type highlightRequest struct {
	Page  int    `json:"page"`
	Text  string `json:"text"`
	Color string `json:"color"`
}

func (h *Handler) listHighlights(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := h.requireWorkspace(w, r)
	if !ok {
		return
	}
	list, err := h.d.Workspaces.ListHighlights(r.Context(), userID, ws.ID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"highlights": list})
}

func (h *Handler) createHighlight(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := h.requireWorkspace(w, r)
	if !ok {
		return
	}
	var req highlightRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	hl, err := h.d.Workspaces.AddHighlight(r.Context(), userID, ws.ID, reading.NewHighlight{
		Page:  req.Page,
		Text:  req.Text,
		Color: req.Color,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, hl)
}

type highlightPatchRequest struct {
	Color  *string `json:"color"`
	NoteID *string `json:"note_id"`
}

// patchHighlight recolours a highlight or links it to a note.
//
// The highlight is addressed by its own id rather than through its workspace,
// so this route does NOT read the workspace first. That is safe for exactly one
// reason: the store's UPDATE names user_id, so a highlight belonging to someone
// else matches zero rows and returns ErrNotFound. It is not safe because "the
// UI would only ever send its own ids".
func (h *Handler) patchHighlight(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := highlightID(w, r)
	if !ok {
		return
	}
	var req highlightPatchRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}

	patch := reading.HighlightPatch{Color: req.Color}
	if req.NoteID != nil {
		noteID, err := uuid.Parse(strings.TrimSpace(*req.NoteID))
		if err != nil || noteID == uuid.Nil {
			badRequest(w, "note_id must be a uuid")
			return
		}
		// The note is authorized before it is linked. The composite foreign key
		// would refuse another user's note anyway, but as a 500 — and a 500
		// that only happens for REAL foreign ids is itself the oracle.
		if _, err := h.d.Notes.GetNote(r.Context(), userID, noteID); err != nil {
			h.fail(w, r, err)
			return
		}
		patch.NoteID = &noteID
	}

	hl, err := h.d.Workspaces.UpdateHighlight(r.Context(), userID, id, patch)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, hl)
}

func (h *Handler) deleteHighlight(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := highlightID(w, r)
	if !ok {
		return
	}
	if err := h.d.Workspaces.DeleteHighlight(r.Context(), userID, id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func highlightID(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	userID := httpx.MustUserID(r.Context())
	id, err := uuid.Parse(strings.TrimSpace(r.PathValue("hid")))
	if err != nil || id == uuid.Nil {
		notFound(w)
		return uuid.Nil, uuid.Nil, false
	}
	return userID, id, true
}
