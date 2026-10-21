package vocabapi

// decks.go is the general decks' HTTP layer (the private design notes, phase 5). The page reads a deck in the browser and
// sends its cards in batches; none of these calls a model.

import (
	"net/http"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/vocab"
)

func (h *Handler) registerDecks(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/decks", h.listDecks)
	mux.HandleFunc("POST /v1/decks", h.createDeck)              // budget: none
	mux.HandleFunc("DELETE /v1/decks/{id}", h.deleteDeck)       // budget: none
	mux.HandleFunc("POST /v1/decks/{id}/cards", h.addDeckCards) // budget: upload
}

func deckPatterns() []string {
	return []string{"GET /v1/decks", "POST /v1/decks", "DELETE /v1/decks/{id}", "POST /v1/decks/{id}/cards"}
}

func (h *Handler) listDecks(w http.ResponseWriter, r *http.Request) {
	decks, err := h.svc.Decks(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"decks": decks})
}

func (h *Handler) createDeck(w http.ResponseWriter, r *http.Request) {
	var req vocab.NewDeck
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	d, err := h.svc.CreateDeck(r.Context(), httpx.MustUserID(r.Context()), req)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, d)
}

func (h *Handler) deleteDeck(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteDeck(r.Context(), userID, id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) addDeckCards(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Cards []vocab.DeckCard `json:"cards"`
	}
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	res, err := h.svc.AddDeckCards(r.Context(), userID, id, req.Cards)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, res)
}
