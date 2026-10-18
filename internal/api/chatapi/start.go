package chatapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/runtime"
)

// StartRequest is a turn another feature's API starts on a chat session:
// solve and research (phase 9) run as turns on the same sessions, so they get
// the same transcript, lease, stream, cancel and recovery as chat without a
// second copy of any of it.
type StartRequest struct {
	// SessionID continues an existing session; uuid.Nil creates one.
	SessionID uuid.UUID
	// Title, KBIDs and AllowWeb describe a NEW session and are ignored for an
	// existing one — an existing session's knowledge bases and web consent are
	// changed through PATCH, where they are visible, not as a side effect of
	// asking a question.
	Title    string
	KBIDs    []string
	AllowWeb bool

	Capability  string
	Message     string
	Attachments []byte
	Images      []runtime.Image
	Params      map[string]string
}

// StartError is a refusal with the status and code the calling handler writes.
type StartError struct {
	Status  int
	Message string
	Code    string
}

func (e *StartError) Error() string { return e.Message }

// Start creates or loads the session, then starts the turn exactly as chat's
// own POST does. Every id is checked against the caller: a session that is not
// theirs is a 404, and a new session's knowledge bases are authorized before
// the row is written.
func (h *Handler) Start(ctx context.Context, userID uuid.UUID, req StartRequest) (*runtime.Session, *runtime.Turn, *StartError) {
	var sess *runtime.Session
	if req.SessionID != uuid.Nil {
		existing, err := h.sessions.GetSession(ctx, userID, req.SessionID)
		if err != nil {
			return nil, nil, &StartError{http.StatusNotFound, "not found", "not_found"}
		}
		sess = existing
	} else {
		kbIDs, serr := h.authorizeKBs(ctx, userID, req.KBIDs)
		if serr != nil {
			return nil, nil, serr
		}
		created, err := h.sessions.CreateSession(ctx, runtime.Session{
			UserID:   userID,
			Title:    trimTitle(req.Title),
			KBIDs:    kbIDs,
			AllowWeb: req.AllowWeb,
		})
		if err != nil {
			return nil, nil, &StartError{http.StatusInternalServerError, "could not create the session", "create_failed"}
		}
		sess = created
	}

	message := strings.TrimSpace(req.Message)
	if len(message) > maxInput {
		return nil, nil, &StartError{http.StatusRequestEntityTooLarge, "that message is too long", "message_too_long"}
	}
	turn, serr := h.begin(ctx, userID, *sess, req.Capability, message, req.Attachments, req.Images, req.Params)
	if serr != nil {
		return nil, nil, serr
	}
	return sess, turn, nil
}
