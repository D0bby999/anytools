// Package researchapi is the HTTP surface of the research capability: start a
// research turn, list and read stored reports, and save a report to the
// notebook.
//
// Like solve, a research run is a TURN on a chat session (chatapi.Handler
// .Start), so its live stages stream through GET /v1/turns/{id}/events. The
// caller's identity comes from httpx.MustUserID and nowhere else; every report
// read filters on it in SQL.
package researchapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/chatapi"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/research"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// maxQuery caps a research request; the CHECK on research_reports.query is
// 4000 characters and a request that could not be stored is refused up front.
const maxQuery = 4000

// Starter starts a turn on a chat session. *chatapi.Handler implements it.
type Starter interface {
	Start(ctx context.Context, userID uuid.UUID, req chatapi.StartRequest) (*runtime.Session, *runtime.Turn, *chatapi.StartError)
}

// Reports reads stored reports. pg.ResearchStore implements it.
type Reports interface {
	GetReport(ctx context.Context, userID, reportID uuid.UUID) (*research.Report, error)
	ListReports(ctx context.Context, userID uuid.UUID, limit int) ([]research.Report, error)
	SetReportNote(ctx context.Context, userID, reportID uuid.UUID, noteID string) error
}

// Handler serves the research routes.
type Handler struct {
	starter Starter
	reports Reports
	search  tools.WebSearcher
	notes   tools.NoteWriter
	// knowledge and pages serve "add to knowledge base" (knowledge.go).
	knowledge Knowledge
	pages     PageFetcher
}

// Config assembles a Handler.
type Config struct {
	Starter Starter
	Reports Reports
	// Search is asked only whether the user HAS a key, so a request can say
	// up front that the report will be KB-only.
	Search tools.WebSearcher
	// Notes is phase 8's notebook; nil until it merges.
	Notes tools.NoteWriter
	// Knowledge and Pages serve "add to knowledge base"; nil → 503.
	Knowledge Knowledge
	Pages     PageFetcher
}

// NewHandler builds the handler.
func NewHandler(cfg Config) *Handler {
	return &Handler{starter: cfg.Starter, reports: cfg.Reports, search: cfg.Search, notes: cfg.Notes,
		knowledge: cfg.Knowledge, pages: cfg.Pages}
}

// RegisterRoutes registers this package's patterns on the mux. Every pattern
// must also appear in Patterns(); the allowlist test fails in both directions.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/research", h.start) // budget: generate
	mux.HandleFunc("GET /v1/research/reports", h.list)
	mux.HandleFunc("GET /v1/research/reports/{id}", h.get)
	mux.HandleFunc("POST /v1/research/reports/{id}/note", h.saveNote)         // budget: none
	mux.HandleFunc("POST /v1/research/reports/{id}/knowledge", h.toKnowledge) // budget: upload
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"POST /v1/research",
		"GET /v1/research/reports",
		"GET /v1/research/reports/{id}",
		"POST /v1/research/reports/{id}/note",
		"POST /v1/research/reports/{id}/knowledge",
	}
}

type startRequest struct {
	SessionID string   `json:"session_id"`
	Query     string   `json:"query"`
	Mode      string   `json:"mode"`
	KBIDs     []string `json:"kb_ids"`
	// AllowWeb is the session's "allow web alongside my documents" consent,
	// for a NEW session. It is what lets the web be searched in a turn that
	// has read the learner's documents; without it such a turn is KB-only.
	AllowWeb bool `json:"allow_web"`
}

