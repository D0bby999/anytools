package readingapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/reading"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/locale"
	"github.com/D0bby999/anytools/internal/runtime"
)

type actionRequest struct {
	Action    string `json:"action"`
	Selection string `json:"selection"`
	Page      int    `json:"page"`
	// At is the playhead, in seconds, for a video document.
	At *int `json:"at"`
}

// action starts a `reading` turn on a selected passage.
//
// It returns as soon as the turn row exists, exactly like chat's POST /turns:
// the client's next call is `GET /v1/turns/{id}/events`, which is chatapi's SSE
// endpoint and serves any capability's turn. There is ONE stream endpoint in
// this product for the same reason there is one document viewer — a second one
// would be a second place resume, replay and terminal frames could be subtly
// wrong.
func (h *Handler) action(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := h.requireWorkspace(w, r)
	if !ok {
		return
	}

	var req actionRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	act, valid := reading.ParseAction(strings.TrimSpace(req.Action))
	if !valid {
		badRequest(w, "action must be one of explain, vocab, quiz, translate")
		return
	}
	selection := strings.TrimSpace(req.Selection)
	if selection == "" && req.At == nil {
		badRequest(w, "select some text first")
		return
	}
	if len([]rune(selection)) > reading.MaxSelectionLen {
		httpx.WriteError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("that selection is too long; select at most %d characters",
				reading.MaxSelectionLen), "selection_too_long")
		return
	}
	if req.Page < 0 {
		badRequest(w, "page cannot be negative")
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

	// One turn at a time per session, the same rule chat enforces. Without it a
	// double-clicked toolbar button starts two provider calls on the user's own
	// key, streaming two answers into one pane.
	busy, err := h.sessionIsBusy(r.Context(), userID, session.ID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if busy {
		httpx.WriteError(w, http.StatusConflict,
			"the tutor is still answering; wait for it to finish", "turn_in_progress")
		return
	}

	action := reading.Request{
		Action:        act,
		Selection:     selection,
		Page:          req.Page,
		DocumentID:    ws.DocumentID.String(),
		DocumentTitle: doc.Title,
		LearnerLang:   locale.FromContext(r.Context()),
	}
	if doc.Timed() {
		// A video's tutor answers from the stored transcript around the
		// playhead, read here on the server; the client's text is only the
		// transcript line shown to the reader.
		if req.At == nil || *req.At < 0 || *req.At > 24*3600 {
			badRequest(w, "a video action needs the moment it is about")
			return
		}
		action.Video, action.At = true, *req.At
		action.AITranscript = doc.TranscriptSource == knowledge.TranscriptAI
		if h.d.Transcripts != nil {
			if t, err := h.d.Transcripts.TranscriptCues(r.Context(), userID, doc.ID); err == nil && t.Timed {
				action.Window = reading.VideoWindow(t.Cues, float64(*req.At))
			}
		}
	} else if selection == "" {
		badRequest(w, "select some text first")
		return
	}

	// The reader-facing form is persisted; the model-facing form (the same
	// selection inside a provenance envelope) is what the turn is given. See
	// reading.Request.TranscriptMessage for why the two differ.
	stored, err := h.d.Sessions.AppendMessage(r.Context(), runtime.ChatMessage{
		UserID:     userID,
		SessionID:  session.ID,
		Role:       runtime.RoleUser,
		Content:    action.TranscriptMessage(),
		Capability: reading.Name,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	_ = h.d.Sessions.TouchSession(r.Context(), userID, session.ID)

	turn, err := h.d.Orch.Run(r.Context(), runtime.StartTurn{
		Session:        *session,
		Capability:     reading.Name,
		Input:          action.Prompt(),
		InputMessageID: stored.ID,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}

	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{
		"turn_id":    turn.ID.String(),
		"session_id": session.ID.String(),
		"status":     turn.Status,
		"action":     string(act),
	})
}

// session returns the workspace's chat session, creating it on first action.
//
// Lazily, not with the workspace: opening a document to read it should not
// manufacture an empty conversation in the sidebar. AttachSession only writes
// when the column is still null, so two actions fired at once end up sharing
// whichever session won — and the loser's session is a row with no turns rather
// than a second conversation that silently swallows one of the answers.
func (h *Handler) session(
	ctx context.Context, userID uuid.UUID, ws *reading.Workspace, title string,
) (*runtime.Session, error) {
	if ws.SessionID != nil {
		session, err := h.d.Sessions.GetSession(ctx, userID, *ws.SessionID)
		if err == nil {
			return session, nil
		}
		// The session was deleted from the chat page; the column is already
		// NULL by the foreign key's ON DELETE SET NULL, so fall through and
		// make a new one rather than failing the reader's click.
	}

	name := strings.TrimSpace(title)
	if name == "" {
		name = "a document"
	}
	created, err := h.d.Sessions.CreateSession(ctx, runtime.Session{
		UserID: userID,
		Title:  "Reading: " + name,
		// No knowledge bases and no web. A reading turn answers from the
		// selected passage; mounting retrieval or the network on a turn whose
		// context is untrusted document text would reopen the exfiltration path
		// phase 6 closed.
		KBIDs:    []uuid.UUID{},
		AllowWeb: false,
	})
	if err != nil {
		return nil, err
	}

	updated, err := h.d.Workspaces.AttachSession(ctx, userID, ws.ID, created.ID)
	if err != nil {
		return nil, err
	}
	if updated.SessionID != nil && *updated.SessionID != created.ID {
		// Another request won the race. Use the session that was stored, so
		// both answers land in one conversation.
		return h.d.Sessions.GetSession(ctx, userID, *updated.SessionID)
	}
	return created, nil
}

func (h *Handler) sessionIsBusy(ctx context.Context, userID, sessionID uuid.UUID) (bool, error) {
	turns, err := h.d.Sessions.ListTurns(ctx, userID, sessionID, 10)
	if err != nil {
		return false, err
	}
	for _, t := range turns {
		if !t.Terminal() {
			return true, nil
		}
	}
	return false, nil
}
