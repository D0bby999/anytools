package storageapi

import (
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/learning"
)

// exports.go — "Save to my Drive" beside each "Download as Markdown"
// (drive-user-storage phase 2). Each feature's own handler resolves its
// resource with the caller's id, renders the same Markdown its download
// serves, and hands it to Save; a foreign or missing resource is therefore
// that handler's 404 before anything here runs.

// Exports writes exports into the learner's "Exports" folder.
type Exports struct {
	h   *Handler
	now func() time.Time
}

// Exports is nil when Drive is not configured: the feature handlers then
// register no "Save to my Drive" route.
func (h *Handler) Exports() *Exports {
	if h == nil || h.files == nil {
		return nil
	}
	return &Exports{h: h, now: time.Now}
}

type exportResponse struct {
	FileID string `json:"file_id"`
	Name   string `json:"name"`
	// URL opens the file in Drive.
	URL string `json:"url"`
}

// Save writes markdown into "Exports" as filename, stamped with the
// learner's local date and time so a second save is a second file beside the
// first, and answers 201 with a link to it. key names what was exported
// ("worksheet:<id>"); it goes in the file's appProperties.
func (e *Exports) Save(w http.ResponseWriter, r *http.Request, key, filename, markdown string) {
	userID := httpx.MustUserID(r.Context())
	storage, err := e.h.settings.FileStorage(r.Context(), userID)
	if err != nil {
		internal(w, r, err)
		return
	}
	if storage != blob.StorageDrive {
		httpx.WriteError(w, http.StatusConflict, "turn on Drive storage in Settings → Storage first", "drive_storage_off")
		return
	}
	if !e.h.driveUsable(w, r, userID) {
		return
	}
	zone, err := e.h.settings.Timezone(r.Context(), userID)
	if err != nil {
		internal(w, r, err)
		return
	}
	name := stampedName(filename, e.now(), zone)
	id, err := e.h.files.SaveExport(r.Context(), userID, key, name, "text/markdown", []byte(markdown))
	if err != nil {
		driveFailed(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, exportResponse{
		FileID: id, Name: name, URL: "https://drive.google.com/file/d/" + id + "/view",
	})
}

// stampedName puts the learner's local date and time before the extension:
// "week-3.md" becomes "week-3 2026-10-17 20.15.md".
func stampedName(filename string, at time.Time, zone string) string {
	loc, err := learning.LoadZone(zone)
	if err != nil {
		loc = time.UTC
	}
	filename = strings.NewReplacer("/", "-", "\\", "-", `"`, "").Replace(filename)
	ext := path.Ext(filename)
	if ext == "" {
		ext = ".md"
	}
	base := strings.TrimSpace(strings.TrimSuffix(filename, ext))
	if base == "" {
		base = "Export"
	}
	return base + " " + at.In(loc).Format("2006-01-02 15.04") + ext
}
