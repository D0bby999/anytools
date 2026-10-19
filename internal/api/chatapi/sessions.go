package chatapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// maxTitle caps a session title. A title is rendered in the rail and echoed in
// page titles; there is no reason for it to be a paragraph.
const maxTitle = 200

// SessionJSON is the wire shape of a session.
type SessionJSON struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	KBIDs     []string `json:"kb_ids"`
	ModelHint string   `json:"model_hint,omitempty"`
	// ConnectionID is the connection picked for this conversation, if any.
	ConnectionID string    `json:"connection_id,omitempty"`
	AllowWeb     bool      `json:"allow_web"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func sessionJSON(s runtime.Session) SessionJSON {
	ids := make([]string, 0, len(s.KBIDs))
	for _, id := range s.KBIDs {
		ids = append(ids, id.String())
	}
	out := SessionJSON{
		ID: s.ID.String(), Title: s.Title, KBIDs: ids, ModelHint: s.ModelHint,
		AllowWeb: s.AllowWeb, CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt,
	}
	if s.ConnectionID != nil {
		out.ConnectionID = s.ConnectionID.String()
	}
	return out
}

type createSessionRequest struct {
	Title     string   `json:"title"`
	KBIDs     []string `json:"kb_ids"`
	ModelHint string   `json:"model_hint"`
}

func (h *Handler) createSession(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())

	var req createSessionRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}

	kbIDs, ok := h.parseAndAuthorizeKBs(w, r.Context(), userID, req.KBIDs)
	if !ok {
		return
	}

	sess, err := h.sessions.CreateSession(r.Context(), runtime.Session{
		UserID:    userID,
		Title:     trimTitle(req.Title),
		KBIDs:     kbIDs,
		ModelHint: strings.TrimSpace(req.ModelHint),
	})
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "could not create the session", "create_failed")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, sessionJSON(*sess))
}

func (h *Handler) listSessions(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	query = trimTitle(query)
	sessions, err := h.sessions.ListSessions(r.Context(), userID, limitParam(r, 50), query)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "could not list sessions", "list_failed")
		return
	}
	out := make([]SessionJSON, 0, len(sessions))
	for _, s := range sessions {
		out = append(out, sessionJSON(s))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"sessions": out})
}

func (h *Handler) getSession(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	sessionID, ok := pathID(w, r, "id")
	if !ok {
		return
	}

	sess, err := h.sessions.GetSession(r.Context(), userID, sessionID)
	if err != nil {
		notFound(w)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, sessionJSON(*sess))
}

type patchSessionRequest struct {
	Title     *string   `json:"title"`
	KBIDs     *[]string `json:"kb_ids"`
	ModelHint *string   `json:"model_hint"`
	AllowWeb  *bool     `json:"allow_web"`
	// ConnectionID pins a connection of the caller's chat route to this
	// conversation; "" unpins it.
	ConnectionID *string `json:"connection_id"`
}

func (h *Handler) patchSession(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	sessionID, ok := pathID(w, r, "id")
	if !ok {
		return
	}

	var req patchSessionRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}

	patch := pg.SessionPatch{ModelHint: req.ModelHint, AllowWeb: req.AllowWeb}
	if req.Title != nil {
		t := trimTitle(*req.Title)
		patch.Title = &t
	}
	if req.KBIDs != nil {
		kbIDs, ok := h.parseAndAuthorizeKBs(w, r.Context(), userID, *req.KBIDs)
		if !ok {
			return
		}
		patch.KBIDs = &kbIDs
	}
	if req.ConnectionID != nil {
		if *req.ConnectionID == "" {
			patch.ClearConnection = true
		} else {
			id, err := uuid.Parse(*req.ConnectionID)
			// Not on the caller's chat route, someone else's, or not an id:
			// all three answer as a connection that does not exist.
			if err != nil || h.connections == nil {
				notFound(w)
				return
			}
			on, err := h.connections.OnChatRoute(r.Context(), userID, id)
			if err != nil {
				httpx.WriteError(w, http.StatusInternalServerError, "could not check the connection", "check_failed")
				return
			}
			if !on {
				notFound(w)
				return
			}
			patch.ConnectionID = &id
		}
	}

	sess, err := h.sessions.UpdateSession(r.Context(), userID, sessionID, patch)
	if err != nil {
		// Only a genuine miss is a 404. Reporting a database failure as "not
		// found" tells the user their session is gone when it is not, and hides
		// the outage from whoever reads the logs.
		if isMissing(err) {
			notFound(w)
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "could not update the session", "update_failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, sessionJSON(*sess))
}

func (h *Handler) deleteSession(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	sessionID, ok := pathID(w, r, "id")
	if !ok {
		return
	}

	// Stop anything still running in this session BEFORE the rows go. The
	// delete cascades the turn away while its goroutine is still calling the
	// provider; that goroutine's terminal write then matches nothing and its
	// event append fails on a foreign key, logged and otherwise invisible.
	h.cancelLiveTurns(r.Context(), userID, sessionID)

	if err := h.sessions.DeleteSession(r.Context(), userID, sessionID); err != nil {
		if isMissing(err) {
			notFound(w)
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "could not delete the session", "delete_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// cancelLiveTurns cancels every non-terminal turn of a session this process is
// running. Best effort: a turn running in a process that is gone is not
// cancellable here, and the cascade removes its row anyway.
func (h *Handler) cancelLiveTurns(ctx context.Context, userID, sessionID uuid.UUID) {
	turns, err := h.sessions.ListTurns(ctx, userID, sessionID, 50)
	if err != nil {
		return
	}
	for _, t := range turns {
		if !t.Terminal() {
			h.orch.Buses().Cancel(t.ID)
		}
	}
}

// MessageJSON is the wire shape of a transcript message.
type MessageJSON struct {
	ID          string    `json:"id"`
	Role        string    `json:"role"`
	Content     string    `json:"content"`
	Capability  string    `json:"capability,omitempty"`
	Attachments any       `json:"attachments,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// TurnJSON is the wire shape of a turn row.
