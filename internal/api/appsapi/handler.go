// Package appsapi is the learning tools outside Google
// (learning-tool-connections phases 8 and 9): their OAuth connection, and
// Canva's designs. Notion's routes are in notion.go.
package appsapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/connectors/appconn"
	"github.com/D0bby999/anytools/internal/connectors/canva"
	"github.com/D0bby999/anytools/internal/connectors/notion"
)

// Knowledge files what the apps bring in.
type Knowledge interface {
	OwnsKB(ctx context.Context, userID, kbID uuid.UUID) error
	Upload(ctx context.Context, userID, kbID uuid.UUID, filename string, data []byte) (uuid.UUID, error)
}

// Handler serves the routes.
type Handler struct {
	conn   *appconn.Service
	canva  *canva.Service
	notion *notion.Service
	kb     Knowledge
	appURL string
}

// NewHandler returns a Handler. appURL is the public origin every redirect
// URI must start with.
func NewHandler(conn *appconn.Service, cv *canva.Service, nt *notion.Service, kb Knowledge, appURL string) *Handler {
	return &Handler{conn: conn, canva: cv, notion: nt, kb: kb, appURL: strings.TrimRight(appURL, "/")}
}

// RegisterRoutes attaches the routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/apps/{provider}", h.status)
	mux.HandleFunc("POST /v1/apps/{provider}/authorize", h.authorize) // budget: none
	mux.HandleFunc("POST /v1/apps/{provider}/connect", h.connect)     // budget: none
	mux.HandleFunc("DELETE /v1/apps/{provider}", h.disconnect)        // budget: none
	mux.HandleFunc("GET /v1/canva/designs", h.designs)
	mux.HandleFunc("POST /v1/kb/{id}/canva/import", h.canvaImport) // budget: upload
	h.registerNotion(mux)
}

// Patterns lists what RegisterRoutes registers.
func Patterns() []string {
	return append([]string{
		"GET /v1/apps/{provider}", "POST /v1/apps/{provider}/authorize", "POST /v1/apps/{provider}/connect",
		"DELETE /v1/apps/{provider}", "GET /v1/canva/designs", "POST /v1/kb/{id}/canva/import",
	}, notionPatterns()...)
}

var providers = []string{"canva", "notion"}

func (h *Handler) providerOf(w http.ResponseWriter, r *http.Request) (string, bool) {
	p := r.PathValue("provider")
	if !slices.Contains(providers, p) {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return "", false
	}
	return p, true
}

func (h *Handler) redirectOK(p, uri string) bool {
	return uri == h.appURL+"/auth/app/"+p+"/callback"
}

func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	p, ok := h.providerOf(w, r)
	if !ok {
		return
	}
	st, err := h.conn.Status(r.Context(), httpx.MustUserID(r.Context()), p)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, st)
}

