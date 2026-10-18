package notebookapi

import (
	"net/http"

	"github.com/D0bby999/anytools/internal/notebook"
)

// exportToDrive saves the same Markdown the download serves into the
// learner's "Exports" folder. The notebook is resolved with the caller's id
// first, so another learner's answers exactly like a missing one.
func (h *Handler) exportToDrive(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := ident(w, r)
	if !ok {
		return
	}
	nb, err := h.svc.GetNotebook(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	md, err := h.svc.ExportMarkdown(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	h.drive.Save(w, r, "notebook:"+id.String(), notebook.ExportFilename(nb.Name), md)
}
