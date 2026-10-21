// Package workspaceapi is Google Forms and Sheets in AnyLearn
// (learning-tool-connections phase 5): a picked form into a knowledge base's
// Quiz, a knowledge base's Quiz out to a graded form, and a picked sheet's
// rows into vocabulary. All of it runs under the drive.file scope the learner
// gave when they connected Google.
package workspaceapi

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/gforms"
	"github.com/D0bby999/anytools/internal/connectors/googleapi"
	"github.com/D0bby999/anytools/internal/vocab"
)

// MaxSheetRows bounds one sheet import.
const MaxSheetRows = 2000

// Sheets exports a picked Google Sheet as CSV.
type Sheets interface {
	ExportSheet(ctx context.Context, userID uuid.UUID, fileID string) (string, []byte, error)
}

// Vocab imports words.
type Vocab interface {
	ImportFrom(ctx context.Context, userID uuid.UUID, lang, origin string, notes []vocab.ImportNote) (*vocab.ImportResult, error)
}

// Authorizer answers whether a user owns a knowledge base.
type Authorizer interface {
	OwnsKB(ctx context.Context, user, kbID uuid.UUID) error
}

// Handler serves the routes.
type Handler struct {
	forms  *gforms.Service
	sheets Sheets
	vocab  Vocab
	authz  Authorizer
}

// NewHandler returns a Handler.
func NewHandler(forms *gforms.Service, sheets Sheets, v Vocab, a Authorizer) *Handler {
	return &Handler{forms: forms, sheets: sheets, vocab: v, authz: a}
}

// RegisterRoutes attaches the routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/kb/{id}/forms/import", h.importForm) // budget: none
	mux.HandleFunc("POST /v1/kb/{id}/forms/export", h.exportForm) // budget: none
	mux.HandleFunc("POST /v1/sheets/preview", h.previewSheet)     // budget: none
	mux.HandleFunc("POST /v1/sheets/vocab", h.importSheet)        // budget: none
}

// Patterns lists what RegisterRoutes registers.
func Patterns() []string {
	return []string{
		"POST /v1/kb/{id}/forms/import", "POST /v1/kb/{id}/forms/export",
		"POST /v1/sheets/preview", "POST /v1/sheets/vocab",
	}
}

func (h *Handler) kb(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	user := httpx.MustUserID(r.Context())
	kbID, err := uuid.Parse(r.PathValue("id"))
	if err != nil || h.authz.OwnsKB(r.Context(), user, kbID) != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return uuid.Nil, uuid.Nil, false
	}
	return user, kbID, true
}

func (h *Handler) importForm(w http.ResponseWriter, r *http.Request) {
	user, kbID, ok := h.kb(w, r)
	if !ok {
		return
	}
	var body struct {
		FormID string `json:"form_id"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	rep, err := h.forms.Import(r.Context(), user, kbID, body.FormID)
	if errors.Is(err, gforms.ErrNothingToImport) {
		httpx.WriteJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error": err.Error(), "code": "nothing_to_import", "report": rep,
		})
		return
	}
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, rep)
}

func (h *Handler) exportForm(w http.ResponseWriter, r *http.Request) {
	user, kbID, ok := h.kb(w, r)
	if !ok {
		return
	}
	var body struct {
		Title string `json:"title"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	rep, err := h.forms.Export(r.Context(), user, kbID, body.Title, httpx.Language(r.Context()))
	if errors.Is(err, gforms.ErrNothingToExport) {
		httpx.WriteError(w, http.StatusUnprocessableEntity, err.Error(), "nothing_to_export")
		return
	}
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, rep)
}

// sheetRows reads a picked sheet's rows.
func (h *Handler) sheetRows(r *http.Request, fileID string) (string, [][]string, error) {
	name, data, err := h.sheets.ExportSheet(r.Context(), httpx.MustUserID(r.Context()), strings.TrimSpace(fileID))
	if err != nil {
		return "", nil, err
	}
	rows, err := ParseCSV(data, MaxSheetRows+1)
	return name, rows, err
}

