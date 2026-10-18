// Package storageapi is Settings → Storage over HTTP: where a learner's own
// files are kept, moving the existing ones, and saving exports to their
// Drive (drive-user-storage phase 2).
//
// The caller's identity comes from httpx.MustUserID and nothing else: no
// route here names another resource, so there is nothing of anyone else's
// to reach. The move job is planned from the caller's own files and runs as
// the caller.
package storageapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/jobs"
)

// JobKind is the move job.
const JobKind = "storage_move"

// MaxAttempts is the move job's attempts: a retry resumes at the first file
// not yet moved (jobs.RunUnits).
const MaxAttempts = 2

// Errors the Drive side answers with, in this package's words. The wiring
// translates the connector's own errors into these.
var (
	// ErrDriveNotConnected is a learner with no Drive connection.
	ErrDriveNotConnected = errors.New("storage: Google Drive is not connected")
	// ErrDriveReconnect is a connection Google stopped honouring.
	ErrDriveReconnect = errors.New("storage: Google Drive needs to be reconnected")
	// ErrDriveFull is a Drive with no room for the file.
	ErrDriveFull = errors.New("storage: the learner's Google Drive is full")
)

// Settings is users.file_storage, and the learner's zone for export names.
type Settings interface {
	FileStorage(ctx context.Context, userID uuid.UUID) (string, error)
	SetFileStorage(ctx context.Context, userID uuid.UUID, storage string) error
	Timezone(ctx context.Context, userID uuid.UUID) (string, error)
}

// DriveFiles is the Drive backend (blob.Drive) and its connection.
type DriveFiles interface {
	// Ready reports nil for a healthy connection, else ErrDriveNotConnected
	// or ErrDriveReconnect.
	Ready(ctx context.Context, userID uuid.UUID) error
	EnsureFolders(ctx context.Context, userID uuid.UUID) error
	PlanMove(ctx context.Context, userID uuid.UUID, dir blob.MoveDirection) ([]blob.MoveItem, error)
	SaveExport(ctx context.Context, userID uuid.UUID, key, name, mimeType string, data []byte) (string, error)
	// Usage is what the learner keeps on the server and in Drive.
	Usage(ctx context.Context, userID uuid.UUID) (Usage, error)
}

// Usage is the space a learner's own files take.
type Usage struct {
	ServerFiles  int64 `json:"server_files"`
	ServerBytes  int64 `json:"server_bytes"`
	DriveFiles   int64 `json:"drive_files"`
	DriveBytes   int64 `json:"drive_bytes"`
	DriveMissing int64 `json:"drive_missing"`
}

// MoveJob is the learner's latest move, as the job queue holds it.
type MoveJob struct {
	ID              uuid.UUID
	Status          string
	Payload         json.RawMessage
	Progress        json.RawMessage
	LastError       string
	CancelRequested bool
}

// Moves is the job queue, for the move job only.
type Moves interface {
	Enqueue(ctx context.Context, userID uuid.UUID, kind string, payload any, maxAttempts int) (uuid.UUID, error)
	RequestCancel(ctx context.Context, userID, jobID uuid.UUID) (bool, error)
	// Latest returns the learner's latest move job, or nil.
	Latest(ctx context.Context, userID uuid.UUID) (*MoveJob, error)
}

// MovePayload is the move job's plan: the direction and every file, fixed
// when the learner asked, so a retry runs the same units.
type MovePayload struct {
	Direction blob.MoveDirection `json:"direction"`
	Items     []blob.MoveItem    `json:"items"`
}

// Handler serves Settings → Storage.
type Handler struct {
	settings Settings
	files    DriveFiles
	moves    Moves
}

// NewHandler builds the handler. files is nil when Drive is not configured:
// the routes still answer, with the server as the only choice.
func NewHandler(settings Settings, files DriveFiles, moves Moves) *Handler {
	return &Handler{settings: settings, files: files, moves: moves}
}

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/me/file-storage", h.get)
	mux.HandleFunc("PUT /v1/me/file-storage", h.put)                     // budget: none
	mux.HandleFunc("POST /v1/me/file-storage/move", h.move)              // budget: upload
	mux.HandleFunc("POST /v1/me/file-storage/move/cancel", h.cancelMove) // budget: none
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"GET /v1/me/file-storage",
		"PUT /v1/me/file-storage",
		"POST /v1/me/file-storage/move",
		"POST /v1/me/file-storage/move/cancel",
	}
}