type TurnJSON struct {
	ID          string `json:"id"`
	Status      string `json:"status"`
	FailureCode string `json:"failure_code,omitempty"`
	Retryable   bool   `json:"retryable,omitempty"`
	Error       string `json:"error,omitempty"`
	Provider    string `json:"provider,omitempty"`
	Model       string `json:"model,omitempty"`
	Capability  string `json:"capability"`
}

func turnJSON(t runtime.Turn) TurnJSON {
	return TurnJSON{
		ID: t.ID.String(), Status: t.Status, FailureCode: t.FailureCode,
		Retryable: t.Retryable, Error: t.Error, Provider: t.Provider,
		Model: t.Model, Capability: t.Capability,
	}
}

func (h *Handler) listMessages(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	sessionID, ok := pathID(w, r, "id")
	if !ok {
		return
	}

	// Confirm the session belongs to the caller before reading its children.
	// The message query filters on user_id too, so this is defence in depth
	// rather than the only check — but without it an unknown session id would
	// answer 200 with an empty list, which is itself an existence signal.
	if _, err := h.sessions.GetSession(r.Context(), userID, sessionID); err != nil {
		notFound(w)
		return
	}

	msgs, err := h.sessions.History(r.Context(), userID, sessionID, limitParam(r, 100))
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "could not load the conversation", "history_failed")
		return
	}
	turns, err := h.sessions.ListTurns(r.Context(), userID, sessionID, 20)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "could not load the conversation", "history_failed")
		return
	}

	outMsgs := make([]MessageJSON, 0, len(msgs))
	for _, m := range msgs {
		outMsgs = append(outMsgs, MessageJSON{
			ID: m.ID.String(), Role: m.Role, Content: m.Content,
			Capability: m.Capability, Attachments: rawJSON(m.Attachments),
			CreatedAt: m.CreatedAt,
		})
	}
	outTurns := make([]TurnJSON, 0, len(turns))
	for _, t := range turns {
		outTurns = append(outTurns, turnJSON(t))
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"messages": outMsgs, "turns": outTurns})
}

// parseAndAuthorizeKBs validates every kb id a client sends.
//
// A nil authorizer refuses rather than accepts: until phase 5 wires one, a
// session that names a knowledge base is a session whose ownership claim
// nothing has checked, and storing it would mean the tools' own gate is the
// first and only check — for ids that are already in the database looking
// legitimate.
func (h *Handler) parseAndAuthorizeKBs(
	w http.ResponseWriter, ctx context.Context, userID uuid.UUID, raw []string,
) ([]uuid.UUID, bool) {
	ids, serr := h.authorizeKBs(ctx, userID, raw)
	if serr != nil {
		httpx.WriteError(w, serr.Status, serr.Message, serr.Code)
		return nil, false
	}
	return ids, true
}

// authorizeKBs is parseAndAuthorizeKBs without the response writer, so Start
// (solve, research) applies the identical check.
func (h *Handler) authorizeKBs(ctx context.Context, userID uuid.UUID, raw []string) ([]uuid.UUID, *StartError) {
	if len(raw) == 0 {
		return []uuid.UUID{}, nil
	}
	if h.authz == nil {
		return nil, &StartError{http.StatusBadRequest, "knowledge bases are not available yet", "kb_unavailable"}
	}

	out := make([]uuid.UUID, 0, len(raw))
	for _, s := range raw {
		id, err := uuid.Parse(strings.TrimSpace(s))
		if err != nil {
			return nil, &StartError{http.StatusNotFound, "not found", "not_found"}
		}
		owns, err := h.authz.OwnsKB(ctx, userID, id)
		if err != nil {
			return nil, &StartError{http.StatusInternalServerError,
				"could not check knowledge base access", "authz_failed"}
		}
		if !owns {
			// Same 404 as a malformed id: "that KB is not yours" and "there is
			// no such KB" must look identical from outside.
			return nil, &StartError{http.StatusNotFound, "not found", "not_found"}
		}
		out = append(out, id)
	}
	return out, nil
}

// trimTitle cuts on a RUNE boundary. A title is user text in a `text` column,
// and this product carries Vietnamese by design — slicing bytes splits a rune
// and Postgres rejects the whole INSERT.
func trimTitle(s string) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > maxTitle {
		s = string(r[:maxTitle])
	}
	return s
}

// autoTitleRunes is how long a title taken from a question may be.
const autoTitleRunes = 60

// titleFromQuestion names an untitled conversation after its first question:
// the first line, whitespace collapsed, cut at a word boundary. No model call:
// the question is already the best short description there is, and it costs
// the learner nothing.
func titleFromQuestion(message string) string {
	line := message
	if i := strings.IndexByte(line, '\n'); i >= 0 {
		line = line[:i]
	}
	line = strings.Join(strings.Fields(line), " ")
	r := []rune(line)
	if len(r) <= autoTitleRunes {
		return line
	}
	cut := string(r[:autoTitleRunes])
	if i := strings.LastIndexByte(cut, ' '); i > autoTitleRunes/2 {
		cut = cut[:i]
	}
	return strings.TrimRight(cut, " ,.;:") + "…"
}

// rawJSON passes a stored jsonb column straight through to the response
// without a round trip through a Go map.
func rawJSON(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return jsonRaw(b)
}

type jsonRaw []byte

func (r jsonRaw) MarshalJSON() ([]byte, error) {
	if len(r) == 0 {
		return []byte("null"), nil
	}
	return r, nil
}
