package chatapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/learning/ownversion"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
)

type retellRequest struct {
	Text string `json:"text"`
}

// retell stores the learner's "close it and retell" under an answer whose
// question carried their own version (up's screen-off test, attention
// chapter §3). One per answer: saving again replaces it.
//
// The answer is resolved with the caller's id first, so another learner's
// message answers exactly like one that does not exist.
func (h *Handler) retell(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	messageID, ok := pathID(w, r, "id")
	if !ok {
		return
	}

	var req retellRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}
	text, valid := ownversion.NormalizeRetell(req.Text)
	if !valid {
		httpx.WriteError(w, http.StatusBadRequest, "a retell is 1 to 4000 characters", "bad_retell")
		return
	}

	msg, err := h.sessions.GetMessage(r.Context(), userID, messageID)
	if err != nil {
		notFound(w)
		return
	}
	if msg.Role != runtime.RoleAssistant {
		httpx.WriteError(w, http.StatusBadRequest, "only an answer can be retold", "not_an_answer")
		return
	}

	saved := ownversion.Retell{Text: text, WrittenAt: time.Now().UTC().Format(time.RFC3339)}
	raw, _ := json.Marshal(saved)
	if err := h.sessions.SetRetell(r.Context(), userID, messageID, raw); err != nil {
		if errors.Is(err, pg.ErrNoOwnVersion) {
			httpx.WriteError(w, http.StatusBadRequest,
				"a retell belongs under an answer to a question asked with your own version", "no_own_version")
			return
		}
		slog.Error("chatapi: set retell", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "could not save the retell", "store_failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"retell": saved})
}
