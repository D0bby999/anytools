package notebookapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/notebook"
)

// noteRequest is the body of a note create or patch.
//
// There is deliberately NO `created_by` field. Authorship is written by the
// code path that knows — this package always writes "user", the `write_note`
// tool always writes "agent" — and a request body that could set it would let
// anything with a session claim the model's notes as the reader's own, which is
// the one fact phase 10's evidence loop reads this column for.
type noteRequest struct {
	Title       *string          `json:"title"`
	BodyMD      *string          `json:"body_md"`
	Source      *notebook.Source `json:"source"`
	CategoryIDs *[]uuid.UUID     `json:"category_ids"`
}

func (h *Handler) listNotes(w http.ResponseWriter, r *http.Request) {
	userID, notebookID, ok := ident(w, r)
	if !ok {
		return
	}
	if _, err := h.svc.GetNotebook(r.Context(), userID, notebookID); err != nil {
		h.fail(w, r, err)
		return
	}
	filter, ok := noteFilter(w, r)
	if !ok {
		return
	}
	notes, err := h.svc.ListNotes(r.Context(), userID, notebookID, filter)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"notes": notes})
}

// searchNotes lists a user's notes ACROSS notebooks.
//
// It is what the reading pane asks for — "the notes I already took on this
// document" — and it is the reason NoteFilter has a DocumentID at all. Without
// it the pane would have to fetch every notebook and filter client-side, which
// is both slow and a way to leak a note's existence through timing.
func (h *Handler) searchNotes(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	filter, ok := noteFilter(w, r)
	if !ok {
		return
	}
	notes, err := h.svc.ListNotes(r.Context(), userID, uuid.Nil, filter)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"notes": notes})
}

func noteFilter(w http.ResponseWriter, r *http.Request) (notebook.NoteFilter, bool) {
	f := notebook.NoteFilter{Limit: limitParam(r, 200)}
	if raw := r.URL.Query().Get("document_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			badRequest(w, "document_id must be a uuid")
			return f, false
		}
		f.DocumentID = &id
	}
	if raw := r.URL.Query().Get("category_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			badRequest(w, "category_id must be a uuid")
			return f, false
		}
		f.CategoryID = &id
	}
	return f, true
}

func (h *Handler) createNote(w http.ResponseWriter, r *http.Request) {
	userID, notebookID, ok := ident(w, r)
	if !ok {
		return
	}
	// The notebook is authorized before the note is built, so a foreign
	// notebook id fails as 404 rather than as a foreign-key error at write time.
	if _, err := h.svc.GetNotebook(r.Context(), userID, notebookID); err != nil {
		h.fail(w, r, err)
		return
	}

	var req noteRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}

	in := notebook.NewNote{
		NotebookID: notebookID,
		Title:      deref(req.Title),
		BodyMD:     deref(req.BodyMD),
		CreatedBy:  notebook.CreatedByUser,
	}
	if req.Source != nil {
		in.Source = *req.Source
	}
	if req.CategoryIDs != nil {
		in.CategoryIDs = *req.CategoryIDs
	}

	note, err := h.svc.CreateNote(r.Context(), userID, in)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, note)
}

func (h *Handler) getNote(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := ident(w, r)
	if !ok {
		return
	}
	note, err := h.svc.GetNote(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, note)
}

func (h *Handler) patchNote(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := ident(w, r)
	if !ok {
		return
	}
	var req noteRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	note, err := h.svc.UpdateNote(r.Context(), userID, id, notebook.NotePatch{
		Title:       req.Title,
		BodyMD:      req.BodyMD,
		CategoryIDs: req.CategoryIDs,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, note)
}

func (h *Handler) deleteNote(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := ident(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteNote(r.Context(), userID, id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type destinationRequest struct {
	NotebookID string `json:"notebook_id"`
}

func (h *Handler) moveNote(w http.ResponseWriter, r *http.Request) {
	userID, id, target, ok := h.destination(w, r)
	if !ok {
		return
	}
	note, err := h.svc.MoveNote(r.Context(), userID, id, target)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, note)
}

func (h *Handler) copyNote(w http.ResponseWriter, r *http.Request) {
	userID, id, target, ok := h.destination(w, r)
	if !ok {
		return
	}
	note, err := h.svc.CopyNote(r.Context(), userID, id, target)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, note)
}

// destination parses a move/copy target and checks the caller owns it.
//
// The ownership check is here rather than left to the store's foreign key: a
// destination belonging to another user has to be a 404 like every other
// unowned id, and a constraint violation would surface as a 500 that also says,
// by its very difference, that the id was real.
func (h *Handler) destination(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, uuid.UUID, bool) {
	userID, id, ok := ident(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	var req destinationRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	target, err := uuid.Parse(req.NotebookID)
	if err != nil || target == uuid.Nil {
		badRequest(w, "notebook_id must be a uuid")
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	if _, err := h.svc.GetNotebook(r.Context(), userID, target); err != nil {
		h.fail(w, r, err)
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	return userID, id, target, true
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
