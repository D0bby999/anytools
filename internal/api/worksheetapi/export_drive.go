package worksheetapi

import (
	"net/http"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/storageapi"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
)

// WithDriveExport enables "Save to my Drive" (drive-user-storage phase 2).
func (h *Handler) WithDriveExport(e *storageapi.Exports) *Handler {
	h.drive = e
	return h
}

// exportToDrive saves the same Markdown the download serves into the
// learner's "Exports" folder. The worksheet is resolved with the caller's id
// first, so another learner's answers exactly like a missing one.
func (h *Handler) exportToDrive(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	ws, err := h.svc.Get(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	k, ok := worksheet.Lookup(ws.Kind)
	if !ok {
		httpx.WriteError(w, http.StatusConflict, "this worksheet's kind is no longer available", "unknown_kind")
		return
	}
	h.drive.Save(w, r, "worksheet:"+id.String(), worksheet.ExportName(ws), worksheet.MarkdownIn(k, ws, httpx.Language(r.Context())))
}
