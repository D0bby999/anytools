package kbapi

import (
	"errors"
	"fmt"
	"mime"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/knowledge"
)

// links.go — web pages and YouTube videos (learning-depth phase 4).
//
// Every handler authorizes the document or knowledge base FIRST, before it
// reads a body, so a foreign id answers 404 whatever the body says.

type addLinkRequest struct {
	URL      string `json:"url"`
	AutoSync bool   `json:"auto_sync"`
}

// addLink turns a URL into a document. The upload budget: it fetches a page
// or asks YouTube for captions, and the parse that follows spends the
// learner's key.
func (h *Handler) addLink(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}
	var req addLinkRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	if strings.TrimSpace(req.URL) == "" {
		httpx.WriteError(w, http.StatusBadRequest, "a link is required", "bad_request")
		return
	}
	res, err := h.svc.AddLink(r.Context(), userID, kbID, req.URL, req.AutoSync)
	if err != nil {
		if isDuplicate(err) || errors.Is(err, knowledge.ErrDuplicateSource) {
			httpx.WriteError(w, http.StatusConflict, "this link is already in this knowledge base", "duplicate")
			return
		}
		h.linkFail(w, r, err)
		return
	}
	if res.Feed != nil {
		// A podcast feed or a YouTube playlist or channel (up-methods phase
		// 17): its page lists the entries to pick from.
		httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"feed": res.Feed})
		return
	}
	body := map[string]any{"document": res.Document}
	if res.JobID != uuid.Nil {
		body["job_id"] = res.JobID
	}
	httpx.WriteJSON(w, http.StatusAccepted, body)
}

// requireDocument parses and authorizes the document id in the path.
func (h *Handler) requireDocument(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	userID := httpx.MustUserID(r.Context())
	docID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return uuid.Nil, uuid.Nil, false
	}
	if _, err := h.auth.OwnsDocument(r.Context(), userID, docID); err != nil {
		h.fail(w, r, err)
		return uuid.Nil, uuid.Nil, false
	}
	return userID, docID, true
}

// getDocument is one document with, for a video, the engines that could
// transcribe it and what each would cost.
func (h *Handler) getDocument(w http.ResponseWriter, r *http.Request) {
	userID, docID, ok := h.requireDocument(w, r)
	if !ok {
		return
	}
	doc, err := h.svc.GetDocument(r.Context(), userID, docID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	body := map[string]any{"document": doc}
	if doc.Timed() {
		est, err := h.svc.EstimateTranscription(r.Context(), userID, doc)
		if err != nil {
			h.fail(w, r, err)
			return
		}
		body["transcribe"] = map[string]any{
			"available":               est.Available,
			"duration_seconds":        est.DurationSeconds,
			"estimated_tokens":        est.EstimatedTokens,
			"windows":                 est.Windows,
			"free_tier_daily_seconds": youtube.FreeTierDailySeconds,
			"engines":                 est.Engines,
			"audio_blocked":           est.AudioBlocked,
			"queue_ahead":             est.QueueAhead,
			// An uploaded recording whose header gave no length: the page
			// says "unknown length" and the learner confirms (phase 15).
			"length_unknown": doc.SourceKind == knowledge.SourceMedia && est.DurationSeconds <= 0,
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, body)
}

type patchDocumentRequest struct {
	AutoSync *bool `json:"auto_sync"`
}

func (h *Handler) patchDocument(w http.ResponseWriter, r *http.Request) {
	userID, docID, ok := h.requireDocument(w, r)
	if !ok {
		return
	}
	var req patchDocumentRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil || req.AutoSync == nil {
		httpx.WriteError(w, http.StatusBadRequest, "auto_sync is required", "bad_request")
		return
	}
	doc, err := h.svc.SetAutoSync(r.Context(), userID, docID, *req.AutoSync)
	if err != nil {
		h.linkFail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"document": doc})
}

// resync re-fetches a web page now. Re-parses and re-embeds only when the
// page changed, but the fetch alone is outbound work, so it is budgeted.
func (h *Handler) resync(w http.ResponseWriter, r *http.Request) {
	userID, docID, ok := h.requireDocument(w, r)
	if !ok {
		return
	}
	res, changed, err := h.svc.ResyncWeb(r.Context(), userID, docID)
	if err != nil {
		h.linkFail(w, r, err)
		return
	}
	body := map[string]any{"document": res.Document, "changed": changed}
	if res.JobID != uuid.Nil {
		body["job_id"] = res.JobID
	}
	httpx.WriteJSON(w, http.StatusAccepted, body)
}

type transcriptRequest struct {
	Text  string `json:"text"`
	Track string `json:"track"`
}

// maxTranscriptRequest bounds the body: the transcript cap plus multipart
// framing.
const maxTranscriptRequest = youtube.MaxTranscriptBytes + (256 << 10)

// setTranscript takes a .vtt/.srt upload (multipart, part "file"), a pasted
// transcript (JSON {text}) or another caption track (JSON {track}).
func (h *Handler) setTranscript(w http.ResponseWriter, r *http.Request) {
	userID, docID, ok := h.requireDocument(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxTranscriptRequest)

	var in knowledge.TranscriptInput
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType == "multipart/form-data" {
		if err := r.ParseMultipartForm(4 << 20); err != nil {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge,
				fmt.Sprintf("the subtitle file must be %d MB or smaller", youtube.MaxTranscriptBytes>>20), "too_large")
			return
		}
		defer func() { _ = r.MultipartForm.RemoveAll() }()
		file, header, err := r.FormFile("file")
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "a file part named \"file\" is required", "bad_request")
			return
		}
		defer file.Close()
		data, tooBig, err := blob.ReadAllLimited(file, youtube.MaxTranscriptBytes)
		if err != nil {
			h.fail(w, r, err)
			return
		}
		if tooBig {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge,
				fmt.Sprintf("the subtitle file must be %d MB or smaller", youtube.MaxTranscriptBytes>>20), "too_large")
			return
		}
		in.Filename, in.Data = header.Filename, data
	} else {
		var req transcriptRequest
		if err := httpx.DecodeJSON(w, r, &req); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
			return
		}
		in.Text, in.Track = req.Text, strings.TrimSpace(req.Track)
	}

	res, err := h.svc.SetTranscript(r.Context(), userID, docID, in)
	if err != nil {
		h.linkFail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"document": res.Document, "job_id": res.JobID})
}

