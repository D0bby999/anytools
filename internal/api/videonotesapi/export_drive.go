package videonotesapi

import (
	"net/http"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/videonotes"
)

// exportToDrive saves the same Markdown the download serves into the
// learner's "Exports" folder. The video is resolved with the caller's id
// first, so another learner's answers exactly like a missing one.
func (h *Handler) exportToDrive(w http.ResponseWriter, r *http.Request) {
	id, ok := docID(w, r)
	if !ok {
		return
	}
	language := r.URL.Query().Get("language")
	doc, notes, err := h.svc.Get(r.Context(), httpx.MustUserID(r.Context()), id, language)
	if err != nil {
		fail(w, r, err)
		return
	}
	h.drive.Save(w, r, "study_notes:"+id.String(), videonotes.ExportName(doc, language), videonotes.Markdown(doc, notes))
}
