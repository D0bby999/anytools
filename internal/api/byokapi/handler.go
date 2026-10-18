// Package byokapi exposes the BYOK surface: connections, routes, web-search
// keys and the readiness matrix.
//
// Every handler here reads the caller from httpx.UserID(ctx) and passes it as
// the first argument of every store call. There is no handler that takes a user
// id from a path, a query string or a body — the only exception the API has is
// POST /v1/auth/identity, which creates the user. Cross-user isolation is
// therefore not a rule each handler remembers: it is the only shape a handler
// in this package can be written in, and handler_isolation_test.go proves it
// route by route.
package byokapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/oauth"
	"github.com/D0bby999/anytools/internal/store"
)

// Handler serves every /v1/byok route plus GET /v1/readiness.
type Handler struct {
	svc *byok.Service
}

// NewHandler builds the BYOK API handler.
func NewHandler(svc *byok.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes attaches this handler's routes to the mux. Every pattern here
// must also appear in api.RegisteredPatterns(), which a structural test
// enforces in both directions.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/byok/connections", h.listConnections)
	mux.HandleFunc("POST /v1/byok/connections", h.createConnection)             // budget: none
	mux.HandleFunc("PUT /v1/byok/connections/{id}", h.updateConnection)         // budget: none
	mux.HandleFunc("DELETE /v1/byok/connections/{id}", h.deleteConnection)      // budget: none
	mux.HandleFunc("POST /v1/byok/connections/{id}/verify", h.verifyConnection) // budget: verify
	mux.HandleFunc("GET /v1/byok/connections/{id}/models", h.listModels)        // budget: verify

	// The two experimental lanes. Separate endpoints rather than a `kind` field
	// on the create call, because their inputs have nothing in common: one
	// receives a token triple the user obtained elsewhere, the other receives an
	// authorisation code this server will exchange.
	mux.HandleFunc("POST /v1/byok/connections/relay", h.createRelayConnection)          // budget: none
	mux.HandleFunc("POST /v1/byok/connections/gemini-sub", h.createGeminiSubConnection) // budget: none
	mux.HandleFunc("GET /v1/byok/connections/gemini-sub/auth-url", h.geminiSubAuthURL)
	// Two-step sign-ins (subscriptions.go): start, then finish with the handle.
	mux.HandleFunc("POST /v1/byok/connections/copilot/start", h.startCopilot)     // budget: none
	mux.HandleFunc("POST /v1/byok/connections/copilot/finish", h.finishCopilot)   // budget: none
	mux.HandleFunc("POST /v1/byok/connections/claude-sub/start", h.startClaude)   // budget: none
	mux.HandleFunc("POST /v1/byok/connections/claude-sub/finish", h.finishClaude) // budget: none

	mux.HandleFunc("GET /v1/byok/routes", h.listRoutes)
	mux.HandleFunc("PUT /v1/byok/routes/{function}", h.setRoute) // budget: none

	mux.HandleFunc("GET /v1/byok/search-connections", h.listSearchConnections)
	mux.HandleFunc("POST /v1/byok/search-connections", h.createSearchConnection)             // budget: none
	mux.HandleFunc("DELETE /v1/byok/search-connections/{id}", h.deleteSearchConnection)      // budget: none
	mux.HandleFunc("POST /v1/byok/search-connections/{id}/verify", h.verifySearchConnection) // budget: verify

	mux.HandleFunc("GET /v1/readiness", h.readiness)
}

