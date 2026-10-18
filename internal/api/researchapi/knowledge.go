package researchapi

import (
	"context"
	"errors"
	"log/slog"
	"mime"
	"net/http"
	"strings"
	"sync"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/research"
	"github.com/D0bby999/anytools/internal/citations"
)

// knowledge.go — POST /v1/research/reports/{id}/knowledge: keep studying a
// report by adding it, and optionally the web pages it cites, to one of the
// learner's knowledge bases. From there quiz, mastery and chat treat it like
// any other document.

// maxSourcePages bounds how many cited pages one request fetches.
const maxSourcePages = 20

// pageParallelism bounds concurrent page fetches for one request.
const pageParallelism = 4

// ErrAlreadyInKnowledgeBase is AddDocument's answer when the knowledge base
// already holds the same bytes: not a failure, the learner already has it.
var ErrAlreadyInKnowledgeBase = errors.New("already in this knowledge base")

// Knowledge adds documents to a knowledge base the caller owns.
type Knowledge interface {
	OwnsKB(ctx context.Context, userID, kbID uuid.UUID) (bool, error)
	AddDocument(ctx context.Context, userID, kbID uuid.UUID, filename string, data []byte) error
}

// PageFetcher reads a public web page through the SSRF guard.
type PageFetcher interface {
	FetchPage(ctx context.Context, url string) (data []byte, contentType string, err error)
}

type toKnowledgeRequest struct {
	KBID           string `json:"kb_id"`
	IncludeSources bool   `json:"include_sources"`
}

func (h *Handler) toKnowledge(w http.ResponseWriter, r *http.Request) {
	rep, ok := h.report(w, r)
	if !ok {
		return
	}
	if h.knowledge == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "knowledge bases are not available", "knowledge_unavailable")
		return
	}
	var req toKnowledgeRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}
	userID := httpx.MustUserID(r.Context())
	kbID, err := uuid.Parse(strings.TrimSpace(req.KBID))
	if err != nil {
		notFound(w)
		return
	}
	owns, err := h.knowledge.OwnsKB(r.Context(), userID, kbID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "could not check the knowledge base", "load_failed")
		return
	}
	if !owns {
		notFound(w)
		return
	}

	reportAdded := true
	err = h.knowledge.AddDocument(r.Context(), userID, kbID,
		research.ExportFilename(*rep), []byte(research.ExportMarkdown(*rep)))
	switch {
	case errors.Is(err, ErrAlreadyInKnowledgeBase):
		reportAdded = false
	case err != nil:
		slog.Error("researchapi: add report to knowledge base", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "could not add the report", "add_failed")
		return
	}

	var pages pageCounts
	if req.IncludeSources && h.pages != nil {
		pages = h.addSourcePages(r.Context(), userID, kbID, rep.Sources)
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"kb_id": kbID.String(), "report_added": reportAdded, "report_already": !reportAdded,
		"sources_added": pages.added, "sources_already": pages.already, "sources_failed": pages.failed,
	})
}

type pageCounts struct{ added, already, failed int }

// addSourcePages fetches each cited web page once and adds it as a document.
// A page that cannot be fetched or read is counted, not fatal; one whose bytes
// the knowledge base already holds is counted as already there.
func (h *Handler) addSourcePages(ctx context.Context, userID, kbID uuid.UUID, sources []citations.Source) (out pageCounts) {
	seen := map[string]bool{}
	var pages []citations.Source
	for _, s := range sources {
		if s.Kind != citations.KindURL || s.URL == "" || seen[s.URL] || len(pages) == maxSourcePages {
			continue
		}
		seen[s.URL] = true
		pages = append(pages, s)
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, pageParallelism)
	for _, s := range pages {
		wg.Add(1)
		go func(s citations.Source) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			err := h.addPage(ctx, userID, kbID, s)
			mu.Lock()
			switch {
			case err == nil:
				out.added++
			case errors.Is(err, ErrAlreadyInKnowledgeBase):
				out.already++
			default:
				out.failed++
			}
			mu.Unlock()
		}(s)
	}
	wg.Wait()
	return out
}

func (h *Handler) addPage(ctx context.Context, userID, kbID uuid.UUID, s citations.Source) error {
	data, contentType, err := h.pages.FetchPage(ctx, s.URL)
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return errors.New("empty page")
	}
	ext := ".html"
	if mt, _, _ := mime.ParseMediaType(contentType); mt == "application/pdf" {
		ext = ".pdf"
	}
	title := strings.TrimSpace(s.Title)
	if title == "" {
		title = s.URL
	}
	name := strings.Map(func(r rune) rune {
		if strings.ContainsRune(`/\:*?"<>|`, r) || r < 0x20 {
			return '-'
		}
		return r
	}, title)
	if rs := []rune(name); len(rs) > 100 {
		name = string(rs[:100])
	}
	err = h.knowledge.AddDocument(ctx, userID, kbID, name+ext, data)
	if err != nil && !errors.Is(err, ErrAlreadyInKnowledgeBase) {
		slog.Warn("researchapi: add source page", "error", err)
	}
	return err
}
