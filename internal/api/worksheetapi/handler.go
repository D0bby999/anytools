// Package worksheetapi is up's worksheets over HTTP (the private design notes,
// phase 0): the kinds, a learner's worksheets, section-by-section writes, row
// appends, the due reviews and the Markdown export.
//
// Only the writing evidence card's diagnosis (phase 4) calls a model, through
// the Diagnoser, and is `budget: generate`. A recording's upload (phase 7,
// recordings.go) is `upload`. Every other write is `budget: none`.
// Identity comes from httpx.MustUserID(ctx) and nowhere else. Every id is
// resolved with the caller's user_id, and "not yours" and "no such thing" are
// the same 404.
package worksheetapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/storageapi"
	"github.com/D0bby999/anytools/internal/capabilities/writingdiag"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Handler serves the worksheet routes.
type Handler struct {
	svc  *worksheet.Service
	diag Diagnoser
	// drive saves exports to the learner's Drive; nil without Drive.
	drive *storageapi.Exports
}

// NewHandler returns a Handler.
func NewHandler(svc *worksheet.Service) *Handler { return &Handler{svc: svc} }

// Diagnoser diagnoses a writing evidence card's revision passes
// (writingdiag.Service, phase 4).
type Diagnoser interface {
	Diagnose(ctx context.Context, userID, worksheetID uuid.UUID, pass int) (*writingdiag.Diagnosis, error)
	List(ctx context.Context, userID, worksheetID uuid.UUID) ([]writingdiag.Diagnosis, error)
}

// WithDiagnoser sets the Diagnoser. Without one the diagnosis routes answer
// 503.
func (h *Handler) WithDiagnoser(d Diagnoser) *Handler {
	h.diag = d
	return h
}

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/worksheet-kinds", h.kinds)
	mux.HandleFunc("GET /v1/worksheets", h.list)
	mux.HandleFunc("POST /v1/worksheets", h.create) // budget: none
	// `due` is more specific than `{id}`, so the mux never reads it as an id.
	mux.HandleFunc("GET /v1/worksheets/due", h.due)
	mux.HandleFunc("GET /v1/worksheets/{id}", h.get)
	mux.HandleFunc("PATCH /v1/worksheets/{id}", h.patch)         // budget: none
	mux.HandleFunc("POST /v1/worksheets/{id}/rows", h.appendRow) // budget: none
	mux.HandleFunc("DELETE /v1/worksheets/{id}", h.remove)       // budget: none
	mux.HandleFunc("GET /v1/worksheets/{id}/export", h.export)
	if h.drive != nil {
		mux.HandleFunc("POST /v1/worksheets/{id}/export/drive", h.exportToDrive) // budget: upload
	}
	// Phase 7: recordings. An upload is bytes on disk, counted against the
	// learner's 500 MB.
	mux.HandleFunc("POST /v1/worksheets/{id}/recordings", h.uploadRecording) // budget: upload
	mux.HandleFunc("GET /v1/worksheets/{id}/recordings/{rid}", h.recording)
	mux.HandleFunc("DELETE /v1/worksheets/{id}/recordings/{rid}", h.deleteRecording) // budget: none
	mux.HandleFunc("POST /v1/worksheets/{id}/diagnose", h.diagnose)                  // budget: generate
	mux.HandleFunc("GET /v1/worksheets/{id}/diagnoses", h.diagnoses)
	// Phase 10: a cycle's close, and the close of the cycle before it.
	mux.HandleFunc("GET /v1/cycles/{id}/close", h.cycleClose)
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"GET /v1/worksheet-kinds",
		"GET /v1/worksheets",
		"POST /v1/worksheets",
		"GET /v1/worksheets/due",
		"GET /v1/worksheets/{id}",
		"PATCH /v1/worksheets/{id}",
		"POST /v1/worksheets/{id}/rows",
		"DELETE /v1/worksheets/{id}",
		"GET /v1/worksheets/{id}/export",
		"POST /v1/worksheets/{id}/export/drive",
		"POST /v1/worksheets/{id}/recordings",
		"GET /v1/worksheets/{id}/recordings/{rid}",
		"DELETE /v1/worksheets/{id}/recordings/{rid}",
		"POST /v1/worksheets/{id}/diagnose",
		"GET /v1/worksheets/{id}/diagnoses",
		"GET /v1/cycles/{id}/close",
	}
}