// connectionResponse is the connection as the browser sees it.
//
// There is no secret field and no api_key field, and there never may be: the
// store method these handlers call does not decrypt, so this struct could not
// carry one even if someone added it. `has_secret` is the whole of what the UI
// needs — a key is present, its value is not anyone's business again.
type connectionResponse struct {
	ID             string     `json:"id"`
	Provider       string     `json:"provider"`
	Kind           string     `json:"kind"`
	Name           string     `json:"name"`
	APIBase        string     `json:"api_base"`
	HasSecret      bool       `json:"has_secret"`
	VerifiedAt     *time.Time `json:"verified_at,omitempty"`
	VerifiedModel  string     `json:"verified_model,omitempty"`
	LastError      string     `json:"last_error,omitempty"`
	CooldownUntil  *time.Time `json:"cooldown_until,omitempty"`
	CooldownReason string     `json:"cooldown_reason,omitempty"`
	Dims           int        `json:"dims,omitempty"`
	NeedsReconnect bool       `json:"needs_reconnect,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

func toConnectionResponse(c store.ProviderConnection) connectionResponse {
	out := connectionResponse{
		ID:             c.ID.String(),
		Provider:       c.Provider,
		Kind:           c.Kind,
		Name:           c.Name,
		APIBase:        c.APIBase,
		HasSecret:      c.HasSecret,
		VerifiedAt:     c.VerifiedAt,
		VerifiedModel:  c.Settings.VerifiedModel,
		LastError:      c.LastError,
		CooldownUntil:  c.Settings.CooldownUntil,
		CooldownReason: c.Settings.CooldownReason,
		Dims:           c.Settings.Dims,
		CreatedAt:      c.CreatedAt,
	}
	if c.Settings.OAuth != nil {
		out.NeedsReconnect = c.Settings.OAuth.NeedsReconnect
	}
	return out
}

func (h *Handler) listConnections(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	conns, err := h.svc.ListConnections(r.Context(), userID)
	if err != nil {
		writeErr(w, err, "list connections")
		return
	}
	out := make([]connectionResponse, 0, len(conns))
	for _, c := range conns {
		out = append(out, toConnectionResponse(c))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"connections": out,
		"providers":   byok.APIKeyProviders(),
		// The UI needs to know whether to render the experimental cards at all.
		// Returning it here rather than reading an env var in the BFF keeps one
		// process in charge of the answer.
		"lanes_enabled": h.svc.LanesEnabled(),
	})
}

type createConnectionRequest struct {
	Provider string `json:"provider"`
	Name     string `json:"name"`
	APIBase  string `json:"api_base"`
	Secret   string `json:"secret"`
}

func (h *Handler) createConnection(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req createConnectionRequest
	if !decode(w, r, &req) {
		return
	}
	conn, err := h.svc.CreateConnection(r.Context(), userID, byok.NewConnection{
		Provider: req.Provider, Name: req.Name, APIBase: req.APIBase, Secret: req.Secret,
	})
	if err != nil {
		writeErr(w, err, "create connection")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toConnectionResponse(*conn))
}

type updateConnectionRequest struct {
	Name    *string `json:"name"`
	APIBase *string `json:"api_base"`
	Secret  *string `json:"secret"`
}

func (h *Handler) updateConnection(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathUUID(w, r, "id")
	if !ok {
		return
	}
	var req updateConnectionRequest
	if !decode(w, r, &req) {
		return
	}
	conn, err := h.svc.UpdateConnection(r.Context(), userID, id, store.ConnectionUpdate{
		Name: req.Name, APIBase: req.APIBase, Secret: req.Secret,
	})
	if err != nil {
		writeErr(w, err, "update connection")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toConnectionResponse(*conn))
}

func (h *Handler) deleteConnection(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathUUID(w, r, "id")
	if !ok {
		return
	}
	if err := h.svc.DeleteConnection(r.Context(), userID, id); err != nil {
		writeErr(w, err, "delete connection")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type verifyRequest struct {
	Function string `json:"function"`
}

type verifyResponse struct {
	OK      bool   `json:"ok"`
	Model   string `json:"model,omitempty"`
	Dims    int    `json:"dims,omitempty"`
	Message string `json:"message,omitempty"`
}

func (h *Handler) verifyConnection(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathUUID(w, r, "id")
	if !ok {
		return
	}

	// The body is optional: verifying without naming a function checks that the
	// key can hold a conversation, which is what "does this key work" means to
	// someone who just pasted one.
	fn := byok.FunctionChat
	if r.ContentLength > 0 {
		var req verifyRequest
		if !decode(w, r, &req) {
			return
		}
		if req.Function != "" {
			parsed, valid := byok.ParseFunction(req.Function)
			if !valid {
				httpx.WriteError(w, http.StatusBadRequest, "unknown function", "bad_request")
				return
			}
			fn = parsed
		}
	}

	result, err := h.svc.VerifyConnection(r.Context(), userID, id, fn)
	if err != nil {
		writeErr(w, err, "verify connection")
		return
	}
	// A failed verify is a successful REQUEST: the user asked whether the key
	// works and got a truthful answer. Returning 4xx here would make the BFF's
	// error path swallow the message that says why.
	httpx.WriteJSON(w, http.StatusOK, verifyResponse{
		OK: result.OK, Model: result.Model, Dims: result.Dims, Message: result.Message,
	})
}

func (h *Handler) listModels(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathUUID(w, r, "id")
	if !ok {
		return
	}
	models, err := h.svc.ListModels(r.Context(), userID, id)
	if err != nil {
		writeErr(w, err, "list models")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"models": models})
}

type relayRequest struct {
	Name         string `json:"name"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	AccountID    string `json:"account_id"`
}

