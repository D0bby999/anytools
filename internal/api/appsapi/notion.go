package appsapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
)

func (h *Handler) registerNotion(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/notion/pages", h.notionPages)
	mux.HandleFunc("POST /v1/kb/{id}/notion/import", h.notionImport) // budget: upload
	mux.HandleFunc("POST /v1/notion/sync", h.notionSync)             // budget: upload
}

func notionPatterns() []string {
	return []string{"GET /v1/notion/pages", "POST /v1/kb/{id}/notion/import", "POST /v1/notion/sync"}
}

type importedView struct {
	PageID string    `json:"page_id"`
	Title  string    `json:"title"`
	KBID   uuid.UUID `json:"kb_id"`
	Gone   bool      `json:"gone"`
	Error  string    `json:"error,omitempty"`
	Synced *string   `json:"synced_at,omitempty"`
}

// notionPages lists what the learner shared, and what is imported.
func (h *Handler) notionPages(w http.ResponseWriter, r *http.Request) {
	user := httpx.MustUserID(r.Context())
	items, err := h.notion.Search(r.Context(), user, r.URL.Query().Get("query"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	links, err := h.notion.Imported(r.Context(), user)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	imported := make([]importedView, 0, len(links))
	for _, l := range links {
		v := importedView{PageID: l.PageID, Title: l.Title, KBID: l.KBID, Gone: l.Gone, Error: l.LastError}
		if l.SyncedAt != nil {
			s := l.SyncedAt.UTC().Format("2006-01-02T15:04:05Z")
			v.Synced = &s
		}
		imported = append(imported, v)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"pages": items, "imported": imported})
}

func (h *Handler) notionImport(w http.ResponseWriter, r *http.Request) {
	user, kbID, ok := h.kbOf(w, r)
	if !ok {
		return
	}
	var body struct {
		PageIDs []string `json:"page_ids"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil || len(body.PageIDs) == 0 || len(body.PageIDs) > 50 {
		httpx.WriteError(w, http.StatusBadRequest, "choose up to 50 pages", "bad_request")
		return
	}
	rep, err := h.notion.Import(r.Context(), user, kbID, body.PageIDs)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, rep)
}

func (h *Handler) notionSync(w http.ResponseWriter, r *http.Request) {
	n, err := h.notion.Sync(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int{"changed": n})
}
