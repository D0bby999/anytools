// Package kbapi is the Knowledge Center's HTTP surface.
//
// One rule governs every handler in this package: the caller's identity comes
// from httpx.UserID(ctx) and from nowhere else, and the FIRST thing any handler
// touching a named resource does is ask authz. Not the second thing, and never
// "the query has a user_id filter so it is fine" — red-team RT-3 found exactly
// that reasoning holding up a query that had lost its filter.
package kbapi

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/sse"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	mediafile "github.com/D0bby999/anytools/internal/connectors/media"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/embed"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/rag/retrieve"
)

// Handler serves the knowledge routes.
type Handler struct {
	svc       *knowledge.Service
	auth      *authz.Authorizer
	retriever *retrieve.Retriever
	providers knowledge.Providers
}

// NewHandler returns a Handler.
func NewHandler(svc *knowledge.Service, auth *authz.Authorizer, retriever *retrieve.Retriever, providers knowledge.Providers) *Handler {
	return &Handler{svc: svc, auth: auth, retriever: retriever, providers: providers}
}

// RegisterRoutes registers every knowledge route.
//
// `GET /v1/kb/{id}/events` was added in the wiring commit, on top of phase 6's
// internal/api/sse and phase 5's knowledge.Events. It does not REPLACE
// `GET /v1/kb/{id}/documents`: a stream can be missed and the fan-out is
// process-local (docs/architecture.md §2), while the document list reads the
// same truth out of the database.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/kb", h.listKBs)
	mux.HandleFunc("POST /v1/kb", h.createKB) // budget: none
	mux.HandleFunc("GET /v1/kb/{id}", h.getKB)
	mux.HandleFunc("DELETE /v1/kb/{id}", h.deleteKB) // budget: none
	mux.HandleFunc("GET /v1/kb/{id}/documents", h.listDocuments)
	mux.HandleFunc("GET /v1/kb/{id}/events", h.streamEvents)
	mux.HandleFunc("POST /v1/kb/{id}/documents", h.uploadDocument)         // budget: upload
	mux.HandleFunc("DELETE /v1/kb/{id}/documents/{doc}", h.deleteDocument) // budget: none
	mux.HandleFunc("POST /v1/kb/{id}/reindex", h.reindex)                  // budget: upload
	mux.HandleFunc("POST /v1/kb/{id}/query", h.query)                      // budget: search
	mux.HandleFunc("GET /v1/documents/{id}/content", h.documentContent)
	// Links (learning-depth phase 4, links.go).
	mux.HandleFunc("POST /v1/kb/{id}/links", h.addLink) // budget: upload
	mux.HandleFunc("GET /v1/documents/{id}", h.getDocument)
	mux.HandleFunc("PATCH /v1/documents/{id}", h.patchDocument)           // budget: none
	mux.HandleFunc("POST /v1/documents/{id}/resync", h.resync)            // budget: upload
	mux.HandleFunc("POST /v1/documents/{id}/transcript", h.setTranscript) // budget: upload
	mux.HandleFunc("POST /v1/documents/{id}/transcribe", h.transcribe)    // budget: upload
	// Audio and video files (up-methods phase 15, media.go).
	mux.HandleFunc("GET /v1/documents/{id}/media", h.media)
	mux.HandleFunc("POST /v1/documents/{id}/transcribe/cancel", h.cancelTranscription) // budget: none
	// Up-methods phase 16: a photo document's page photos (photos.go).
	mux.HandleFunc("GET /v1/documents/{id}/photo", h.documentPhoto)
}

// Patterns lists what RegisterRoutes registers, for
// internal/api/server.go's RegisteredPatterns and the allowlist test.
func Patterns() []string {
	return []string{
		"GET /v1/kb",
		"POST /v1/kb",
		"GET /v1/kb/{id}",
		"DELETE /v1/kb/{id}",
		"GET /v1/kb/{id}/documents",
		"GET /v1/kb/{id}/events",
		"POST /v1/kb/{id}/documents",
		"DELETE /v1/kb/{id}/documents/{doc}",
		"POST /v1/kb/{id}/reindex",
		"POST /v1/kb/{id}/query",
		"GET /v1/documents/{id}/content",
		"POST /v1/kb/{id}/links",
		"GET /v1/documents/{id}",
		"PATCH /v1/documents/{id}",
		"POST /v1/documents/{id}/resync",
		"POST /v1/documents/{id}/transcript",
		"POST /v1/documents/{id}/transcribe",
		"GET /v1/documents/{id}/media",
		"POST /v1/documents/{id}/transcribe/cancel",
		"GET /v1/documents/{id}/photo",
	}
}

