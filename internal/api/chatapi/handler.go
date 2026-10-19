// Package chatapi is the HTTP surface of grounded chat: sessions, history,
// turns, the event stream, cancel and answer.
//
// Every handler reads the caller's identity from httpx.UserID(ctx) and passes
// it into the store, which filters on it in SQL. No handler in this package
// takes a user id from a path, a query or a body — see docs/architecture.md,
// "One authentication chokepoint".
package chatapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// SessionStore is the persistence this handler needs. It is defined here, next
// to its consumer; pg.ChatStore implements it.
type SessionStore interface {
	CreateSession(ctx context.Context, s runtime.Session) (*runtime.Session, error)
	GetSession(ctx context.Context, userID, sessionID uuid.UUID) (*runtime.Session, error)
	ListSessions(ctx context.Context, userID uuid.UUID, limit int, query string) ([]runtime.Session, error)
	UpdateSession(ctx context.Context, userID, sessionID uuid.UUID, patch pg.SessionPatch) (*runtime.Session, error)
	DeleteSession(ctx context.Context, userID, sessionID uuid.UUID) error
	TouchSession(ctx context.Context, userID, sessionID uuid.UUID) error
	SetTitleIfEmpty(ctx context.Context, userID, sessionID uuid.UUID, title string) error
	RewindTo(ctx context.Context, userID, sessionID, messageID uuid.UUID) (*runtime.ChatMessage, error)

	AppendMessage(ctx context.Context, m runtime.ChatMessage) (*runtime.ChatMessage, error)
	History(ctx context.Context, userID, sessionID uuid.UUID, limit int) ([]runtime.ChatMessage, error)
	ListTurns(ctx context.Context, userID, sessionID uuid.UUID, limit int) ([]runtime.Turn, error)

	GetMessage(ctx context.Context, userID, messageID uuid.UUID) (*runtime.ChatMessage, error)
	SetRetell(ctx context.Context, userID, messageID uuid.UUID, retell []byte) error
}

// TurnReader is the read half of turn persistence: the row and its event log.
type TurnReader interface {
	GetTurn(ctx context.Context, userID, turnID uuid.UUID) (*runtime.Turn, error)
	EventsAfter(ctx context.Context, userID, turnID uuid.UUID, afterSeq int64, limit int) ([]runtime.Event, error)
	SetStatus(ctx context.Context, turnID uuid.UUID, from []string, to string, upd runtime.TurnUpdate) (*runtime.Turn, error)
}

// KBAuthorizer checks knowledge-base ownership when a session names KBs.
//
// It is the WRITE-side half of the pair; the tools re-check on every call
// (internal/tools). Checking here alone would let a KB unshared after the
// session was created keep being searched; checking only in the tools would let
// a user store a foreign id and see it listed back in the UI as if it were
// theirs. Both, at both times.
type KBAuthorizer interface {
	OwnsKB(ctx context.Context, userID, kbID uuid.UUID) (bool, error)
}

// Handler serves the chat API.
type Handler struct {
	sessions SessionStore
	turns    TurnReader
	orch     *runtime.Orchestrator
	authz    KBAuthorizer
	// ownVersion reads the learner's "write your own version first" switch;
	// nil reads it as off.
	ownVersion  OwnVersionSetting
	connections ChatConnections
}

// OwnVersionSetting reads "write your own version first" (up-methods phase
// 11). pg.UserStore implements it.
// ChatConnections answers whether a connection is on the caller's chat
// route: the only connections a conversation may be pinned to.
type ChatConnections interface {
	OnChatRoute(ctx context.Context, userID, connectionID uuid.UUID) (bool, error)
}

// WithChatConnections enables pinning a connection to a conversation.
// Without it every pin is refused.
func (h *Handler) WithChatConnections(c ChatConnections) *Handler {
	h.connections = c
	return h
}

type OwnVersionSetting interface {
	OwnVersionFirst(ctx context.Context, userID uuid.UUID) (bool, error)
}

// WithOwnVersion makes chat turns enforce the learner's switch.
func (h *Handler) WithOwnVersion(s OwnVersionSetting) *Handler {
	h.ownVersion = s
	return h
}

// NewHandler builds the handler. A nil KBAuthorizer means "no knowledge-base
// subsystem is wired yet" (phase 5 lands it) and REFUSES every session that
// names a KB, rather than accepting ids it cannot verify.
func NewHandler(sessions SessionStore, turns TurnReader, orch *runtime.Orchestrator, authz KBAuthorizer) *Handler {
	return &Handler{sessions: sessions, turns: turns, orch: orch, authz: authz}
}

// RegisterRoutes registers this package's patterns on the mux.
//
// Every pattern must also appear in api.RegisteredPatterns(); a structural test
// greps this file and fails in both directions, so a route cannot ship without
// the authentication test covering it.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/chat/sessions", h.createSession) // budget: none
	mux.HandleFunc("GET /v1/chat/sessions", h.listSessions)
	mux.HandleFunc("GET /v1/chat/sessions/{id}", h.getSession)
	mux.HandleFunc("PATCH /v1/chat/sessions/{id}", h.patchSession)   // budget: none
	mux.HandleFunc("DELETE /v1/chat/sessions/{id}", h.deleteSession) // budget: none
	mux.HandleFunc("GET /v1/chat/sessions/{id}/messages", h.listMessages)
	mux.HandleFunc("POST /v1/chat/sessions/{id}/turns", h.createTurn) // budget: generate
	mux.HandleFunc("GET /v1/turns/{id}/events", h.streamEvents)
	mux.HandleFunc("POST /v1/turns/{id}/cancel", h.cancelTurn)     // budget: none
	mux.HandleFunc("POST /v1/turns/{id}/answer", h.answerTurn)     // budget: none
	mux.HandleFunc("POST /v1/chat/messages/{id}/retell", h.retell) // budget: none
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"POST /v1/chat/sessions",
		"GET /v1/chat/sessions",
		"GET /v1/chat/sessions/{id}",
		"PATCH /v1/chat/sessions/{id}",
		"DELETE /v1/chat/sessions/{id}",
		"GET /v1/chat/sessions/{id}/messages",
		"POST /v1/chat/sessions/{id}/turns",
		"GET /v1/turns/{id}/events",
		"POST /v1/turns/{id}/cancel",
		"POST /v1/turns/{id}/answer",
		"POST /v1/chat/messages/{id}/retell",
	}
}

// pathID reads a uuid path value, answering 404 for anything malformed.
//
// 404 and not 400: a request for a badly formed id and a request for another
// user's id must be indistinguishable, or the error code itself tells an
// attacker which of their guesses were well-formed.
func pathID(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(strings.TrimSpace(r.PathValue(name)))
	if err != nil || id == uuid.Nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return uuid.Nil, false
	}
	return id, true
}

func limitParam(r *http.Request, def int) int {
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

// notFound is the single answer for "no such row for this user". Distinguishing
// "does not exist" from "not yours" is an existence oracle for other people's
// sessions.
func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
}

func isMissing(err error) bool {
	return errors.Is(err, pg.ErrSessionNotFound) || errors.Is(err, runtime.ErrTurnNotFound)
}
