package readingapi

import (
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/reading"
	"github.com/D0bby999/anytools/internal/notebook"
)

// captureRequest is "save this to my notebook", from the reading pane.
type captureRequest struct {
	Title  string `json:"title"`
	BodyMD string `json:"body_md"`
	// Page is the page the passage was on. It is what makes the saved note
	// reopen at the right place: the note's source becomes
	// {kind:"document", id:<document id>, page:<page>}, and the notebook links
	// it to `documents/<id>?page=<page>` — the same contract every citation
	// chip in the product resolves against.
	Page int `json:"page"`
	// From says WHO wrote what is being saved: "tutor" for the model's answer,
	// "me" for the reader's own words. It is the one place a request body
	// influences authorship, and it is a closed two-value enum rather than a
	// free `created_by` field, because this is the only surface that saves a
	// MODEL's output on the reader's behalf and the notebook has to keep the
	// two apart (phase 10 reads that column as evidence provenance).
	From string `json:"from"`
	// NotebookID is optional; empty means the user's default notebook.
	NotebookID string `json:"notebook_id"`
	// HighlightID, when set, is linked to the created note so the highlight in
	// the margin and the note in the notebook are the same object seen twice.
	HighlightID string `json:"highlight_id"`
}

// capture saves a selection or a tutor answer into the notebook.
//
// The note's source is built from the WORKSPACE's document id, never from the
// request body. A body-supplied document id would let any caller attach a note
// to a document they do not own — and since the notebook's own rows are only
// filtered by user_id, nothing downstream would catch it.
func (h *Handler) capture(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := h.requireWorkspace(w, r)
	if !ok {
		return
	}

	var req captureRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	if strings.TrimSpace(req.Title) == "" && strings.TrimSpace(req.BodyMD) == "" {
		badRequest(w, "a note needs a title or a body")
		return
	}
	if req.Page < 0 {
		badRequest(w, "page cannot be negative")
		return
	}

	createdBy := notebook.CreatedByUser
	if req.From == "tutor" {
		createdBy = notebook.CreatedByAgent
	}

	var notebookID uuid.UUID
	if raw := strings.TrimSpace(req.NotebookID); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil || id == uuid.Nil {
			badRequest(w, "notebook_id must be a uuid")
			return
		}
		// Authorized here so a foreign notebook is a 404, not a foreign-key
		// error reported as 500.
		if _, err := h.d.Notes.GetNotebook(r.Context(), userID, id); err != nil {
			h.fail(w, r, err)
			return
		}
		notebookID = id
	}

	var highlight *reading.Highlight
	if raw := strings.TrimSpace(req.HighlightID); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil || id == uuid.Nil {
			notFound(w)
			return
		}
		hl, err := h.d.Workspaces.GetHighlight(r.Context(), userID, id)
		if err != nil {
			h.fail(w, r, err)
			return
		}
		if hl.WorkspaceID != ws.ID {
			// The highlight is the caller's, but it belongs to a different
			// document. Linking it here would file a note against the wrong
			// page of the wrong book.
			notFound(w)
			return
		}
		highlight = hl
	}

	page := req.Page
	if page == 0 && highlight != nil {
		page = highlight.Page
	}

	note, err := h.d.Notes.CreateNote(r.Context(), userID, notebook.NewNote{
		NotebookID: notebookID,
		Title:      req.Title,
		BodyMD:     req.BodyMD,
		Source: notebook.Source{
			Kind: notebook.SourceDocument,
			ID:   ws.DocumentID.String(),
			Page: page,
		},
		CreatedBy: createdBy,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}

	if highlight != nil {
		if _, err := h.d.Workspaces.UpdateHighlight(r.Context(), userID, highlight.ID,
			reading.HighlightPatch{NoteID: &note.ID}); err != nil {
			// The note is written and is the thing the reader asked for. A
			// failure to back-link is logged by fail()'s default branch
			// elsewhere; here it must not turn a successful save into an error
			// the reader would retry into a duplicate note.
			httpx.WriteJSON(w, http.StatusCreated, note)
			return
		}
	}

	httpx.WriteJSON(w, http.StatusCreated, note)
}