func (h *Handler) createRelayConnection(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req relayRequest
	if !decode(w, r, &req) {
		return
	}
	conn, err := h.svc.SaveRelayConnection(r.Context(), userID, req.Name, oauth.RelayTokens{
		AccessToken: req.AccessToken, RefreshToken: req.RefreshToken,
		ExpiresIn: req.ExpiresIn, AccountID: req.AccountID,
	})
	if err != nil {
		writeErr(w, err, "create relay connection")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toConnectionResponse(*conn))
}

// geminiSubAuthURL builds the Google consent URL for a redirect the caller
// names. The redirect must be registered with the deployment's own OAuth
// client, which is why it is an input rather than something derived here.
func (h *Handler) geminiSubAuthURL(w http.ResponseWriter, r *http.Request) {
	url, err := h.svc.GeminiConsentURL(r.URL.Query().Get("redirect_uri"))
	if err != nil {
		writeErr(w, err, "gemini auth url")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"url": url})
}

type geminiSubRequest struct {
	Name        string `json:"name"`
	Code        string `json:"code"`
	RedirectURI string `json:"redirect_uri"`
}

func (h *Handler) createGeminiSubConnection(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req geminiSubRequest
	if !decode(w, r, &req) {
		return
	}
	conn, err := h.svc.SaveGeminiSubConnection(r.Context(), userID, req.Name, req.Code, req.RedirectURI)
	if err != nil {
		writeErr(w, err, "create gemini subscription connection")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toConnectionResponse(*conn))
}

type routeEntryResponse struct {
	ConnectionID string `json:"connection_id"`
	Model        string `json:"model"`
	Dims         int    `json:"dims,omitempty"`
}

func (h *Handler) listRoutes(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	routes, err := h.svc.ListRoutes(r.Context(), userID)
	if err != nil {
		writeErr(w, err, "list routes")
		return
	}

	// Keyed by function, with an entry for EVERY function including the empty
	// ones: a UI that only received the configured functions would have to know
	// the enum itself to render the rest, which is the second copy of the list
	// this phase exists to avoid.
	byFunction := map[string][]routeEntryResponse{}
	for _, fn := range byok.AllFunctions() {
		byFunction[string(fn)] = []routeEntryResponse{}
	}
	for _, r := range routes {
		byFunction[r.Function] = append(byFunction[r.Function], routeEntryResponse{
			ConnectionID: r.ConnectionID.String(), Model: r.Model, Dims: r.Dims,
		})
	}

	functions := make([]string, 0, len(byok.AllFunctions()))
	for _, fn := range byok.AllFunctions() {
		functions = append(functions, string(fn))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"routes":            byFunction,
		"functions":         functions,
		"max_chain_entries": byok.MaxChainEntries,
	})
}

type setRouteRequest struct {
	Entries []struct {
		ConnectionID string `json:"connection_id"`
		Model        string `json:"model"`
		Dims         int    `json:"dims"`
	} `json:"entries"`
}

