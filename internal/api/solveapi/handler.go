// Package solveapi is the HTTP surface of the solve capability: start a solve
// turn (typed and/or photographed problem, optionally "check my answer"),
// save a finished solution to the notebook, and turn it into a quiz question.
//
// A solve is a TURN on a chat session, started through chatapi.Handler.Start,
// so its stream, cancel and transcript are chat's own endpoints
// (GET /v1/turns/{id}/events and friends). The identity rule is the one every
// API package states: the caller comes from httpx.MustUserID and nowhere else.
package solveapi

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/chatapi"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/capabilities/solve"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/learning/ownversion"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// MaxImageBytes caps the decoded photo. A phone photo of a page is 2-4 MB; a
// vision model downsamples far below this anyway, and the image travels to the
// user's own provider on their own key.
const MaxImageBytes = 5 << 20

// maxBody is the JSON cap for POST /v1/solve: the image base64-encoded (4/3 of
// MaxImageBytes) plus room for the problem text.
const maxBody = MaxImageBytes*4/3 + 256<<10

// maxProblem caps the typed problem, like chat's own message cap.
const maxProblem = 32 << 10

// imageTypes are the formats every vision wire format AnyTools speaks accepts.
// The type is SNIFFED from the bytes, never taken from the client: a mislabeled
// file is refused here rather than by the provider, on the user's key.
var imageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true}

// Starter starts a turn on a chat session, and applies the learner's "write
// your own version first" exactly as chat's own POST does. *chatapi.Handler
// implements it.
type Starter interface {
	Start(ctx context.Context, userID uuid.UUID, req chatapi.StartRequest) (*runtime.Session, *runtime.Turn, *chatapi.StartError)
	CheckOwnVersion(ctx context.Context, userID uuid.UUID, sent *ownversion.Lines) (*ownversion.Lines, *chatapi.StartError)
}

// Messages reads a transcript row scoped to its owner. pg.ChatStore implements it.
type Messages interface {
	GetMessage(ctx context.Context, userID, messageID uuid.UUID) (*runtime.ChatMessage, error)
	GetSession(ctx context.Context, userID, sessionID uuid.UUID) (*runtime.Session, error)
}

// Questions writes to the question bank. pg.QuestionStore implements it.
type Questions interface {
	InsertQuestions(ctx context.Context, qs []quiz.Question) ([]quiz.Question, error)
}

// KBAuthorizer is the same ownership check chatapi and the tools use.
type KBAuthorizer interface {
	OwnsKB(ctx context.Context, userID, kbID uuid.UUID) (bool, error)
}

// Handler serves the solve routes.
type Handler struct {
	starter   Starter
	messages  Messages
	questions Questions
	authz     KBAuthorizer
	// notes is phase 8's notebook; nil until it merges, and "save" says so.
	notes tools.NoteWriter
}

// Config assembles a Handler.
type Config struct {
	Starter   Starter
	Messages  Messages
	Questions Questions
	Authz     KBAuthorizer
	Notes     tools.NoteWriter
}

// NewHandler builds the handler.
func NewHandler(cfg Config) *Handler {
	return &Handler{
		starter: cfg.Starter, messages: cfg.Messages, questions: cfg.Questions,
		authz: cfg.Authz, notes: cfg.Notes,
	}
}

// RegisterRoutes registers this package's patterns on the mux. Every pattern
// must also appear in Patterns(); the allowlist test fails in both directions.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/solve", h.start)                             // budget: generate
	mux.HandleFunc("POST /v1/solve/messages/{id}/note", h.saveNote)       // budget: none
	mux.HandleFunc("POST /v1/solve/messages/{id}/question", h.toQuestion) // budget: none
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"POST /v1/solve",
		"POST /v1/solve/messages/{id}/note",
		"POST /v1/solve/messages/{id}/question",
	}
}

type imageJSON struct {
	MimeType string `json:"mime_type"`
	Data     string `json:"data"`
}

type startRequest struct {
	SessionID  string     `json:"session_id"`
	Problem    string     `json:"problem"`
	Image      *imageJSON `json:"image"`
	Variant    string     `json:"variant"`
	UserAnswer string     `json:"user_answer"`
	KBIDs      []string   `json:"kb_ids"`
	// OwnVersion is the learner's three lines (internal/learning/ownversion).
	OwnVersion *ownversion.Lines `json:"own_version"`
}