// ─────────────────────────────────────────────────────── knowledge bases

func (h *Handler) listKBs(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	kbs, err := h.svc.ListKBs(r.Context(), userID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if kbs == nil {
		kbs = []knowledge.KBSummary{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"knowledge_bases": kbs})
}

type createKBRequest struct {
	Name string `json:"name"`
}

func (h *Handler) createKB(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req createKBRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	kb, err := h.svc.CreateKB(r.Context(), userID, req.Name)
	if err != nil {
		if kb != nil {
			// The KB exists; only its partial index failed. Say so rather than
			// reporting a failure the user would retry into a duplicate.
			slog.Error("kbapi: knowledge base created without its vector index", "error", err, "kb", kb.ID)
			httpx.WriteJSON(w, http.StatusCreated, kb)
			return
		}
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, kb)
}

func (h *Handler) getKB(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}
	kb, err := h.svc.GetKB(r.Context(), userID, kbID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, kb)
}

func (h *Handler) deleteKB(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteKB(r.Context(), userID, kbID); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─────────────────────────────────────────────────────────── documents

func (h *Handler) listDocuments(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}
	docs, err := h.svc.ListDocuments(r.Context(), userID, kbID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if docs == nil {
		docs = []knowledge.Document{}
	}
	// no-store, because this is a status surface: a cached copy showing
	// "parsing" after the document is ready is worse than a round trip.
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"documents": docs})
}

// streamEvents is the live half of the document status surface.
//
// Ownership is checked FIRST, by requireKB, before a single header is written.
// An SSE handler that opened the stream and then discovered the knowledge base
// was not the caller's would have to report the refusal inside a 200 that has
// already been flushed — and a client written against that would be parsing
// authorization out of the event body.
//
// There is deliberately NO resume here, and `after_seq` / `Last-Event-ID` are
// not honoured: knowledge.Events is an in-process fan-out with no backlog, so
// the only honest answer to "replay from seq 41" is the document list, which
// reads the database. `seq` is still emitted as `id:` because it is what makes
// a gap visible to a client that cares.
func (h *Handler) streamEvents(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}
	release, ok := sse.Acquire(w, userID)
	if !ok {
		return
	}
	defer release()

	events, unsubscribe := h.svc.Events().Subscribe(userID, kbID)
	// The unsubscribe is what closes `events`, which is what ends the pump
	// below. Leaking it would make every future publish copy into a channel
	// nobody reads.
	defer unsubscribe()

	frames := make(chan sse.Event)
	go func() {
		defer close(frames)
		for ev := range events {
			select {
			case frames <- sse.Event{Seq: ev.Seq, Name: ev.Type, Data: ev}:
			case <-r.Context().Done():
				return
			}
		}
	}()

	sse.Stream(w, r.Context().Done(), frames)
}

func (h *Handler) uploadDocument(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}

	// The cap is enforced on the REQUEST, before anything is buffered. Checking
	// the part's size after reading it would mean a 2 GB body had already been
	// read into memory to discover it was too big. The request may carry the
	// largest file of any kind (an audio or video file, up-methods phase 15);
	// the file's own cap follows from its name, and the part is streamed
	// straight into a bounded read rather than spooled to disk first.
	r.Body = http.MaxBytesReader(w, r.Body, knowledge.MaxMediaBytes+(1<<20))
	form, status, msg := readUploadForm(r)
	if status != 0 {
		code := "bad_request"
		if status == http.StatusRequestEntityTooLarge {
			code = "too_large"
		}
		httpx.WriteError(w, status, msg, code)
		return
	}

	// Several photos may come as one document, one page each in the order
	// of their parts (up-methods phase 16, photos.go). Several parts are
	// refused otherwise, so one request is still one result.
	if len(form.files) > 1 || form.oneDocument {
		if !form.oneDocument {
			httpx.WriteError(w, http.StatusBadRequest,
				"send one file per request, or photos with one_document=true", "bad_request")
			return
		}
		h.uploadPhotos(w, r, userID, kbID, form.files)
		return
	}

	file := form.files[0]
	res, err := h.svc.Upload(r.Context(), userID, kbID, file.Name, file.Data)
	h.uploaded(w, r, res, err)
}