// kinds is every registered kind: the web app renders forms from these and
// holds no copy of its own. They come in the learner's language.
func (h *Handler) kinds(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"kinds": worksheet.LocalizedKinds(httpx.Language(r.Context()))})
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	q := r.URL.Query()
	f := worksheet.Filter{Kind: strings.TrimSpace(q.Get("kind"))}
	var ok bool
	if f.StateID, ok = optionalID(w, q.Get("state_id"), "state_id"); !ok {
		return
	}
	if f.DocumentID, ok = optionalID(w, q.Get("document_id"), "document_id"); !ok {
		return
	}
	list, err := h.svc.List(r.Context(), userID, f)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"worksheets": list})
}

type createRequest struct {
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	StateID    string `json:"state_id"`
	DocumentID string `json:"document_id"`
	// CycleID is the cycle a cycle close closes (phase 10).
	CycleID string `json:"cycle_id"`
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req createRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body", "")
		return
	}
	in := worksheet.NewWorksheet{Kind: strings.TrimSpace(req.Kind), Title: req.Title}
	var ok bool
	if in.StateID, ok = bodyID(w, req.StateID); !ok {
		return
	}
	if in.DocumentID, ok = bodyID(w, req.DocumentID); !ok {
		return
	}
	if in.CycleID, ok = bodyID(w, req.CycleID); !ok {
		return
	}
	ws, err := h.svc.Create(r.Context(), userID, in)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, ws)
}

// cycleClose is a cycle's own close and the previous cycle's close, with the
// rows the next cycle may start from. Another user's cycle is 404.
func (h *Handler) cycleClose(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	closes, err := h.svc.CycleClose(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, closes)
}

// due is the reviews due on the learner's local day or earlier, open
// worksheets only. A private worksheet's title is "Private note".
func (h *Handler) due(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.Due(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	lang := httpx.Language(r.Context())
	for i := range list {
		d := &list[i]
		d.Name, d.Label = worksheet.TextIn(d.Name, lang), worksheet.TextIn(d.Label, lang)
		if d.Private {
			d.Title = worksheet.TextIn(d.Title, lang)
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"due": list, "count": len(list)})
}

// get is one worksheet with its kind, and the stored keys its kind no longer
// has, which the form shows read-only under "From an earlier version".
func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	ws, err := h.svc.Get(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	out := map[string]any{"worksheet": ws, "earlier": []string{}}
	if k, ok := worksheet.Lookup(ws.Kind); ok {
		out["kind"] = worksheet.Localized(k, httpx.Language(r.Context()))
		if earlier := worksheet.EarlierKeys(k, ws.Answers); earlier != nil {
			out["earlier"] = earlier
		}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

type patchRequest struct {
	// Revision is the worksheet's updated_at as the client loaded it.
	Revision string                     `json:"revision"`
	Title    *string                    `json:"title"`
	Answers  map[string]json.RawMessage `json:"answers"`
	Status   *string                    `json:"status"`
	Reviews  map[string]reviewRequest   `json:"reviews"`
}

type reviewRequest struct {
	Due  *string `json:"due"`
	Done *bool   `json:"done"`
}

func (h *Handler) patch(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req patchRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body", "")
		return
	}
	p := worksheet.Patch{Title: req.Title, Answers: req.Answers, Status: req.Status}
	if req.Revision != "" {
		rev, err := time.Parse(time.RFC3339Nano, req.Revision)
		if err != nil {
			badRequest(w, "revision is the worksheet's updated_at", "revision")
			return
		}
		p.Revision = rev
	}
	if req.Reviews != nil {
		p.Reviews = map[string]worksheet.ReviewPatch{}
		for key, rv := range req.Reviews {
			p.Reviews[key] = worksheet.ReviewPatch{Due: rv.Due, Done: rv.Done}
		}
	}
	ws, err := h.svc.Update(r.Context(), userID, id, p)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, ws)
}

type rowRequest struct {
	Section string          `json:"section"`
	Field   string          `json:"field"`
	Row     json.RawMessage `json:"row"`
}

// appendRow adds one row to a table, server-side, without a revision: a
// selection toolbar or a copy from vocabulary adds to a worksheet another
// component has open.
func (h *Handler) appendRow(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req rowRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil || len(req.Row) == 0 {
		badRequest(w, "send a section, a field and a row", "")
		return
	}
	ws, err := h.svc.AppendRow(r.Context(), userID, id, req.Section, req.Field, req.Row)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, ws)
}

func (h *Handler) remove(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), userID, id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) export(w http.ResponseWriter, r *http.Request) {
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
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+worksheet.ExportName(ws)+`"`)
	_, _ = w.Write([]byte(worksheet.MarkdownIn(k, ws, httpx.Language(r.Context()))))
}