// transcribeRequest is the engine the learner chose (up-methods phase 21):
// "builtin", "gemini", or "byok" with one of their stt route's connections.
// An empty body is a pre-phase-21 client: Gemini reading the URL.
type transcribeRequest struct {
	Engine       string    `json:"engine"`
	ConnectionID uuid.UUID `json:"connection_id"`
	// ConfirmUnknownLength: the learner goes on with a recording whose
	// length, and so whose cost, is not known (up-methods phase 15).
	ConfirmUnknownLength bool `json:"confirm_unknown_length"`
}

// transcribe queues a transcript by the chosen engine. The document in the
// path is the caller's (requireDocument) before anything in the body is read;
// the connection in the body is resolved on the caller's own stt route.
func (h *Handler) transcribe(w http.ResponseWriter, r *http.Request) {
	userID, docID, ok := h.requireDocument(w, r)
	if !ok {
		return
	}
	var req transcribeRequest
	if r.ContentLength != 0 {
		if err := httpx.DecodeJSON(w, r, &req); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
			return
		}
	}
	start, err := h.svc.StartTranscriptionBy(r.Context(), userID, docID,
		knowledge.EngineChoice{Engine: strings.TrimSpace(req.Engine), ConnectionID: req.ConnectionID,
			LengthConfirmed: req.ConfirmUnknownLength})
	if err != nil {
		h.linkFail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, start)
}

// linkFail maps a link refusal to a status; its message was written for the
// learner and carries nothing a site or a provider sent.
func (h *Handler) linkFail(w http.ResponseWriter, r *http.Request, err error) {
	var le *knowledge.LinkError
	if errors.As(err, &le) {
		status := http.StatusUnprocessableEntity
		switch le.Code {
		case knowledge.LinkBadURL, knowledge.LinkBadTranscript, knowledge.LinkNotVideo:
			status = http.StatusBadRequest
		case knowledge.LinkTooLarge:
			status = http.StatusRequestEntityTooLarge
		case knowledge.LinkBusy, knowledge.LinkNoTranscriber, knowledge.LinkSTTQuota, knowledge.LinkDurationUnknown,
			knowledge.LinkNotTranscribing, knowledge.LinkFeedLimit:
			status = http.StatusConflict
		}
		httpx.WriteError(w, status, le.Msg, le.Code)
		return
	}
	if errors.Is(err, knowledge.ErrAutoSyncLimit) {
		httpx.WriteError(w, http.StatusConflict, err.Error(), "auto_sync_limit")
		return
	}
	if errors.Is(err, knowledge.ErrLinksUnavailable) {
		httpx.WriteError(w, http.StatusServiceUnavailable, "links are not available on this server", "unavailable")
		return
	}
	h.fail(w, r, err)
}