func (h *Handler) start(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())

	var req startRequest
	if err := httpx.DecodeJSONLimit(w, r, &req, maxBody); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge, "that photo is larger than 5 MB", "image_too_large")
			return
		}
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}

	problem := strings.TrimSpace(req.Problem)
	if len(problem) > maxProblem {
		httpx.WriteError(w, http.StatusRequestEntityTooLarge, "that problem is too long", "message_too_long")
		return
	}

	var (
		images    []runtime.Image
		imageMeta []map[string]any
	)
	if req.Image != nil && req.Image.Data != "" {
		img, meta, msg := decodeImage(req.Image.Data)
		if msg != "" {
			httpx.WriteError(w, http.StatusBadRequest, msg, "bad_image")
			return
		}
		images, imageMeta = []runtime.Image{img}, []map[string]any{meta}
	}
	if problem == "" && len(images) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "type a problem or attach a photo of one", "empty_problem")
		return
	}

	variant := solve.VariantSolve
	answer := strings.TrimSpace(req.UserAnswer)
	if req.Variant == solve.VariantCheck {
		variant = solve.VariantCheck
		if answer == "" {
			httpx.WriteError(w, http.StatusBadRequest, "write the answer you want checked", "empty_answer")
			return
		}
		if len(answer) > maxProblem {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge, "that answer is too long", "message_too_long")
			return
		}
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

	lines, serr := h.starter.CheckOwnVersion(r.Context(), userID, req.OwnVersion)
	if serr != nil {
		httpx.WriteError(w, serr.Status, serr.Message, serr.Code)
		return
	}

	message := problem
	if message == "" {
		message = "Solve the problem in the photo."
	}
	// What was attached is recorded; the bytes are not. A transcript is read
	// on every later turn and listing, and a photo in it would be carried by
	// every one of those reads.
	stored := map[string]any{"images": imageMeta, "variant": variant, "user_answer": answer}
	params := map[string]string{"variant": variant}
	if variant == solve.VariantCheck {
		params["user_answer"] = answer
	}
	if lines != nil {
		stored["own_version"] = lines
		raw, _ := json.Marshal(lines)
		params[solve.ParamOwnVersion] = string(raw)
	}
	attachments, _ := json.Marshal(stored)

	sess, turn, serr := h.starter.Start(r.Context(), userID, chatapi.StartRequest{
		SessionID:   sessionID,
		Title:       solve.SessionTitle(problem, len(images) > 0),
		KBIDs:       req.KBIDs,
		Capability:  "solve",
		Message:     message,
		Attachments: attachments,
		Images:      images,
		Params:      params,
	})
	if serr != nil {
		httpx.WriteError(w, serr.Status, serr.Message, serr.Code)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{
		"session_id": sess.ID.String(),
		"turn_id":    turn.ID.String(),
		"status":     turn.Status,
	})
}

// decodeImage validates an inline image. The returned message is for the
// user; an empty one means the image is usable.
func decodeImage(data string) (runtime.Image, map[string]any, string) {
	// Tolerate a data: URL, which is what a browser's FileReader produces.
	if i := strings.Index(data, ";base64,"); strings.HasPrefix(data, "data:") && i > 0 {
		data = data[i+len(";base64,"):]
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(data))
	if err != nil {
		return runtime.Image{}, nil, "that photo could not be read"
	}
	if len(raw) > MaxImageBytes {
		return runtime.Image{}, nil, "that photo is larger than 5 MB"
	}
	mime := http.DetectContentType(raw)
	if !imageTypes[mime] {
		return runtime.Image{}, nil, "attach a PNG, JPEG, WebP or GIF image"
	}
	sum := sha256.Sum256(raw)
	return runtime.Image{MimeType: mime, Data: base64.StdEncoding.EncodeToString(raw)},
		map[string]any{"mime_type": mime, "bytes": len(raw), "sha256": hex.EncodeToString(sum[:])},
		""
}

