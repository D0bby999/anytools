package chatapi

import (
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// maxFeedbackComment caps a Dislike's comment, as the table does.
const maxFeedbackComment = 2000

// FeedbackJSON is the wire shape of one rating. The provider and model are
// returned so the learner can see which model they rated; they are never read
// from a request.
type FeedbackJSON struct {
	MessageID string    `json:"message_id"`
	Rating    string    `json:"rating"`
	Category  string    `json:"category,omitempty"`
	Comment   string    `json:"comment,omitempty"`
	Provider  string    `json:"provider,omitempty"`
	Model     string    `json:"model,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

func feedbackJSON(f pg.ChatFeedback) FeedbackJSON {
	return FeedbackJSON{
		MessageID: f.MessageID.String(), Rating: f.Rating, Category: f.Category, Comment: f.Comment,
		Provider: f.Provider, Model: f.Model, UpdatedAt: f.UpdatedAt,
	}
}

type feedbackRequest struct {
	Rating   string `json:"rating"`
	Category string `json:"category"`
	Comment  string `json:"comment"`
}

// listFeedback returns the caller's ratings in one of their conversations.
func (h *Handler) listFeedback(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	sessionID, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if _, err := h.sessions.GetSession(r.Context(), userID, sessionID); err != nil {
		notFound(w)
		return
	}
	list, err := h.sessions.ListFeedback(r.Context(), userID, sessionID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "could not read the ratings", "list_failed")
		return
	}
	out := make([]FeedbackJSON, 0, len(list))
	for _, f := range list {
		out = append(out, feedbackJSON(f))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"feedback": out})
}

// putFeedback records or replaces the caller's rating of one answer. A Like
// carries no reason; a Dislike may carry one of pg.FeedbackCategories and a
// comment.
func (h *Handler) putFeedback(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	messageID, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	// The answer first: another user's message is a 404 whatever the body
	// says, so a refusal never tells a stranger which ids exist.
	if m, err := h.sessions.GetMessage(r.Context(), userID, messageID); err != nil || m.Role != runtime.RoleAssistant {
		notFound(w)
		return
	}
	var req feedbackRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}
	comment := strings.TrimSpace(req.Comment)
	switch {
	case req.Rating != "good" && req.Rating != "bad":
		httpx.WriteError(w, http.StatusBadRequest, "a rating is good or bad", "bad_rating")
		return
	case req.Rating == "good" && (req.Category != "" || comment != ""):
		httpx.WriteError(w, http.StatusBadRequest, "a good rating takes no reason", "bad_rating")
		return
	case req.Category != "" && !slices.Contains(pg.FeedbackCategories, req.Category):
		httpx.WriteError(w, http.StatusBadRequest, "unknown reason", "bad_category")
		return
	case utf8.RuneCountInString(comment) > maxFeedbackComment:
		httpx.WriteError(w, http.StatusBadRequest, "a comment is at most 2000 characters", "bad_comment")
		return
	}
	f, err := h.sessions.PutFeedback(r.Context(), userID, messageID, req.Rating, req.Category, comment)
	if errors.Is(err, pg.ErrNotAnAnswer) {
		notFound(w)
		return
	}
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "could not record the rating", "put_failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, feedbackJSON(*f))
}

// deleteFeedback retracts the caller's rating of one answer.
func (h *Handler) deleteFeedback(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	messageID, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	err := h.sessions.DeleteFeedback(r.Context(), userID, messageID)
	if errors.Is(err, pg.ErrNotAnAnswer) {
		notFound(w)
		return
	}
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "could not retract the rating", "delete_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
