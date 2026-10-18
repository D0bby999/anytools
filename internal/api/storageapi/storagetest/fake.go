// Package storagetest is an in-memory Settings → Storage for tests: the
// learner's choice, their Drive connection, the move job and the exports
// saved, without Postgres or Google. Feature handlers' tests use it to mount
// their "Save to my Drive" routes.
package storagetest

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/storageapi"
	"github.com/D0bby999/anytools/internal/blob"
)

// Saved is one export written to a learner's Drive.
type Saved struct {
	UserID          uuid.UUID
	Key, Name, MIME string
	Data            string
}

// Fake implements storageapi.Settings, DriveFiles and Moves.
type Fake struct {
	mu sync.Mutex
	// Storage is each learner's choice; a learner not listed has Default.
	Storage map[uuid.UUID]string
	Default string
	// NotReady makes Ready answer this error for every learner.
	NotReady error
	// FolderErr and SaveErr fail EnsureFolders and SaveExport.
	FolderErr, SaveErr error
	Folders            []uuid.UUID
	Saved              []Saved
	// Plan is what PlanMove answers.
	Plan []blob.MoveItem
	// Jobs are the move jobs enqueued, latest last.
	Jobs []*storageapi.MoveJob
	jobs map[uuid.UUID]uuid.UUID // job → user
}

// New is a fake where every learner keeps their files in a ready Drive.
func New() *Fake {
	return &Fake{Storage: map[uuid.UUID]string{}, Default: blob.StorageDrive, jobs: map[uuid.UUID]uuid.UUID{}}
}

// Handler is storageapi's handler over the fake.
func (f *Fake) Handler() *storageapi.Handler { return storageapi.NewHandler(f, f, f) }

// Exports is "Save to my Drive" over the fake.
func (f *Fake) Exports() *storageapi.Exports { return f.Handler().Exports() }

func (f *Fake) FileStorage(_ context.Context, userID uuid.UUID) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if s, ok := f.Storage[userID]; ok {
		return s, nil
	}
	return f.Default, nil
}

func (f *Fake) SetFileStorage(_ context.Context, userID uuid.UUID, storage string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Storage[userID] = storage
	return nil
}

func (f *Fake) Timezone(context.Context, uuid.UUID) (string, error) { return "Asia/Ho_Chi_Minh", nil }

func (f *Fake) Ready(context.Context, uuid.UUID) error { return f.NotReady }

func (f *Fake) EnsureFolders(_ context.Context, userID uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.FolderErr != nil {
		return f.FolderErr
	}
	f.Folders = append(f.Folders, userID)
	return nil
}

func (f *Fake) PlanMove(context.Context, uuid.UUID, blob.MoveDirection) ([]blob.MoveItem, error) {
	return f.Plan, nil
}

func (f *Fake) SaveExport(_ context.Context, userID uuid.UUID, key, name, mimeType string, data []byte) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.SaveErr != nil {
		return "", f.SaveErr
	}
	f.Saved = append(f.Saved, Saved{UserID: userID, Key: key, Name: name, MIME: mimeType, Data: string(data)})
	return "fileExport01", nil
}

func (f *Fake) Usage(context.Context, uuid.UUID) (storageapi.Usage, error) {
	return storageapi.Usage{ServerFiles: 2, ServerBytes: 2048, DriveFiles: 1, DriveBytes: 1024}, nil
}

// ErrDuplicate is what Enqueue answers for a second running move, in the
// words of the partial unique index.
var ErrDuplicate = errors.New(`duplicate key value violates unique constraint "jobs_one_storage_move_per_user"`)

func (f *Fake) Enqueue(_ context.Context, userID uuid.UUID, kind string, payload any, _ int) (uuid.UUID, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, j := range f.Jobs {
		if f.jobs[j.ID] == userID && (j.Status == "queued" || j.Status == "running") {
			return uuid.Nil, ErrDuplicate
		}
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return uuid.Nil, err
	}
	j := &storageapi.MoveJob{ID: uuid.New(), Status: "queued", Payload: raw, Progress: json.RawMessage(`{}`)}
	f.Jobs = append(f.Jobs, j)
	f.jobs[j.ID] = userID
	return j.ID, nil
}

func (f *Fake) RequestCancel(_ context.Context, userID, jobID uuid.UUID) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, j := range f.Jobs {
		if j.ID == jobID && f.jobs[j.ID] == userID && (j.Status == "queued" || j.Status == "running") {
			j.CancelRequested = true
			return true, nil
		}
	}
	return false, nil
}

func (f *Fake) Latest(_ context.Context, userID uuid.UUID) (*storageapi.MoveJob, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := len(f.Jobs) - 1; i >= 0; i-- {
		if f.jobs[f.Jobs[i].ID] == userID {
			j := *f.Jobs[i]
			return &j, nil
		}
	}
	return nil, nil
}

// SetJob changes a learner's latest job, as the worker would.
func (f *Fake) SetJob(userID uuid.UUID, status, progress, lastError string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := len(f.Jobs) - 1; i >= 0; i-- {
		if f.jobs[f.Jobs[i].ID] == userID {
			f.Jobs[i].Status, f.Jobs[i].Progress, f.Jobs[i].LastError = status, json.RawMessage(progress), lastError
			return
		}
	}
}