// solution reads a finished solve message, or answers 404.
func (h *Handler) solution(w http.ResponseWriter, r *http.Request) (*runtime.ChatMessage, *solve.Result, []citations.Source, bool) {
	userID := httpx.MustUserID(r.Context())
	id, err := uuid.Parse(strings.TrimSpace(r.PathValue("id")))
	if err != nil {
		notFound(w)
		return nil, nil, nil, false
	}
	msg, err := h.messages.GetMessage(r.Context(), userID, id)
	if err != nil || msg.Role != runtime.RoleAssistant || msg.Capability != "solve" {
		notFound(w)
		return nil, nil, nil, false
	}
	var att struct {
		Sources []citations.Source `json:"sources"`
		Solve   *solve.Result      `json:"solve"`
	}
	if err := json.Unmarshal(msg.Attachments, &att); err != nil || att.Solve == nil {
		notFound(w)
		return nil, nil, nil, false
	}
	return msg, att.Solve, att.Sources, true
}

func (h *Handler) saveNote(w http.ResponseWriter, r *http.Request) {
	msg, result, _, ok := h.solution(w, r)
	if !ok {
		return
	}
	if h.notes == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable,
			"saving to the notebook is not available yet", "notebook_unavailable")
		return
	}
	userID := httpx.MustUserID(r.Context())
	noteID, err := h.notes.WriteNote(r.Context(), userID, msg.SessionID, noteTitle(result), msg.Content)
	if err != nil {
		slog.Error("solveapi: save note", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "could not save the note", "note_failed")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"note_id": noteID})
}

type questionRequest struct {
	KBID string `json:"kb_id"`
}

// toQuestion files the solved problem in the question bank: the problem as the
// prompt, the final answer as the answer, the write-up as the explanation.
//
// A question needs a knowledge base (questions.kb_id is NOT NULL, and the bank
// is organised by it). The request may name one the caller owns; otherwise the
// solve session's first is used; with neither, the refusal says what to do.
func (h *Handler) toQuestion(w http.ResponseWriter, r *http.Request) {
	msg, result, sources, ok := h.solution(w, r)
	if !ok {
		return
	}
	userID := httpx.MustUserID(r.Context())

	var req questionRequest
	if r.ContentLength != 0 {
		if err := httpx.DecodeJSON(w, r, &req); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "invalid request body", "bad_request")
			return
		}
	}

	var kbID uuid.UUID
	if s := strings.TrimSpace(req.KBID); s != "" {
		id, err := uuid.Parse(s)
		if err != nil {
			notFound(w)
			return
		}
		kbID = id
	} else if sess, err := h.messages.GetSession(r.Context(), userID, msg.SessionID); err == nil && len(sess.KBIDs) > 0 {
		kbID = sess.KBIDs[0]
	}
	if kbID == uuid.Nil {
		httpx.WriteError(w, http.StatusBadRequest,
			"choose a knowledge base to keep this question in", "kb_required")
		return
	}
	owns, err := h.authz.OwnsKB(r.Context(), userID, kbID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "could not check knowledge base access", "authz_failed")
		return
	}
	if !owns {
		notFound(w)
		return
	}

	answer := strings.TrimSpace(result.FinalAnswer)
	if answer == "" {
		httpx.WriteError(w, http.StatusBadRequest, "this solution has no final answer to test", "no_answer")
		return
	}
	var chunkIDs []uuid.UUID
	for _, s := range sources {
		if s.Kind != citations.KindChunk {
			continue
		}
		if id, err := uuid.Parse(s.ID); err == nil {
			chunkIDs = append(chunkIDs, id)
		}
	}
	sessionID := msg.SessionID
	stored, err := h.questions.InsertQuestions(r.Context(), []quiz.Question{{
		UserID: userID, KBID: kbID, SessionID: &sessionID,
		Prompt: truncate(result.Problem, 4000), Type: quiz.TypeShort,
		Answer: answer, Explanation: msg.Content, Difficulty: quiz.DifficultyMedium,
		SourceChunkIDs: chunkIDs,
	}})
	if err != nil || len(stored) != 1 {
		slog.Error("solveapi: store question", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "could not save the question", "question_failed")
		return
	}
	// Unrevealed, like every question the bank hands out before an attempt.
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"question": stored[0].View(false)})
}

func noteTitle(r *solve.Result) string {
	line, _, _ := strings.Cut(strings.TrimSpace(r.Problem), "\n")
	return truncate("Solution: "+line, 200)
}

// truncate cuts on a rune boundary: both destinations are `text` columns.
func truncate(s string, max int) string {
	if r := []rune(s); len(r) > max {
		return string(r[:max])
	}
	return s
}

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
}