// ParseCSV reads up to max rows of a sheet's CSV export, dropping empty rows.
func ParseCSV(data []byte, max int) ([][]string, error) {
	rd := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))))
	rd.FieldsPerRecord = -1
	rd.LazyQuotes = true
	var rows [][]string
	for len(rows) < max {
		rec, err := rd.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		empty := true
		for i := range rec {
			rec[i] = strings.TrimSpace(rec[i])
			if rec[i] != "" {
				empty = false
			}
		}
		if !empty {
			rows = append(rows, rec)
		}
	}
	return rows, nil
}

func (h *Handler) previewSheet(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FileID string `json:"file_id"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	name, rows, err := h.sheetRows(r, body.FileID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	total := len(rows)
	if len(rows) > 6 {
		rows = rows[:6]
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"name": name, "rows": rows, "total": total, "max": MaxSheetRows})
}

func (h *Handler) importSheet(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FileID  string `json:"file_id"`
		Lang    string `json:"lang"`
		Term    int    `json:"term"`
		Meaning int    `json:"meaning"`
		// Example is a column of example sentences, or -1.
		Example int  `json:"example"`
		Header  bool `json:"header"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	if body.Term < 0 || body.Meaning < 0 || body.Term == body.Meaning {
		httpx.WriteError(w, http.StatusBadRequest, "choose a column for the word and another for its meaning", "bad_request")
		return
	}
	_, rows, err := h.sheetRows(r, body.FileID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if body.Header && len(rows) > 0 {
		rows = rows[1:]
	}
	if len(rows) > MaxSheetRows {
		rows = rows[:MaxSheetRows]
	}
	cell := func(row []string, i int) string {
		if i < 0 || i >= len(row) {
			return ""
		}
		return row[i]
	}
	notes := make([]vocab.ImportNote, 0, len(rows))
	for _, row := range rows {
		notes = append(notes, vocab.ImportNote{Term: cell(row, body.Term), Meaning: cell(row, body.Meaning), Sentence: cell(row, body.Example)})
	}
	if len(notes) == 0 {
		httpx.WriteError(w, http.StatusUnprocessableEntity, "the sheet has no rows", "empty")
		return
	}
	// One batch of the vocabulary's size at a time, as the Anki import sends
	// them; each continues the pacing where the one before left off.
	total := &vocab.ImportResult{}
	for start := 0; start < len(notes); start += vocab.MaxImportBatch {
		end := min(start+vocab.MaxImportBatch, len(notes))
		res, err := h.vocab.ImportFrom(r.Context(), httpx.MustUserID(r.Context()), body.Lang, vocab.OriginSheets, notes[start:end])
		if err != nil {
			h.fail(w, r, err)
			return
		}
		total.Created += res.Created
		total.Duplicates += res.Duplicates
		total.Invalid += res.Invalid
		total.OverLimit += res.OverLimit
		if total.FirstDay == "" {
			total.FirstDay = res.FirstDay
		}
		if res.LastDay != "" {
			total.LastDay = res.LastDay
		}
	}
	httpx.WriteJSON(w, http.StatusOK, total)
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, authz.ErrNoAccess):
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
	case errors.Is(err, drive.ErrNotConnected), errors.Is(err, drive.ErrScopeMissing):
		httpx.WriteError(w, http.StatusConflict, "Google is not connected for this account", "not_connected")
	case errors.Is(err, drive.ErrNeedsReconnect):
		httpx.WriteError(w, http.StatusConflict, "Google needs to be reconnected", "needs_reconnect")
	case errors.Is(err, drive.ErrNotASheet):
		httpx.WriteError(w, http.StatusUnprocessableEntity, err.Error(), "not_a_sheet")
	case errors.Is(err, vocab.ErrInvalid):
		httpx.WriteError(w, http.StatusBadRequest, err.Error(), "bad_request")
	case googleapi.Disabled(err):
		httpx.WriteError(w, http.StatusServiceUnavailable, "the Google Forms API is not enabled for this deployment", "api_disabled")
	case googleapi.IsStatus(err, http.StatusNotFound), googleapi.IsStatus(err, http.StatusForbidden):
		httpx.WriteError(w, http.StatusNotFound, "Google did not let AnyLearn open that file; pick it again", "not_found")
	default:
		slog.Error("workspaceapi: request failed", "error", err, "path", r.URL.Path)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
