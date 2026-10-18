// Package examapi is the exam mimic over HTTP (learning-depth phase 3).
//
// The caller's identity comes from httpx.MustUserID and nowhere else; every
// id in a path or a body is resolved with it by the service, and a foreign id
// answers exactly like a missing one.
package examapi

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/capabilities/exam"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Handler serves the exam routes.
type Handler struct{ svc *exam.Service }

// NewHandler builds the handler.
func NewHandler(svc *exam.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers this package's patterns on the mux.
//
// The review edit is PATCH, not PUT: `PUT /v1/exams/templates/{id}` and
// `PUT /v1/exams/{id}/answers` both match /v1/exams/templates/answers, and
// the mux refuses two patterns neither of which is more specific.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/exams/templates", h.upload) // budget: upload
	mux.HandleFunc("GET /v1/exams/templates", h.templates)
	mux.HandleFunc("GET /v1/exams/templates/{id}", h.template)
	mux.HandleFunc("PATCH /v1/exams/templates/{id}", h.review)          // budget: none
	mux.HandleFunc("DELETE /v1/exams/templates/{id}", h.deleteTemplate) // budget: none
	mux.HandleFunc("GET /v1/exams/templates/{id}/file", h.paper)
	mux.HandleFunc("POST /v1/exams/templates/{id}/cancel", h.cancelTemplate) // budget: none
	mux.HandleFunc("POST /v1/exams", h.create)                               // budget: generate
	mux.HandleFunc("GET /v1/exams", h.exams)
	mux.HandleFunc("GET /v1/exams/{id}", h.exam)
	mux.HandleFunc("POST /v1/exams/{id}/start", h.start)    // budget: none
	mux.HandleFunc("PUT /v1/exams/{id}/answers", h.answers) // budget: none
	mux.HandleFunc("POST /v1/exams/{id}/submit", h.submit)  // budget: generate
	mux.HandleFunc("POST /v1/exams/{id}/cancel", h.cancel)  // budget: none
	mux.HandleFunc("DELETE /v1/exams/{id}", h.deleteExam)   // budget: none
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"POST /v1/exams/templates",
		"GET /v1/exams/templates",
		"GET /v1/exams/templates/{id}",
		"PATCH /v1/exams/templates/{id}",
		"DELETE /v1/exams/templates/{id}",
		"GET /v1/exams/templates/{id}/file",
		"POST /v1/exams/templates/{id}/cancel",
		"POST /v1/exams",
		"GET /v1/exams",
		"GET /v1/exams/{id}",
		"POST /v1/exams/{id}/start",
		"PUT /v1/exams/{id}/answers",
		"POST /v1/exams/{id}/submit",
		"POST /v1/exams/{id}/cancel",
		"DELETE /v1/exams/{id}",
	}
}

// ── templates ─────────────────────────────────────────────────────────────

// templateView is a template with its extraction's progress.
type templateView struct {
	*exam.Template
	Progress *jobs.Progress `json:"progress,omitempty"`
}

func (h *Handler) upload(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	tooLarge := func() {
		httpx.WriteError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("the file must be %d MB or smaller", exam.MaxUploadBytes>>20), "too_large")
	}
	// The cap is enforced on the request, before anything is buffered.
	r.Body = http.MaxBytesReader(w, r.Body, exam.MaxUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		tooLarge()
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()
	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "a file part named \"file\" is required", "bad_request")
		return
	}
	defer file.Close()
	data, tooBig, err := blob.ReadAllLimited(file, exam.MaxUploadBytes)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if tooBig {
		tooLarge()
		return
	}
	t, err := h.svc.Upload(r.Context(), userID, header.Filename, data)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, templateView{Template: t})
}

func (h *Handler) templates(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.Templates(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"templates": list})
}

func (h *Handler) template(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	t, err := h.svc.Template(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	v := templateView{Template: t}
	if t.Status != exam.TemplateReview && t.Status != exam.TemplateReady {
		v.Progress = h.svc.TemplateProgress(r.Context(), t)
	}
	httpx.WriteJSON(w, http.StatusOK, v)
}

func (h *Handler) review(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req exam.Review
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badBody(w)
		return
	}
	t, err := h.svc.SaveReview(r.Context(), httpx.MustUserID(r.Context()), id, req)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, templateView{Template: t})
}