func (h *Handler) authorize(w http.ResponseWriter, r *http.Request) {
	p, ok := h.providerOf(w, r)
	if !ok {
		return
	}
	var body struct {
		State         string `json:"state"`
		CodeChallenge string `json:"code_challenge"`
		RedirectURI   string `json:"redirect_uri"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil || body.State == "" || !h.redirectOK(p, body.RedirectURI) {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	u, err := h.conn.AuthorizeURL(p, body.State, body.CodeChallenge, body.RedirectURI)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"url": u})
}

// connect takes the code; its body carries a code verifier, so nothing about
// it is logged.
func (h *Handler) connect(w http.ResponseWriter, r *http.Request) {
	p, ok := h.providerOf(w, r)
	if !ok {
		return
	}
	var body struct {
		Code         string `json:"code"`
		CodeVerifier string `json:"code_verifier"`
		RedirectURI  string `json:"redirect_uri"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil || body.Code == "" || !h.redirectOK(p, body.RedirectURI) {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	if err := h.conn.Connect(r.Context(), httpx.MustUserID(r.Context()), p, body.Code, body.CodeVerifier, body.RedirectURI); err != nil {
		if errors.Is(err, appconn.ErrNotConfigured) || errors.Is(err, appconn.ErrUnknownProvider) {
			h.fail(w, r, err)
			return
		}
		slog.Warn("appsapi: the code did not exchange", "app", p, "error", err)
		httpx.WriteError(w, http.StatusBadGateway, "the app did not accept the sign-in; try again", "exchange_failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"connected": true})
}

func (h *Handler) disconnect(w http.ResponseWriter, r *http.Request) {
	p, ok := h.providerOf(w, r)
	if !ok {
		return
	}
	user := httpx.MustUserID(r.Context())
	if p == "notion" && h.notion != nil {
		if err := h.notion.Forget(r.Context(), user); err != nil {
			h.fail(w, r, err)
			return
		}
	}
	if err := h.conn.Disconnect(r.Context(), user, p); err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"connected": false})
}

func (h *Handler) designs(w http.ResponseWriter, r *http.Request) {
	designs, next, err := h.canva.Designs(r.Context(), httpx.MustUserID(r.Context()), r.URL.Query().Get("query"), r.URL.Query().Get("continuation"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"designs": designs, "continuation": next})
}

func (h *Handler) kbOf(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	user := httpx.MustUserID(r.Context())
	kbID, err := uuid.Parse(r.PathValue("id"))
	if err != nil || h.kb.OwnsKB(r.Context(), user, kbID) != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return uuid.Nil, uuid.Nil, false
	}
	return user, kbID, true
}

func (h *Handler) canvaImport(w http.ResponseWriter, r *http.Request) {
	user, kbID, ok := h.kbOf(w, r)
	if !ok {
		return
	}
	var body struct {
		DesignID string `json:"design_id"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	pdf, title, err := h.canva.ExportPDF(r.Context(), user, body.DesignID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if strings.TrimSpace(title) == "" {
		title = "Canva design"
	}
	doc, err := h.kb.Upload(r.Context(), user, kbID, safeName(title)+".pdf", pdf)
	if err != nil {
		httpx.WriteError(w, http.StatusUnprocessableEntity, err.Error(), "upload_refused")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"document_id": doc, "kb_id": kbID, "title": title})
}

func safeName(s string) string {
	s = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r < 32 {
			return ' '
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 120 {
		s = string(r[:120])
	}
	return s
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	var ce *canva.APIError
	var ne *notion.APIError
	switch {
	case errors.Is(err, appconn.ErrUnknownProvider):
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
	case errors.Is(err, appconn.ErrNotConfigured):
		httpx.WriteError(w, http.StatusServiceUnavailable, "this app is not set up on this server yet", "not_configured")
	case errors.Is(err, appconn.ErrNotConnected):
		httpx.WriteError(w, http.StatusConflict, "connect the app first", "not_connected")
	case errors.Is(err, appconn.ErrNeedsReconnect):
		httpx.WriteError(w, http.StatusConflict, "the app needs to be reconnected", "needs_reconnect")
	case errors.Is(err, canva.ErrJobTimeout):
		httpx.WriteError(w, http.StatusGatewayTimeout, err.Error(), "timeout")
	case errors.Is(err, canva.ErrJobFailed), errors.Is(err, canva.ErrTooLarge):
		httpx.WriteError(w, http.StatusBadGateway, err.Error(), "job_failed")
	case errors.As(err, &ce) && ce.Status == http.StatusTooManyRequests,
		errors.As(err, &ne) && ne.Status == http.StatusTooManyRequests:
		httpx.WriteError(w, http.StatusTooManyRequests, "the app asks to slow down; try again in a minute", "rate_limited")
	case errors.As(err, &ce) && (ce.Status == http.StatusNotFound || ce.Status == http.StatusForbidden),
		errors.As(err, &ne) && (ne.Status == http.StatusNotFound || ne.Status == http.StatusForbidden):
		httpx.WriteError(w, http.StatusNotFound, "the app did not find it, or no longer shares it", "not_found")
	case errors.Is(err, notion.ErrNoParent):
		httpx.WriteError(w, http.StatusConflict, err.Error(), "no_parent")
	default:
		slog.Error("appsapi: request failed", "error", err, "path", r.URL.Path)
		httpx.WriteError(w, http.StatusBadGateway, "the app did not answer as expected", "app_failed")
	}
}
