package byokapi

import (
	"errors"
	"net/http"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/oauth"
)

// subscriptions.go — the two-step sign-in lanes (GitHub Copilot, Claude
// Pro/Max). A `start` returns a session handle bound to the caller; a
// `finish` presents it back. Another user's handle is not found.

type finishRequest struct {
	SessionID string `json:"session_id"`
	Name      string `json:"name"`
	Code      string `json:"code"`
}

func (h *Handler) startCopilot(w http.ResponseWriter, r *http.Request) {
	start, err := h.svc.StartCopilot(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		writeSubscriptionErr(w, err, "start copilot sign-in")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, start)
}

func (h *Handler) finishCopilot(w http.ResponseWriter, r *http.Request) {
	var req finishRequest
	if !decode(w, r, &req) {
		return
	}
	conn, err := h.svc.FinishCopilot(r.Context(), httpx.MustUserID(r.Context()), req.SessionID, req.Name)
	if errors.Is(err, oauth.ErrStillPending) {
		// Not a failure: the user has not approved on GitHub yet.
		httpx.WriteJSON(w, http.StatusAccepted, map[string]string{"status": "pending"})
		return
	}
	if err != nil {
		writeSubscriptionErr(w, err, "finish copilot sign-in")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toConnectionResponse(*conn))
}

func (h *Handler) startClaude(w http.ResponseWriter, r *http.Request) {
	start, err := h.svc.StartClaude(httpx.MustUserID(r.Context()))
	if err != nil {
		writeSubscriptionErr(w, err, "start claude sign-in")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, start)
}

func (h *Handler) finishClaude(w http.ResponseWriter, r *http.Request) {
	var req finishRequest
	if !decode(w, r, &req) {
		return
	}
	conn, err := h.svc.FinishClaude(r.Context(), httpx.MustUserID(r.Context()), req.SessionID, req.Code, req.Name)
	if err != nil {
		writeSubscriptionErr(w, err, "finish claude sign-in")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toConnectionResponse(*conn))
}

func writeSubscriptionErr(w http.ResponseWriter, err error, op string) {
	var ue *oauth.UserError
	switch {
	case errors.Is(err, oauth.ErrPendingNotFound):
		httpx.WriteError(w, http.StatusNotFound, "That sign-in expired or was not started here. Start again.", "not_found")
	case errors.As(err, &ue):
		httpx.WriteError(w, http.StatusBadRequest, ue.Msg, "bad_request")
	default:
		writeErr(w, err, op)
	}
}