// uploaded answers an upload of one document, from a file or from photos.
func (h *Handler) uploaded(w http.ResponseWriter, r *http.Request, res *knowledge.UploadResult, err error) {
	if err != nil {
		if errors.Is(err, parse.ErrPhotoTooLarge) {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge,
				fmt.Sprintf("each photo must be %d MB or smaller", parse.MaxPhotoBytes>>20), "too_large")
			return
		}
		if errors.Is(err, knowledge.ErrPhotoSetTooLarge) {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge,
				fmt.Sprintf("the photos together must be %d MB or smaller", knowledge.MaxUploadBytes>>20), "too_large")
			return
		}
		if errors.Is(err, parse.ErrTooManyPhotos) {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge,
				fmt.Sprintf("one document holds at most %d photos", parse.MaxPhotosPerDocument), "too_many_pages")
			return
		}
		if errors.Is(err, parse.ErrUnsupportedType) {
			httpx.WriteError(w, http.StatusUnsupportedMediaType,
				"that file type is not supported. Accepted: "+strings.Join(sortedExtensions(), ", "),
				"unsupported_type")
			return
		}
		if errors.Is(err, parse.ErrPageCapExceeded) || strings.Contains(err.Error(), "the limit is") {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge, err.Error(), "too_many_pages")
			return
		}
		if isDuplicate(err) {
			httpx.WriteError(w, http.StatusConflict,
				"this file is already in this knowledge base", "duplicate")
			return
		}
		if errors.Is(err, knowledge.ErrMediaTooLarge) {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("the file must be %d MB or smaller", knowledge.MaxMediaBytes>>20), "too_large")
			return
		}
		h.linkFail(w, r, err)
		return
	}
	body := map[string]any{"document": res.Document}
	// A recording waits for the learner to choose how it is transcribed, so
	// nothing is queued for it yet.
	if res.JobID != uuid.Nil {
		body["job_id"] = res.JobID
	}
	httpx.WriteJSON(w, http.StatusAccepted, body)
}

func (h *Handler) deleteDocument(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}
	docID, err := uuid.Parse(r.PathValue("doc"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return
	}
	// The document is authorized on its own, not inferred from the KB: a
	// document id from another user's KB must not be deletable just because the
	// caller owns the kb id in the path.
	if _, err := h.auth.OwnsDocument(r.Context(), userID, docID); err != nil {
		h.fail(w, r, err)
		return
	}
	if err := h.svc.DeleteDocument(r.Context(), userID, kbID, docID); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) documentContent(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	docID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return
	}
	if _, err := h.auth.OwnsDocument(r.Context(), userID, docID); err != nil {
		h.fail(w, r, err)
		return
	}

	page := 0
	if raw := r.URL.Query().Get("page"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			httpx.WriteError(w, http.StatusBadRequest, "page must be a positive integer", "bad_request")
			return
		}
		page = n
	}

	content, err := h.svc.DocumentContent(r.Context(), userID, docID, page)
	if err != nil {
		if errors.Is(err, knowledge.ErrNoParsedContent) {
			httpx.WriteError(w, http.StatusConflict,
				"this document has not finished processing yet", "not_ready")
			return
		}
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, content)
}

// ──────────────────────────────────────────────────────── reindex, query

func (h *Handler) reindex(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}
	jobID, err := h.svc.Reindex(r.Context(), userID, kbID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"job_id": jobID})
}

type queryRequest struct {
	Query string `json:"query"`
	Limit int    `json:"limit,omitempty"`
}