func (h *Handler) deleteTemplate(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteTemplate(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) cancelTemplate(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.CancelTemplate(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// paperTypes are what the stored paper is served as. A PDF (a photo is
// stored as one) renders in pdf.js; a Word or text paper is a download.
var paperTypes = map[string]string{
	exam.KindPDF:   "application/pdf",
	exam.KindImage: "application/pdf",
	exam.KindDOCX:  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	exam.KindText:  "text/plain; charset=utf-8",
}

// paper serves the stored paper, for the review screen's page images.
func (h *Handler) paper(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	data, t, err := h.svc.Paper(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("Content-Type", paperTypes[t.Kind])
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("Cache-Control", "private, max-age=300")
	if t.Kind == exam.KindPDF || t.Kind == exam.KindImage {
		w.Header().Set("Content-Disposition", "inline")
	} else {
		w.Header().Set("Content-Disposition", "attachment")
	}
	// ServeContent answers pdf.js's range requests.
	http.ServeContent(w, r, "", t.UpdatedAt, bytes.NewReader(data))
}

// ── exams ─────────────────────────────────────────────────────────────────

type createRequest struct {
	TemplateID string `json:"template_id"`
	KBID       string `json:"kb_id"`
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badBody(w)
		return
	}
	// A malformed id is a missing one: the same 404 as another user's.
	templateID, err1 := uuid.Parse(strings.TrimSpace(req.TemplateID))
	kbID, err2 := uuid.Parse(strings.TrimSpace(req.KBID))
	if err1 != nil || err2 != nil {
		notFound(w)
		return
	}
	e, err := h.svc.Create(r.Context(), httpx.MustUserID(r.Context()), exam.CreateRequest{TemplateID: templateID, KBID: kbID})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, e)
}

func (h *Handler) exams(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.Exams(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"exams": list})
}

func (h *Handler) exam(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	v, err := h.svc.View(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, v)
}

type startRequest struct {
	TimeLimitMinutes *int `json:"time_limit_minutes"`
}

func (h *Handler) start(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	// The body is optional: no body keeps the template's limit.
	var req startRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil && !errors.Is(err, io.EOF) {
		badBody(w)
		return
	}
	v, err := h.svc.Start(r.Context(), httpx.MustUserID(r.Context()), id, req.TimeLimitMinutes)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, v)
}

type answersRequest struct {
	Answers []answerInput `json:"answers"`
}

type answerInput struct {
	ItemID uuid.UUID `json:"item_id"`
	Answer string    `json:"answer"`
}

func (h *Handler) answers(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req answersRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badBody(w)
		return
	}
	answers := make([]exam.Answer, 0, len(req.Answers))
	for _, a := range req.Answers {
		answers = append(answers, exam.Answer{ItemID: a.ItemID, Text: a.Answer})
	}
	if err := h.svc.SaveAnswers(r.Context(), httpx.MustUserID(r.Context()), id, answers); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) submit(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	v, err := h.svc.Submit(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, v)
}

func (h *Handler) cancel(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.CancelExam(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) deleteExam(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteExam(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── plumbing ──────────────────────────────────────────────────────────────

// pathID reads the id, answering 404 for anything malformed: a malformed id
// and another user's must be indistinguishable.
func pathID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(strings.TrimSpace(r.PathValue("id")))
	if err != nil || id == uuid.Nil {
		notFound(w)
		return uuid.Nil, false
	}
	return id, true
}

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
}

func badBody(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
}

// fail maps a service error onto a status. Not yours and not found are the
// same 404.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	if httpx.WriteStorageError(w, err) {
		// A file in the learner's Drive that it cannot give or take now
		// (drive-user-storage phase 3).
		return
	}
	switch {
	case errors.Is(err, exam.ErrNotFound):
		notFound(w)
	case errors.Is(err, exam.ErrBadRequest):
		httpx.WriteError(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), "exam: bad request: "), "bad_request")
	case errors.Is(err, exam.ErrUnsupported):
		httpx.WriteError(w, http.StatusUnsupportedMediaType,
			"upload a PDF, a Word document (.docx), a text file or a photo (PNG or JPEG)", "unsupported_type")
	case errors.Is(err, exam.ErrNeedsParseModel):
		httpx.WriteError(w, http.StatusConflict,
			"this paper has no text layer (a scan or a photo) — route a model to Parse documents in Settings → Routes to read it",
			"needs_parse_model")
	case errors.Is(err, exam.ErrNotReady):
		httpx.WriteError(w, http.StatusConflict, "review the template and mark it ready first", "not_ready")
	case errors.Is(err, exam.ErrConflict):
		httpx.WriteError(w, http.StatusConflict, "that is not possible at this stage of the exam", "conflict")
	case errors.Is(err, runtime.ErrNoProvider):
		httpx.WriteError(w, http.StatusConflict,
			"no model is configured for quizzes — add one in Settings", "no_provider")
	case errors.Is(err, exam.ErrMarkingIncomplete):
		// The count, not the provider's own words: those stay in the log.
		var inc *exam.IncompleteError
		msg := "some answers are not marked yet"
		if errors.As(err, &inc) {
			msg = fmt.Sprintf("%d of %d answers are not marked yet", inc.Unmarked, inc.Total)
		}
		slog.Warn("examapi: marking stopped part-way", "path", r.URL.Path, "error", err)
		httpx.WriteError(w, http.StatusBadGateway, msg+" — submit again to finish marking", "marking_incomplete")
	case errors.Is(err, runtime.ErrProvider):
		httpx.WriteError(w, http.StatusBadGateway, "your model could not be reached", "provider_failed")
	default:
		slog.Error("examapi: request failed", "path", r.URL.Path, "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