func (h *Handler) setRoute(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	fn, ok := byok.ParseFunction(r.PathValue("function"))
	if !ok {
		httpx.WriteError(w, http.StatusNotFound, "unknown function", "not_found")
		return
	}

	var req setRouteRequest
	if !decode(w, r, &req) {
		return
	}
	entries := make([]byok.RouteEntry, 0, len(req.Entries))
	for _, e := range req.Entries {
		id, err := uuid.Parse(e.ConnectionID)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "connection_id must be a uuid", "bad_request")
			return
		}
		entries = append(entries, byok.RouteEntry{ConnectionID: id, Model: e.Model, Dims: e.Dims})
	}

	if err := h.svc.SetRoute(r.Context(), userID, fn, entries); err != nil {
		writeErr(w, err, "set route")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type searchConnectionResponse struct {
	ID         string     `json:"id"`
	Provider   string     `json:"provider"`
	VerifiedAt *time.Time `json:"verified_at,omitempty"`
	LastError  string     `json:"last_error,omitempty"`
}

func (h *Handler) listSearchConnections(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	rows, err := h.svc.ListSearchConnections(r.Context(), userID)
	if err != nil {
		writeErr(w, err, "list search connections")
		return
	}
	out := make([]searchConnectionResponse, 0, len(rows))
	for _, c := range rows {
		out = append(out, searchConnectionResponse{
			ID: c.ID.String(), Provider: c.Provider, VerifiedAt: c.VerifiedAt, LastError: c.LastError,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"search_connections": out,
		"providers":          append(byok.SearchProviders(), byok.ProviderOpenAlex, byok.ProviderGitHub, byok.ProviderZotero, byok.ProviderYouTubeData),
		// With no key, research still searches DuckDuckGo unless the operator
		// turned the fallback off.
		"keyless_fallback": h.svc.KeylessSearch(),
	})
}

type createSearchRequest struct {
	Provider string `json:"provider"`
	Secret   string `json:"secret"`
	// ZoteroUser is a Zotero library's numeric user id, stored encrypted
	// with its key (up-methods phase 20). Ignored for other providers.
	ZoteroUser string `json:"zotero_user,omitempty"`
}

func (h *Handler) createSearchConnection(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req createSearchRequest
	if !decode(w, r, &req) {
		return
	}
	secret := req.Secret
	if strings.TrimSpace(req.Provider) == byok.ProviderZotero {
		var err error
		if secret, err = byok.ZoteroSecret(req.ZoteroUser, req.Secret); err != nil {
			writeErr(w, err, "save search connection")
			return
		}
	}
	row, err := h.svc.SaveSearchConnection(r.Context(), userID, req.Provider, secret)
	if err != nil {
		writeErr(w, err, "save search connection")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, searchConnectionResponse{
		ID: row.ID.String(), Provider: row.Provider, VerifiedAt: row.VerifiedAt,
	})
}

func (h *Handler) deleteSearchConnection(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathUUID(w, r, "id")
	if !ok {
		return
	}
	if err := h.svc.DeleteSearchConnection(r.Context(), userID, id); err != nil {
		writeErr(w, err, "delete search connection")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) verifySearchConnection(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	id, ok := pathUUID(w, r, "id")
	if !ok {
		return
	}
	result, err := h.svc.VerifySearchConnection(r.Context(), userID, id)
	if err != nil {
		writeErr(w, err, "verify search connection")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, verifyResponse{OK: result.OK, Message: result.Message})
}

func (h *Handler) readiness(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	readiness, err := h.svc.Compute(r.Context(), userID)
	if err != nil {
		writeErr(w, err, "compute readiness")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, readiness)
}

// decode reads a JSON body, answering 400 and reporting false on failure.
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := httpx.DecodeJSON(w, r, v); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return false
	}
	return true
}

// pathUUID parses a path parameter, answering 404 rather than 400 on a
// malformed id: "not a uuid" and "not yours" must be indistinguishable, or the
// endpoint becomes a probe for other people's connection ids.
func pathUUID(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue(name))
	if err != nil || id == uuid.Nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return uuid.Nil, false
	}
	return id, true
}

// writeErr maps a service error onto a status, and is the only place in this
// package that writes a non-2xx body.
//
// The default branch deliberately does NOT include err.Error(): a database
// message, a provider body or a DSN must never reach the browser. It goes to
// the log with the operation name instead.
func writeErr(w http.ResponseWriter, err error, op string) {
	switch {
	case errors.Is(err, store.ErrConnectionNotFound), errors.Is(err, store.ErrSearchConnectionNotFound):
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
	case errors.Is(err, byok.ErrInvalidInput):
		httpx.WriteError(w, http.StatusBadRequest, byok.UserMessage(err), "bad_request")
	case errors.Is(err, oauth.ErrLanesDisabled):
		httpx.WriteError(w, http.StatusForbidden,
			"Experimental subscription lanes are turned off.", "lanes_disabled")
	case errors.Is(err, oauth.ErrNoClientPair):
		httpx.WriteError(w, http.StatusFailedDependency,
			"This deployment has no Google OAuth client configured for the Gemini Code Assist lane.", "no_client_pair")
	case errors.Is(err, oauth.ErrPermanentGrantFailure):
		httpx.WriteError(w, http.StatusBadRequest,
			"The provider rejected those credentials.", "bad_credentials")
	default:
		// NOT err.Error(): providers.HTTPError formats its whole upstream body,
		// which can echo the prompt or the document and can carry a key
		// fragment. A server log is not a safe place for either.
		slog.Error("byokapi: "+op, "error", byok.SafeErrorText(err))
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
