package tools

import (
	"context"
	"errors"
	"sync"

	"github.com/google/uuid"
)

// The fakes below are the phase-5 stand-ins named in the wave-ownership note.
// They are deliberately RECORDING fakes: the security tests do not only assert
// that a refusal was returned, they assert that the retriever was never reached
// at all. A gate that returns the right message after doing the query is not a
// gate.

type fakeAuthz struct {
	kbs  map[uuid.UUID]uuid.UUID // kb id -> owner
	docs map[uuid.UUID]uuid.UUID // document id -> owner
	err  error
}

func newFakeAuthz() *fakeAuthz {
	return &fakeAuthz{kbs: map[uuid.UUID]uuid.UUID{}, docs: map[uuid.UUID]uuid.UUID{}}
}

func (a *fakeAuthz) OwnsKB(_ context.Context, userID, kbID uuid.UUID) (bool, error) {
	if a.err != nil {
		return false, a.err
	}
	owner, ok := a.kbs[kbID]
	return ok && owner == userID, nil
}

func (a *fakeAuthz) OwnsDocument(_ context.Context, userID, docID uuid.UUID) (bool, error) {
	if a.err != nil {
		return false, a.err
	}
	owner, ok := a.docs[docID]
	return ok && owner == userID, nil
}

type fakeRetriever struct {
	mu      sync.Mutex
	calls   int
	lastKBs []uuid.UUID
	chunks  []Chunk
	err     error
}

func (r *fakeRetriever) Search(_ context.Context, _ uuid.UUID, kbIDs []uuid.UUID, _ string, limit int) ([]Chunk, error) {
	r.mu.Lock()
	r.calls++
	r.lastKBs = kbIDs
	r.mu.Unlock()
	if r.err != nil {
		return nil, r.err
	}
	if limit < len(r.chunks) {
		return r.chunks[:limit], nil
	}
	return r.chunks, nil
}

func (r *fakeRetriever) callCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls
}

type fakeReader struct {
	mu    sync.Mutex
	calls int
	pages map[int]Page
}

func (s *fakeReader) ReadPage(_ context.Context, _, docID uuid.UUID, page int) (Page, error) {
	s.mu.Lock()
	s.calls++
	s.mu.Unlock()
	p, ok := s.pages[page]
	if !ok {
		return Page{}, ErrNotFound
	}
	p.DocumentID = docID.String()
	p.Page = page
	return p, nil
}

func (s *fakeReader) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

type fakeLister struct {
	mu    sync.Mutex
	calls int
	files map[uuid.UUID][]File
}

func (l *fakeLister) Files(_ context.Context, _, kbID uuid.UUID) ([]File, error) {
	l.mu.Lock()
	l.calls++
	l.mu.Unlock()
	return l.files[kbID], nil
}

func (l *fakeLister) callCount() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.calls
}

type fakeNotes struct{ err error }

func (n fakeNotes) WriteNote(context.Context, uuid.UUID, uuid.UUID, string, string) (string, error) {
	if n.err != nil {
		return "", n.err
	}
	return "note-1", nil
}

var errBackend = errors.New("backend unavailable")
