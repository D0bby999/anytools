package bookapi

import (
	"net/http"

	"github.com/D0bby999/anytools/internal/api/httpx"
)

// exportToDrive saves the same Markdown the download serves into the
// learner's "Exports" folder. The book is resolved with the caller's id
// first, so another learner's answers exactly like a missing one.
func (h *Handler) exportToDrive(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	md, name, err := h.svc.Export(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	h.drive.Save(w, r, "book:"+id.String(), name, md)
}