func (h *Handler) start(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())

	var req startRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}
	query := strings.TrimSpace(req.Query)
	if query == "" {
		httpx.WriteError(w, http.StatusBadRequest, "write what you want researched", "empty_query")
		return
	}
	if len([]rune(query)) > maxQuery {
		httpx.WriteError(w, http.StatusRequestEntityTooLarge, "that request is too long", "message_too_long")
		return
	}
	mode := research.ModeQuick
	switch req.Mode {
	case "", research.ModeQuick:
	case research.ModeDeep:
		mode = research.ModeDeep
	default:
		httpx.WriteError(w, http.StatusBadRequest, "mode must be quick or deep", "bad_mode")
		return
	}

	sessionID := uuid.Nil
	if s := strings.TrimSpace(req.SessionID); s != "" {
		id, err := uuid.Parse(s)
		if err != nil {
			httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
			return
		}
		sessionID = id
	}

	hasKey, err := h.search.Available(r.Context(), userID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "could not check your search keys", "search_check_failed")
		return
	}
	// Without a key the keyless fallback still reaches the web.
	keyless := false
	if ks, ok := h.search.(tools.KeylessSearcher); ok {
		keyless = ks.Keyless()
	}

	sess, turn, serr := h.starter.Start(r.Context(), userID, chatapi.StartRequest{
		SessionID:  sessionID,
		Title:      research.ReportTitle(query),
		KBIDs:      req.KBIDs,
		AllowWeb:   req.AllowWeb,
		Capability: "research",
		Message:    query,
		Params:     map[string]string{"mode": mode},
	})
	if serr != nil {
		httpx.WriteError(w, serr.Status, serr.Message, serr.Code)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{
		"session_id": sess.ID.String(),
		"turn_id":    turn.ID.String(),
		"status":     turn.Status,
		"mode":       mode,
		// Known before a single stage runs, so the page can say "KB-only"
		// immediately rather than after the gather stage discovers it.
		"web_available": hasKey || keyless,
		"web_keyless":   !hasKey && keyless,
	})
}

// summaryJSON is a report in a list: everything but the body.
type summaryJSON struct {
	ID           string    `json:"id"`
	Query        string    `json:"query"`
	Mode         string    `json:"mode"`
	KBOnly       bool      `json:"kb_only"`
	KBOnlyReason string    `json:"kb_only_reason,omitempty"`
	Sources      int       `json:"sources"`
	NoteID       string    `json:"note_id,omitempty"`
	SessionID    string    `json:"session_id,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	reports, err := h.reports.ListReports(r.Context(), userID, limit)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "could not list reports", "list_failed")
		return
	}
	out := make([]summaryJSON, 0, len(reports))
	for _, rep := range reports {
		s := summaryJSON{
			ID: rep.ID.String(), Query: rep.Query, Mode: rep.Mode, KBOnly: rep.KBOnly,
			KBOnlyReason: rep.KBOnlyReason, Sources: len(rep.Sources), NoteID: rep.NoteID,
			CreatedAt: rep.CreatedAt,
		}
		if rep.SessionID != nil {
			s.SessionID = rep.SessionID.String()
		}
		out = append(out, s)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"reports": out})
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	rep, ok := h.report(w, r)
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, rep)
}

func (h *Handler) saveNote(w http.ResponseWriter, r *http.Request) {
	rep, ok := h.report(w, r)
	if !ok {
		return
	}
	if rep.NoteID != "" {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"note_id": rep.NoteID})
		return
	}
	if h.notes == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable,
			"saving to the notebook is not available yet", "notebook_unavailable")
		return
	}
	userID := httpx.MustUserID(r.Context())
	var sessionID uuid.UUID
	if rep.SessionID != nil {
		sessionID = *rep.SessionID
	}
	noteID, err := h.notes.WriteNote(r.Context(), userID, sessionID, research.ReportTitle(rep.Query), rep.ReportMD)
	if err != nil {
		slog.Error("researchapi: save note", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "could not save the note", "note_failed")
		return
	}
	if err := h.reports.SetReportNote(r.Context(), userID, rep.ID, noteID); err != nil {
		slog.Error("researchapi: record note id", "error", err)
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"note_id": noteID})
}

// report reads the {id} report for the caller, or answers 404 — the same 404
// for a malformed id, another user's report and one that does not exist.
func (h *Handler) report(w http.ResponseWriter, r *http.Request) (*research.Report, bool) {
	userID := httpx.MustUserID(r.Context())
	id, err := uuid.Parse(strings.TrimSpace(r.PathValue("id")))
	if err != nil {
		notFound(w)
		return nil, false
	}
	rep, err := h.reports.GetReport(r.Context(), userID, id)
	if err != nil {
		if !errors.Is(err, research.ErrNotFound) {
			httpx.WriteError(w, http.StatusInternalServerError, "could not load the report", "load_failed")
			return nil, false
		}
		notFound(w)
		return nil, false
	}
	return rep, true
}

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
}
