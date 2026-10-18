// Package sourceapi is documentation sites and GitHub repositories over HTTP
// (up-methods phase 18). The caller's identity comes from httpx.MustUserID;
// a knowledge base is authorized before anything is read, and a site or
// repository is resolved with the caller's id, so another user's answers
// exactly like a missing one.
package sourceapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/connectors/crawl"
	"github.com/D0bby999/anytools/internal/connectors/github"
	"github.com/D0bby999/anytools/internal/knowledge"
)

// Handler serves the site and repository routes.
type Handler struct {
	svc  *knowledge.Service
	auth *authz.Authorizer
}

// NewHandler builds the handler.
func NewHandler(svc *knowledge.Service, auth *authz.Authorizer) *Handler {
	return &Handler{svc: svc, auth: auth}
}

// RegisterRoutes registers this package's patterns on the mux. Adding and
// re-syncing are the upload budget: each fetches pages or a tarball and
// embeds what changed on the learner's key.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/kb/{id}/sites", h.listSites)
	mux.HandleFunc("POST /v1/kb/{id}/sites", h.addSite) // budget: upload
	mux.HandleFunc("GET /v1/sites/{id}", h.getSite)
	mux.HandleFunc("POST /v1/sites/{id}/resync", h.resyncSite) // budget: upload
	mux.HandleFunc("POST /v1/sites/{id}/cancel", h.cancelSite) // budget: none
	mux.HandleFunc("DELETE /v1/sites/{id}", h.deleteSite)      // budget: none
	mux.HandleFunc("GET /v1/kb/{id}/repos", h.listRepos)
	mux.HandleFunc("POST /v1/kb/{id}/repos", h.addRepo) // budget: upload
	mux.HandleFunc("GET /v1/repos/{id}", h.getRepo)
	mux.HandleFunc("POST /v1/repos/{id}/resync", h.resyncRepo) // budget: upload
	mux.HandleFunc("DELETE /v1/repos/{id}", h.deleteRepo)      // budget: none
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"GET /v1/kb/{id}/sites",
		"POST /v1/kb/{id}/sites",
		"GET /v1/sites/{id}",
		"POST /v1/sites/{id}/resync",
		"POST /v1/sites/{id}/cancel",
		"DELETE /v1/sites/{id}",
		"GET /v1/kb/{id}/repos",
		"POST /v1/kb/{id}/repos",
		"GET /v1/repos/{id}",
		"POST /v1/repos/{id}/resync",
		"DELETE /v1/repos/{id}",
	}
}

func pathID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		// A malformed id answers like an unowned one.
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return uuid.Nil, false
	}
	return id, true
}

// requireKB authorizes the knowledge base in the path, first.
func (h *Handler) requireKB(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	userID := httpx.MustUserID(r.Context())
	kbID, ok := pathID(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	if err := h.auth.OwnsKB(r.Context(), userID, kbID); err != nil {
		fail(w, r, err)
		return uuid.Nil, uuid.Nil, false
	}
	return userID, kbID, true
}

// ─────────────────────────────────────────────────────────────── sites

func (h *Handler) listSites(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}
	sites, err := h.svc.ListSites(r.Context(), userID, kbID)
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"sites": sites, "limits": map[string]int{
		"default_depth": crawl.DefaultDepth, "max_depth": crawl.MaxDepth,
		"default_pages": crawl.DefaultPages, "max_pages": crawl.MaxPages,
	}})
}

type addSiteRequest struct {
	URL   string `json:"url"`
	Depth *int   `json:"depth"`
	Pages *int   `json:"pages"`
}

func (h *Handler) addSite(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}
	var req addSiteRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil || req.URL == "" {
		httpx.WriteError(w, http.StatusBadRequest, "a start URL is required", "bad_request")
		return
	}
	depth, pages := crawl.DefaultDepth, crawl.DefaultPages
	if req.Depth != nil {
		depth = *req.Depth
	}
	if req.Pages != nil {
		pages = *req.Pages
	}
	site, jobID, err := h.svc.AddSite(r.Context(), userID, kbID, req.URL, depth, pages)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"site": site, "job_id": jobID})
}

func (h *Handler) getSite(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	site, pages, err := h.svc.GetSite(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"site": site, "pages": pages})
}

func (h *Handler) resyncSite(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	jobID, err := h.svc.ResyncSite(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"job_id": jobID})
}

func (h *Handler) cancelSite(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.CancelSite(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"cancelled": true})
}

func (h *Handler) deleteSite(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteSite(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ──────────────────────────────────────────────────────── repositories

func (h *Handler) listRepos(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}
	repos, err := h.svc.ListRepos(r.Context(), userID, kbID)
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"repos": repos, "defaults": map[string]any{
		"doc_extensions": github.DocExtensions, "code_extensions": github.CodeExtensions,
		"max_file_bytes": github.MaxFileBytes, "max_files": github.MaxFiles, "max_repo_bytes": github.MaxRepoBytes,
	}})
}

type addRepoRequest struct {
	URL        string   `json:"url"`
	Branch     string   `json:"branch"`
	Path       string   `json:"path"`
	Extensions []string `json:"extensions"`
	Ignore     []string `json:"ignore"`
}

func (h *Handler) addRepo(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}
	var req addRepoRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil || req.URL == "" {
		httpx.WriteError(w, http.StatusBadRequest, "a GitHub repository link is required", "bad_request")
		return
	}
	repo, jobID, err := h.svc.AddRepo(r.Context(), userID, kbID, knowledge.NewRepo{
		URL: req.URL, Branch: req.Branch, Path: req.Path, Extensions: req.Extensions, Ignore: req.Ignore,
	})
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"repo": repo, "job_id": jobID})
}

func (h *Handler) getRepo(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	repo, files, err := h.svc.GetRepo(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"repo": repo, "files": files})
}

func (h *Handler) resyncRepo(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	jobID, err := h.svc.ResyncRepo(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"job_id": jobID})
}

func (h *Handler) deleteRepo(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteRepo(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// fail maps an error to a response. authz.ErrNoAccess is a 404, never a
// 403: "not yours" and "does not exist" must answer alike.
func fail(w http.ResponseWriter, r *http.Request, err error) {
	// A learner whose files are kept in Drive that refused them is told
	// why, as every upload is (drive-user-storage phase 5).
	if httpx.WriteStorageError(w, err) {
		return
	}
	var le *knowledge.LinkError
	switch {
	case errors.Is(err, authz.ErrNoAccess):
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
	case errors.As(err, &le):
		status := http.StatusUnprocessableEntity
		switch le.Code {
		case knowledge.LinkBadURL:
			status = http.StatusBadRequest
		case knowledge.LinkBusy:
			status = http.StatusConflict
		}
		httpx.WriteError(w, status, le.Msg, le.Code)
	case errors.Is(err, knowledge.ErrDuplicateSource):
		httpx.WriteError(w, http.StatusConflict, err.Error(), "duplicate")
	case errors.Is(err, knowledge.ErrSourcesUnavailable):
		httpx.WriteError(w, http.StatusServiceUnavailable, "sites and repositories are not available on this server", "unavailable")
	default:
		slog.Error("sourceapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
