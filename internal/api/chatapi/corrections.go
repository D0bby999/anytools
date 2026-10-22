package chatapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/chat"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/vocab"
)

// corrections.go is "Save mistakes to review" under a chat answer
// (the private design notes, phase 3). POST …/corrections asks the
// learner's chat model once for the mistakes the answer corrected; POST
// …/corrections/save keeps the ones they ticked as words to learn, due today.
// Both resolve the answer with the caller's id first, so another learner's
// message answers exactly like one that does not exist.

// CorrectionSaver keeps a correction as a word to learn. vocab.Service
// implements it.
type CorrectionSaver interface {
	SaveCorrection(ctx context.Context, userID uuid.UUID, lang, link string, in vocab.CorrectionInput) (*vocab.Note, bool, error)
}

// WithCorrections enables the two routes. Without it both answer 404.
func (h *Handler) WithCorrections(providers runtime.ChatProviderResolver, saver CorrectionSaver) *Handler {
	h.correctionModels, h.corrections = providers, saver
	return h
}

// historyForCorrections is how far back an answer's question is looked for.
const historyForCorrections = 400

// answerAndQuestion is the caller's answer and the learner message before it.
func (h *Handler) answerAndQuestion(w http.ResponseWriter, r *http.Request, userID uuid.UUID) (*runtime.ChatMessage, string, bool) {
	messageID, ok := pathID(w, r, "id")
	if !ok {
		return nil, "", false
	}
	msg, err := h.sessions.GetMessage(r.Context(), userID, messageID)
	if err != nil {
		notFound(w)
		return nil, "", false
	}
	if msg.Role != runtime.RoleAssistant {
		httpx.WriteError(w, http.StatusBadRequest, "only an answer has corrections", "not_an_answer")
		return nil, "", false
	}
	history, err := h.sessions.History(r.Context(), userID, msg.SessionID, historyForCorrections)
	if err != nil {
		slog.Error("chatapi: corrections history", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "could not read the conversation", "store_failed")
		return nil, "", false
	}
	question := ""
	for _, m := range history {
		if m.ID == msg.ID {
			break
		}
		if m.Role == runtime.RoleUser {
			question = m.Content
		}
	}
	if question == "" {
		httpx.WriteError(w, http.StatusBadRequest, "this answer has no message of yours before it", "no_question")
		return nil, "", false
	}
	return msg, question, true
}

func (h *Handler) findCorrections(w http.ResponseWriter, r *http.Request) {
	if h.correctionModels == nil {
		notFound(w)
		return
	}
	userID := httpx.MustUserID(r.Context())
	msg, question, ok := h.answerAndQuestion(w, r, userID)
	if !ok {
		return
	}
	provider, err := h.correctionModels.ChatFor(r.Context(), userID, "chat")
	if err != nil {
		httpx.WriteError(w, http.StatusConflict, "no model is configured for chat — add one in Settings", "no_provider")
		return
	}
	found, err := chat.ExtractCorrections(r.Context(), provider, provider.DefaultModel(), question, msg.Content, httpx.Language(r.Context()))
	switch {
	case errors.Is(err, chat.ErrBadCorrections):
		httpx.WriteError(w, http.StatusBadGateway, "your model did not return a usable list of mistakes — try again", "bad_model_output")
		return
	case errors.Is(err, runtime.ErrProvider):
		httpx.WriteError(w, http.StatusBadGateway, "your model could not be reached", "provider_failed")
		return
	case err != nil:
		slog.Error("chatapi: corrections", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "could not read the corrections", "internal")
		return
	}
	// The language being practised: the corrected words', which a ticked
	// item is saved in unless the learner says otherwise.
	lang := ""
	if len(found) > 0 {
		lang = vocab.DetectLang(found[0].Right + " " + found[0].Sentence)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"corrections": found, "lang": lang})
}

type saveCorrectionsRequest struct {
	Lang  string                  `json:"lang"`
	Items []vocab.CorrectionInput `json:"items"`
}

func (h *Handler) saveCorrections(w http.ResponseWriter, r *http.Request) {
	if h.corrections == nil {
		notFound(w)
		return
	}
	userID := httpx.MustUserID(r.Context())
	var req saveCorrectionsRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}
	if len(req.Items) == 0 || len(req.Items) > vocab.MaxCorrectionsPerSave {
		httpx.WriteError(w, http.StatusBadRequest, "choose 1 to 10 corrections to save", "bad_request")
		return
	}
	msg, _, ok := h.answerAndQuestion(w, r, userID)
	if !ok {
		return
	}
	link := "/chat/" + msg.SessionID.String()
	notes := make([]*vocab.Note, 0, len(req.Items))
	created := 0
	for _, item := range req.Items {
		note, isNew, err := h.corrections.SaveCorrection(r.Context(), userID, req.Lang, link, item)
		if errors.Is(err, vocab.ErrInvalid) {
			httpx.WriteError(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), "vocab: invalid: "), "bad_request")
			return
		}
		if err != nil {
			slog.Error("chatapi: save correction", "error", err)
			httpx.WriteError(w, http.StatusInternalServerError, "could not save the corrections", "store_failed")
			return
		}
		if isNew {
			created++
		}
		notes = append(notes, note)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"created": created, "notes": notes})
}