type diagnoseRequest struct {
	// Pass is one of up's five revision passes, 1 to 5.
	Pass int `json:"pass"`
}

// diagnose diagnoses one revision pass of a writing evidence card's unaided
// draft: at most three issues, each quoting it. It never rewrites the draft
// and never writes into the worksheet; a pass already diagnosed for the
// current draft is answered from storage.
func (h *Handler) diagnose(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	if h.diag == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "diagnosis is not available", "unavailable")
		return
	}
	var req diagnoseRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body", "")
		return
	}
	d, err := h.diag.Diagnose(r.Context(), userID, id, req.Pass)
	if err != nil {
		h.failDiagnosis(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, d)
}

// diagnoses is the card's diagnoses of its current draft, by pass.
func (h *Handler) diagnoses(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	if h.diag == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "diagnosis is not available", "unavailable")
		return
	}
	list, err := h.diag.List(r.Context(), userID, id)
	if err != nil {
		h.failDiagnosis(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"diagnoses": list})
}

func (h *Handler) failDiagnosis(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, writingdiag.ErrNotFound):
		notFound(w)
	case errors.Is(err, writingdiag.ErrBadPass):
		badRequest(w, "a pass is 1 to 5", "pass")
	case errors.Is(err, writingdiag.ErrNotDiagnosable):
		httpx.WriteError(w, http.StatusBadRequest, "only a writing evidence card can be diagnosed", "not_diagnosable")
	case errors.Is(err, writingdiag.ErrNoDraft):
		httpx.WriteError(w, http.StatusConflict, "save your own draft first", "no_draft")
	case errors.Is(err, writingdiag.ErrInvalid):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "your model's diagnosis could not be read — try again", "unreadable")
	case errors.Is(err, runtime.ErrNoProvider):
		httpx.WriteError(w, http.StatusConflict, "no chat model is configured — add one in Settings", "no_provider")
	case errors.Is(err, runtime.ErrProvider):
		httpx.WriteError(w, http.StatusBadGateway, "your model could not be reached", "provider_failed")
	default:
		h.fail(w, r, err)
	}
}

// pathID reads the caller and the `{id}` path value. A malformed id is the
// same 404 as another user's.
func pathID(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	userID := httpx.MustUserID(r.Context())
	id, err := uuid.Parse(strings.TrimSpace(r.PathValue("id")))
	if err != nil || id == uuid.Nil {
		notFound(w)
		return uuid.Nil, uuid.Nil, false
	}
	return userID, id, true
}

// bodyID reads an optional id from a body. A malformed one is the same 404
// as another user's.
func bodyID(w http.ResponseWriter, raw string) (*uuid.UUID, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, true
	}
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil {
		notFound(w)
		return nil, false
	}
	return &id, true
}

// optionalID reads an optional id from the query string.
func optionalID(w http.ResponseWriter, raw, name string) (*uuid.UUID, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, true
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		badRequest(w, name+" is not an id", name)
		return nil, false
	}
	return &id, true
}

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
}

// fieldError is ErrorBody with the field a 400 is about.
type fieldError struct {
	Error string `json:"error"`
	Code  string `json:"code"`
	Field string `json:"field,omitempty"`
}

func badRequest(w http.ResponseWriter, msg, field string) {
	httpx.WriteJSON(w, http.StatusBadRequest, fieldError{Error: msg, Code: "bad_request", Field: field})
}

// fail maps an error to a response. Only the engine's own sentences reach
// the client; anything else is logged and answered with one word.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	if httpx.WriteStorageError(w, err) {
		// A file in the learner's Drive that it cannot give or take now
		// (drive-user-storage phase 3).
		return
	}
	if failRecording(w, err) {
		return
	}
	var fe *worksheet.FieldError
	switch {
	case errors.Is(err, worksheet.ErrNotFound):
		notFound(w)
	case errors.As(err, &fe):
		badRequest(w, fe.Field+": "+fe.Reason, fe.Field)
	case errors.Is(err, worksheet.ErrConflict):
		httpx.WriteError(w, http.StatusConflict, "this part was changed elsewhere — reload it and try again", "stale")
	case errors.Is(err, worksheet.ErrCycleClosed):
		httpx.WriteError(w, http.StatusConflict, "this cycle already has a close — open it instead", "cycle_closed")
	case errors.Is(err, worksheet.ErrTooEarly):
		httpx.WriteError(w, http.StatusConflict, strings.TrimPrefix(err.Error(), worksheet.ErrTooEarly.Error()+": "), "too_early")
	default:
		slog.Error("worksheetapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
