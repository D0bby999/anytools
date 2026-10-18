package readingapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/reading"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/vocab"
)

// PageTexts reads the text the server stored for a workspace's page.
// reading.PageLoader implements it.
type PageTexts interface {
	WorkspacePage(ctx context.Context, userID, workspaceID uuid.UUID, page int) (uuid.UUID, string, error)
}

type termsRequest struct {
	Selection string `json:"selection"`
	Page      int    `json:"page"`
}

// terms is "Find words to save": the structured half of the vocab action.
//
// It bills one model call on the learner's `reading` route, so the selection
// is checked against the stored page FIRST — a passage that is not in the
// document is refused before anything is spent, and the save that follows
// would refuse it anyway. The terms that come back have each been checked to
// occur in the selection (reading.FilterTerms); `lang` is the page's detected
// language, which the learner can change before saving.
func (h *Handler) terms(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := h.requireWorkspace(w, r)
	if !ok {
		return
	}
	var req termsRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	selection := strings.TrimSpace(req.Selection)
	switch {
	case selection == "":
		badRequest(w, "select some text first")
		return
	case len([]rune(selection)) > reading.MaxSelectionLen:
		httpx.WriteError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("that selection is too long; select at most %d characters", reading.MaxSelectionLen),
			"selection_too_long")
		return
	case req.Page < 0:
		badRequest(w, "page cannot be negative")
		return
	}

	_, pageText, err := h.d.Pages.WorkspacePage(r.Context(), userID, ws.ID, req.Page)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if !vocab.SelectionOnPage(selection, pageText) {
		badRequest(w, "that passage is not on this page of the document")
		return
	}

	doc, err := h.d.Documents.GetDocument(r.Context(), userID, ws.DocumentID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	provider, err := h.d.Providers.ChatFor(r.Context(), userID, reading.Name)
	if err != nil {
		httpx.WriteError(w, http.StatusConflict,
			"no model is configured for reading — add one in Settings", "no_provider")
		return
	}
	terms, _, err := reading.ExtractTerms(r.Context(), provider, provider.DefaultModel(), reading.Request{
		Action: reading.ActionVocab, Selection: selection, Page: req.Page,
		DocumentID: ws.DocumentID.String(), DocumentTitle: doc.Title,
	})
	switch {
	case errors.Is(err, reading.ErrBadTerms):
		httpx.WriteError(w, http.StatusBadGateway,
			"your model did not return a usable word list — try again", "bad_model_output")
		return
	case errors.Is(err, runtime.ErrProvider):
		httpx.WriteError(w, http.StatusBadGateway, "your model could not be reached", "provider_failed")
		return
	case err != nil:
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"terms": terms,
		"lang":  vocab.DetectLang(pageText),
	})
}
