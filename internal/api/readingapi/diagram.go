package readingapi

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/visualizeapi"
	"github.com/D0bby999/anytools/internal/capabilities/reading"
)

type diagramRequest struct {
	Selection string `json:"selection"`
	Request   string `json:"request"`
}

// diagram draws a selected passage ("Draw it" on the selection toolbar) and
// appends the diagram to the workspace's conversation, where the tutor pane
// shows it like any answer. The workspace is resolved with the caller's id
// first, so another user's workspace answers 404 before any model call.
func (h *Handler) diagram(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := h.requireWorkspace(w, r)
	if !ok {
		return
	}
	var req diagramRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	selection := strings.TrimSpace(req.Selection)
	if selection == "" {
		badRequest(w, "select some text first")
		return
	}
	if len([]rune(selection)) > reading.MaxSelectionLen {
		httpx.WriteError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("that selection is too long; select at most %d characters", reading.MaxSelectionLen),
			"selection_too_long")
		return
	}
	doc, err := h.d.Documents.GetDocument(r.Context(), userID, ws.DocumentID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	session, err := h.session(r.Context(), userID, ws, doc.Title)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	res, err := h.d.Diagrams.DrawSelection(r.Context(), userID, session.ID, doc.Title, selection, req.Request)
	if err != nil {
		visualizeapi.Fail(w, r, err)
		return
	}
	_ = h.d.Sessions.TouchSession(r.Context(), userID, session.ID)
	visualizeapi.Write(w, http.StatusCreated, res)
}