// query is the retrieval debug endpoint.
//
// It embeds the question with the SAME route the KB is pinned to. Using a
// different one would compare vectors from two spaces and return plausible
// nonsense, which on a debug endpoint is worse than an error: it would be used
// as evidence that retrieval works.
func (h *Handler) query(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}
	var req queryRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	if strings.TrimSpace(req.Query) == "" {
		httpx.WriteError(w, http.StatusBadRequest, "query is required", "bad_request")
		return
	}

	kb, err := h.svc.GetKB(r.Context(), userID, kbID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if kb.NeedsReembed {
		httpx.WriteError(w, http.StatusConflict,
			"this knowledge base's embedding model changed. Reindex it before querying.", "needs_reembed")
		return
	}
	if kb.Dims == 0 {
		httpx.WriteError(w, http.StatusConflict,
			"this knowledge base has no indexed documents yet", "not_indexed")
		return
	}

	embedder, err := h.providers.EmbedderFor(r.Context(), userID)
	if err != nil {
		httpx.WriteError(w, http.StatusConflict,
			"no embedding model is configured — add one in Settings", "no_embedder")
		return
	}
	if embedder.Model() != kb.EmbeddingModel {
		httpx.WriteError(w, http.StatusConflict,
			"your embedding model changed since this knowledge base was indexed. Reindex it before querying.",
			"needs_reembed")
		return
	}

	// EmbedQuery, not EmbedDocument: this is the question, and a task-aware
	// model places a question near the answers it should retrieve rather than
	// near other questions (knowledge.EmbedTask).
	vectors, dims, err := embedder.Embed(r.Context(), []string{req.Query}, knowledge.EmbedQuery)
	if err != nil || len(vectors) != 1 {
		httpx.WriteError(w, http.StatusBadGateway,
			"the embedding model could not be reached", "embed_failed")
		return
	}
	if dims != kb.Dims {
		httpx.WriteError(w, http.StatusConflict,
			"your embedding model changed width since this knowledge base was indexed. Reindex it.",
			"needs_reembed")
		return
	}
	if err := embed.ValidateDims(dims); err != nil {
		h.fail(w, r, err)
		return
	}

	hits, err := h.retriever.Search(r.Context(), retrieve.Query{
		UserID: userID,
		KBIDs:  []uuid.UUID{kbID},
		Text:   req.Query,
		Vector: vectors[0],
		Dims:   dims,
		Limit:  req.Limit,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if hits == nil {
		hits = []retrieve.Hit{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"hits": hits})
}

// ─────────────────────────────────────────────────────────── internals

// requireKB parses the kb id and checks ownership. Every handler with an `{id}`
// starts here; that is what makes "authorization first" a shape rather than a
// discipline.
func (h *Handler) requireKB(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	userID := httpx.MustUserID(r.Context())
	kbID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		// A malformed id is answered exactly like an unowned one. Anything else
		// tells a prober which uuids are syntactically interesting.
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return uuid.Nil, uuid.Nil, false
	}
	if err := h.auth.OwnsKB(r.Context(), userID, kbID); err != nil {
		h.fail(w, r, err)
		return uuid.Nil, uuid.Nil, false
	}
	return userID, kbID, true
}

// fail maps an error to a response. authz.ErrNoAccess is a 404, never a 403:
// "you may not have this" and "this does not exist" must be indistinguishable
// or the endpoint is an existence oracle.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	if httpx.WriteStorageError(w, err) {
		// A file in the learner's Drive that it cannot give or take now
		// (drive-user-storage phase 3).
		return
	}
	if errors.Is(err, authz.ErrNoAccess) {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return
	}
	if errors.Is(err, blob.ErrNotFound) {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return
	}
	if errors.Is(err, retrieve.ErrNeedsReembed) {
		httpx.WriteError(w, http.StatusConflict, err.Error(), "needs_reembed")
		return
	}
	if errors.Is(err, parse.ErrUnsupportedType) {
		httpx.WriteError(w, http.StatusUnsupportedMediaType, err.Error(), "unsupported_type")
		return
	}
	// Anything else is ours. The message goes to the log with the path; the
	// response says nothing, because a database error string reaches the
	// browser through the BFF.
	slog.Error("kbapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
	httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
}

func isDuplicate(err error) bool { return knowledge.IsDuplicateDocument(err) }

func sortedExtensions() []string {
	exts := append(parse.AllowedExtensions(), mediafile.Extensions...)
	for i := range exts {
		for j := i + 1; j < len(exts); j++ {
			if exts[j] < exts[i] {
				exts[i], exts[j] = exts[j], exts[i]
			}
		}
	}
	return exts
}