type driveState struct {
	// Configured is false on a deployment with no Google OAuth client.
	Configured bool `json:"configured"`
	// Ready is a connection that works; Reason says why not.
	Ready  bool   `json:"ready"`
	Reason string `json:"reason,omitempty"`
}

type moveState struct {
	ID         uuid.UUID          `json:"id"`
	Direction  blob.MoveDirection `json:"direction"`
	Status     string             `json:"status"`
	Done       int                `json:"done"`
	Total      int                `json:"total"`
	DoneBytes  int64              `json:"done_bytes"`
	TotalBytes int64              `json:"total_bytes"`
	// Error is a code, never the job's own error text.
	Error string `json:"error,omitempty"`
}

type statusResponse struct {
	Storage string     `json:"storage"`
	Drive   driveState `json:"drive"`
	Usage   Usage      `json:"usage"`
	Move    *moveState `json:"move"`
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	st, err := h.status(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		internal(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, st)
}

func (h *Handler) status(ctx context.Context, userID uuid.UUID) (*statusResponse, error) {
	storage, err := h.settings.FileStorage(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := &statusResponse{Storage: storage}
	if h.files != nil {
		out.Drive.Configured = true
		switch err := h.files.Ready(ctx, userID); {
		case err == nil:
			out.Drive.Ready = true
		case errors.Is(err, ErrDriveNotConnected):
			out.Drive.Reason = "drive_not_connected"
		case errors.Is(err, ErrDriveReconnect):
			out.Drive.Reason = "drive_reconnect"
		default:
			return nil, err
		}
		if out.Usage, err = h.files.Usage(ctx, userID); err != nil {
			return nil, err
		}
	}
	job, err := h.moves.Latest(ctx, userID)
	if err != nil {
		return nil, err
	}
	if job != nil {
		out.Move = describeMove(job)
	}
	return out, nil
}

// describeMove turns the job into progress the page can show: files and
// bytes done of the plan.
func describeMove(job *MoveJob) *moveState {
	var p MovePayload
	_ = json.Unmarshal(job.Payload, &p)
	prog := jobs.ProgressOf(&jobs.Job{Progress: job.Progress})
	m := &moveState{ID: job.ID, Direction: p.Direction, Status: job.Status, Done: prog.Done, Total: len(p.Items)}
	for i, it := range p.Items {
		m.TotalBytes += it.Bytes
		if i < prog.Done {
			m.DoneBytes += it.Bytes
		}
	}
	if m.Done > m.Total {
		m.Done = m.Total
	}
	if job.Status == "failed" {
		switch {
		case job.CancelRequested || strings.Contains(job.LastError, jobs.ErrCancelled.Error()):
			m.Status, m.Error = "cancelled", ""
		case strings.HasPrefix(job.LastError, codeReconnect):
			m.Error = codeReconnect
		case strings.HasPrefix(job.LastError, codeFull):
			m.Error = codeFull
		default:
			m.Error = "move_failed"
		}
	}
	return m
}

// Error codes a stopped move's error starts with (MoveError), so the page can
// say why without showing the job's own text.
const (
	codeReconnect = "drive_reconnect"
	codeFull      = "drive_full"
)

// MoveError prefixes a move unit's error with its code, for describeMove.
func MoveError(err error) string {
	switch {
	case errors.Is(err, ErrDriveReconnect), errors.Is(err, ErrDriveNotConnected):
		return codeReconnect
	case errors.Is(err, ErrDriveFull):
		return codeFull
	}
	return ""
}

type putRequest struct {
	Storage string `json:"storage"`
}

// put changes where new files are written. Drive needs a connection that
// works and its folders, made now so a broken connection is found here
// rather than at the first upload. Nothing moves: the existing files stay
// where they are until the learner starts a move.
func (h *Handler) put(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req putRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	if req.Storage != blob.StorageServer && req.Storage != blob.StorageDrive {
		httpx.WriteError(w, http.StatusBadRequest, `storage is "server" or "drive"`, "bad_request")
		return
	}
	if running, err := h.moveRunning(r.Context(), userID); err != nil {
		internal(w, r, err)
		return
	} else if running {
		httpx.WriteError(w, http.StatusConflict, "your files are being moved; wait for the move to finish or stop it first", "move_running")
		return
	}
	if req.Storage == blob.StorageDrive {
		if !h.driveUsable(w, r, userID) {
			return
		}
		if err := h.files.EnsureFolders(r.Context(), userID); err != nil {
			driveFailed(w, r, err)
			return
		}
	}
	if err := h.settings.SetFileStorage(r.Context(), userID, req.Storage); err != nil {
		internal(w, r, err)
		return
	}
	h.get(w, r)
}

// driveUsable answers 409 with the reason when the learner's Drive cannot be
// used now.
func (h *Handler) driveUsable(w http.ResponseWriter, r *http.Request, userID uuid.UUID) bool {
	if h.files == nil {
		httpx.WriteError(w, http.StatusConflict, "Google Drive is not available on this server", "drive_unavailable")
		return false
	}
	if err := h.files.Ready(r.Context(), userID); err != nil {
		driveFailed(w, r, err)
		return false
	}
	return true
}

func (h *Handler) moveRunning(ctx context.Context, userID uuid.UUID) (bool, error) {
	job, err := h.moves.Latest(ctx, userID)
	if err != nil || job == nil {
		return false, err
	}
	return job.Status == "queued" || job.Status == "running", nil
}

// move starts moving every existing file to where the learner now keeps
// them: to Drive when they chose Drive, back to the server otherwise.
func (h *Handler) move(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	if h.files == nil {
		httpx.WriteError(w, http.StatusConflict, "Google Drive is not available on this server", "drive_unavailable")
		return
	}
	storage, err := h.settings.FileStorage(r.Context(), userID)
	if err != nil {
		internal(w, r, err)
		return
	}
	dir := blob.MoveToServer
	if storage == blob.StorageDrive {
		dir = blob.MoveToDrive
	}
	// Moving back needs Drive too: the files are read from it.
	if !h.driveUsable(w, r, userID) {
		return
	}
	if running, err := h.moveRunning(r.Context(), userID); err != nil {
		internal(w, r, err)
		return
	} else if running {
		httpx.WriteError(w, http.StatusConflict, "a move is already running", "move_running")
		return
	}
	items, err := h.files.PlanMove(r.Context(), userID, dir)
	if err != nil {
		internal(w, r, err)
		return
	}
	if len(items) == 0 {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"move": nil, "nothing_to_move": true})
		return
	}
	if _, err := h.moves.Enqueue(r.Context(), userID, JobKind, MovePayload{Direction: dir, Items: items}, MaxAttempts); err != nil {
		// The partial unique index refuses a second move at once.
		if strings.Contains(err.Error(), "jobs_one_storage_move_per_user") {
			httpx.WriteError(w, http.StatusConflict, "a move is already running", "move_running")
			return
		}
		internal(w, r, err)
		return
	}
	st, err := h.status(r.Context(), userID)
	if err != nil {
		internal(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, st)
}

// cancelMove stops the move after the file in flight. Files already moved
// stay where they now are; reads follow them.
func (h *Handler) cancelMove(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	job, err := h.moves.Latest(r.Context(), userID)
	if err != nil {
		internal(w, r, err)
		return
	}
	if job == nil || (job.Status != "queued" && job.Status != "running") {
		httpx.WriteError(w, http.StatusNotFound, "no move is running", "not_found")
		return
	}
	ok, err := h.moves.RequestCancel(r.Context(), userID, job.ID)
	if err != nil {
		internal(w, r, err)
		return
	}
	if !ok {
		httpx.WriteError(w, http.StatusNotFound, "no move is running", "not_found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// driveFailed answers a Drive refusal with its own code and sentence.
func driveFailed(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrDriveNotConnected):
		httpx.WriteError(w, http.StatusConflict, "connect Google Drive in Settings first", "drive_not_connected")
	case errors.Is(err, ErrDriveReconnect):
		httpx.WriteError(w, http.StatusConflict, "reconnect Google Drive in Settings", "drive_reconnect")
	case errors.Is(err, ErrDriveFull):
		httpx.WriteError(w, http.StatusConflict, "your Google Drive is full", "drive_full")
	default:
		slog.Warn("storageapi: Google Drive could not be reached", "path", r.URL.Path, "error", err)
		httpx.WriteError(w, http.StatusBadGateway, "Google Drive could not be reached; try again", "drive_failed")
	}
}

func internal(w http.ResponseWriter, r *http.Request, err error) {
	slog.Error("storageapi: request failed", "path", r.URL.Path, "error", err)
	httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
}
