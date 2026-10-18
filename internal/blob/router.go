package blob

import (
	"context"
	"errors"
	"io"

	"github.com/google/uuid"
)

// router.go — one storage seam, chosen per learner (drive-user-storage
// phase 0).
//
// A learner's own files (originals, recordings, generated audio, exam
// papers) live in the backend BackendFor names for them: the server's disk
// today, their Google Drive once they turn it on (phase 1). What search and
// teaching need stays on the server whatever they choose: parsed Markdown is
// derived, read on every search, and rebuilt from the original, so the
// parsed methods always go to the server's Local.

// Backend is one place a learner's files can live.
type Backend interface {
	Store
	ObjectStore
}

// BackendFor names the backend that holds a learner's files.
type BackendFor func(ctx context.Context, userID uuid.UUID) (Backend, error)

// Router is a Store and an ObjectStore that sends each call to the calling
// learner's backend.
type Router struct {
	local      *Local
	backendFor BackendFor
	// others are every backend besides local that may hold a learner's
	// files, or a part of them (the Drive backend's cache). Account deletion
	// asks each of them, whichever one the learner chose last.
	others []Backend
}

var (
	_ Store       = (*Router)(nil)
	_ ObjectStore = (*Router)(nil)
)

// NewRouter routes through backendFor. A nil backendFor keeps every learner
// on local. others names the other backends backendFor may choose (the
// Drive backend, phase 1), so DeleteUser reaches them all.
func NewRouter(local *Local, backendFor BackendFor, others ...Backend) *Router {
	if backendFor == nil {
		backendFor = func(context.Context, uuid.UUID) (Backend, error) { return local, nil }
	}
	return &Router{local: local, backendFor: backendFor, others: others}
}

// Root is the server's data directory, for scratch space (job directories)
// that is never a learner's file.
func (r *Router) Root() string { return r.local.Root() }

func (r *Router) backend(ctx context.Context, userID uuid.UUID) (Backend, error) {
	b, err := r.backendFor(ctx, userID)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, errors.New("blob: no storage backend for this user")
	}
	return b, nil
}

func (r *Router) PutOriginal(ctx context.Context, userID uuid.UUID, data []byte) (string, error) {
	b, err := r.backend(ctx, userID)
	if err != nil {
		return "", err
	}
	return b.PutOriginal(ctx, userID, data)
}

func (r *Router) GetOriginal(ctx context.Context, userID uuid.UUID, digest string) ([]byte, error) {
	b, err := r.backend(ctx, userID)
	if err != nil {
		return nil, err
	}
	return b.GetOriginal(ctx, userID, digest)
}

func (r *Router) OpenOriginal(ctx context.Context, userID uuid.UUID, digest string) (*File, error) {
	b, err := r.backend(ctx, userID)
	if err != nil {
		return nil, err
	}
	return b.OpenOriginal(ctx, userID, digest)
}

func (r *Router) DeleteOriginal(ctx context.Context, userID uuid.UUID, digest string) error {
	b, err := r.backend(ctx, userID)
	if err != nil {
		return err
	}
	return b.DeleteOriginal(ctx, userID, digest)
}

// PutParsed, GetParsed and DeleteDocument stay on the server's disk.
func (r *Router) PutParsed(ctx context.Context, userID, docID uuid.UUID, version int, markdown string) (string, error) {
	return r.local.PutParsed(ctx, userID, docID, version, markdown)
}

func (r *Router) GetParsed(ctx context.Context, path string) (string, error) {
	return r.local.GetParsed(ctx, path)
}

func (r *Router) DeleteDocument(ctx context.Context, userID, docID uuid.UUID) error {
	return r.local.DeleteDocument(ctx, userID, docID)
}

// DeleteUser removes everything the server holds for a learner, whichever
// backend holds their files, then asks every other backend to remove its own
// part. Each other backend is asked even when the learner's choice is the
// server: a learner who moved back from Drive still has a cache.
func (r *Router) DeleteUser(ctx context.Context, userID uuid.UUID) error {
	if err := r.local.DeleteUser(ctx, userID); err != nil {
		return err
	}
	asked := map[Backend]bool{Backend(r.local): true}
	for _, b := range r.others {
		if asked[b] {
			continue
		}
		asked[b] = true
		if err := b.DeleteUser(ctx, userID); err != nil {
			return err
		}
	}
	b, err := r.backend(ctx, userID)
	if err != nil {
		return err
	}
	if asked[b] {
		return nil
	}
	return b.DeleteUser(ctx, userID)
}

func (r *Router) PutObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID, data []byte) error {
	b, err := r.backend(ctx, userID)
	if err != nil {
		return err
	}
	return b.PutObject(ctx, userID, namespace, id, data)
}

func (r *Router) GetObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) ([]byte, error) {
	b, err := r.backend(ctx, userID)
	if err != nil {
		return nil, err
	}
	return b.GetObject(ctx, userID, namespace, id)
}

func (r *Router) OpenObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) (*File, error) {
	b, err := r.backend(ctx, userID)
	if err != nil {
		return nil, err
	}
	return b.OpenObject(ctx, userID, namespace, id)
}

func (r *Router) WriteObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID, write func(io.Writer) error) error {
	b, err := r.backend(ctx, userID)
	if err != nil {
		return err
	}
	return b.WriteObject(ctx, userID, namespace, id, write)
}

func (r *Router) DeleteObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) error {
	b, err := r.backend(ctx, userID)
	if err != nil {
		return err
	}
	return b.DeleteObject(ctx, userID, namespace, id)
}
