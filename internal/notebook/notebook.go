// Package notebook is the user's notebook: notebooks, notes, categories, and
// the Markdown export of a whole notebook.
//
// Two decisions shape everything here.
//
//  1. A note remembers WHERE IT CAME FROM. `Source{Kind, ID, Page}` is not
//     decoration: phase 10's evidence loop is gated on evidence that points at
//     something, and a note saved from a reading selection whose page was lost
//     is a claim rather than evidence. Every path that creates a note takes a
//     source, including the agent's.
//
//  2. An agent's note is visibly an agent's note. `CreatedBy` is written by the
//     caller that knows — the `write_note` tool writes "agent", the API writes
//     "user" — and no path lets a request body choose it. A notebook that let
//     the model claim authorship of the reader's own notes would make "what did
//     I actually work out myself" unanswerable.
package notebook

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound is the single answer to "no such row for this user".
//
// It is returned identically for a row that does not exist and a row that
// belongs to someone else, for the reason internal/authz states at length: any
// endpoint that can tell them apart is an existence oracle for other people's
// notes.
var ErrNotFound = errors.New("notebook: not found")

// ErrInvalid marks a caller mistake the API answers with 400.
var ErrInvalid = errors.New("notebook: invalid")

// Limits. They are enforced here as well as in the database CHECKs so the user
// gets a sentence rather than a constraint violation.
const (
	MaxNameLen  = 200
	MaxTitleLen = 300
	MaxBodyLen  = 200 << 10
)

// Source kinds a note may point at. The list is repeated as a CHECK constraint
// in the migration; SourceKinds() is what a test compares the two with.
const (
	SourceSession  = "session"
	SourceQuestion = "question"
	SourceDocument = "document"
	SourceReading  = "reading"
)

// SourceKinds returns every legal source kind, in a stable order.
func SourceKinds() []string {
	return []string{SourceSession, SourceQuestion, SourceDocument, SourceReading}
}

// Authorship values.
const (
	CreatedByUser  = "user"
	CreatedByAgent = "agent"
)

// Source is where a note came from.
//
// The fields are omitempty so an empty source round-trips as `{}` — which is
// exactly what the migration's CHECK permits for a note the user simply typed.
type Source struct {
	Kind string `json:"kind,omitempty"`
	ID   string `json:"id,omitempty"`
	// Page is the page anchor a citation resolves against. It is the same
	// number `documents/:id?page=N` scrolls to, so a note saved from a reading
	// selection reopens at the passage it was taken from.
	Page int `json:"page,omitempty"`
}

// Valid reports whether a source is either empty or one this product knows.
func (s Source) Valid() bool {
	if s.Kind == "" {
		return s.ID == "" && s.Page == 0
	}
	for _, k := range SourceKinds() {
		if s.Kind == k {
			return true
		}
	}
	return false
}

// Notebook is one collection of notes.
type Notebook struct {
	ID        uuid.UUID `json:"id"`
	UserID    uuid.UUID `json:"-"`
	Name      string    `json:"name"`
	IsDefault bool      `json:"is_default"`
	NoteCount int       `json:"note_count"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Note is one entry.
type Note struct {
	ID         uuid.UUID `json:"id"`
	UserID     uuid.UUID `json:"-"`
	NotebookID uuid.UUID `json:"notebook_id"`
	Title      string    `json:"title"`
	BodyMD     string    `json:"body_md"`
	Source     Source    `json:"source"`
	CreatedBy  string    `json:"created_by"`
	// CategoryIDs are the categories this note is filed under. Read on GET,
	// replaced wholesale on PATCH — a set, not an ordered list.
	CategoryIDs []uuid.UUID `json:"category_ids"`
	CreatedAt   time.Time   `json:"created_at"`
	UpdatedAt   time.Time   `json:"updated_at"`
}

// Category is a label inside one notebook.
type Category struct {
	ID         uuid.UUID `json:"id"`
	UserID     uuid.UUID `json:"-"`
	NotebookID uuid.UUID `json:"notebook_id"`
	Name       string    `json:"name"`
	CreatedAt  time.Time `json:"created_at"`
}

// NotePatch carries the fields an update may change. A nil field means "leave
// it alone", which is what lets the API expose one PATCH rather than one
// endpoint per column. CreatedBy is deliberately absent: authorship is a fact
// about how the row was made, not a property a later request may edit.
type NotePatch struct {
	Title       *string
	BodyMD      *string
	CategoryIDs *[]uuid.UUID
}

// NoteFilter narrows a listing.
type NoteFilter struct {
	// CategoryID, when set, returns only notes filed under it.
	CategoryID *uuid.UUID
	// DocumentID, when set, returns only notes whose source names that
	// document. This is the reading pane's own query.
	DocumentID *uuid.UUID
	Limit      int
}

// Store is the persistence surface this package consumes. pg.NotebookStore
// implements it; the interface lives here, beside its only consumer.
type Store interface {
	CreateNotebook(ctx context.Context, userID uuid.UUID, name string, isDefault bool) (*Notebook, error)
	ListNotebooks(ctx context.Context, userID uuid.UUID) ([]Notebook, error)
	GetNotebook(ctx context.Context, userID, notebookID uuid.UUID) (*Notebook, error)
	RenameNotebook(ctx context.Context, userID, notebookID uuid.UUID, name string) (*Notebook, error)
	DeleteNotebook(ctx context.Context, userID, notebookID uuid.UUID) error
	// DefaultNotebook returns the user's default notebook, creating it on first
	// use. It is upsert-shaped rather than read-then-write because two
	// concurrent first saves would otherwise both see "none" and both create.
	DefaultNotebook(ctx context.Context, userID uuid.UUID) (*Notebook, error)

	CreateNote(ctx context.Context, n Note) (*Note, error)
	GetNote(ctx context.Context, userID, noteID uuid.UUID) (*Note, error)
	ListNotes(ctx context.Context, userID, notebookID uuid.UUID, f NoteFilter) ([]Note, error)
	UpdateNote(ctx context.Context, userID, noteID uuid.UUID, patch NotePatch) (*Note, error)
	DeleteNote(ctx context.Context, userID, noteID uuid.UUID) error
	MoveNote(ctx context.Context, userID, noteID, toNotebookID uuid.UUID) (*Note, error)

	CreateCategory(ctx context.Context, userID, notebookID uuid.UUID, name string) (*Category, error)
	ListCategories(ctx context.Context, userID, notebookID uuid.UUID) ([]Category, error)
	DeleteCategory(ctx context.Context, userID, categoryID uuid.UUID) error
}

// Service is the notebook's application logic.
type Service struct{ store Store }

// NewService returns a Service over store.
func NewService(store Store) *Service { return &Service{store: store} }

// ───────────────────────────────────────────────────────────────── notebooks

// CreateNotebook makes a notebook. The first one a user creates becomes their
// default, so "save to notebook" has somewhere to go without asking.
func (s *Service) CreateNotebook(ctx context.Context, userID uuid.UUID, name string) (*Notebook, error) {
	clean, err := cleanName(name)
	if err != nil {
		return nil, err
	}
	existing, err := s.store.ListNotebooks(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.store.CreateNotebook(ctx, userID, clean, len(existing) == 0)
}

// ListNotebooks returns the user's notebooks, most recently touched first.
func (s *Service) ListNotebooks(ctx context.Context, userID uuid.UUID) ([]Notebook, error) {
	return s.store.ListNotebooks(ctx, userID)
}

// GetNotebook reads one notebook.
func (s *Service) GetNotebook(ctx context.Context, userID, id uuid.UUID) (*Notebook, error) {
	return s.store.GetNotebook(ctx, userID, id)
}

// RenameNotebook renames one.
func (s *Service) RenameNotebook(ctx context.Context, userID, id uuid.UUID, name string) (*Notebook, error) {
	clean, err := cleanName(name)
	if err != nil {
		return nil, err
	}
	return s.store.RenameNotebook(ctx, userID, id, clean)
}

// DeleteNotebook removes a notebook and, by cascade, its notes.
func (s *Service) DeleteNotebook(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.DeleteNotebook(ctx, userID, id)
}

// DefaultNotebook returns the notebook an unaddressed save lands in.
func (s *Service) DefaultNotebook(ctx context.Context, userID uuid.UUID) (*Notebook, error) {
	return s.store.DefaultNotebook(ctx, userID)
}

// ───────────────────────────────────────────────────────────────────── notes

// NewNote is the input for creating a note.
type NewNote struct {
	// NotebookID may be Nil, which means the user's default notebook.
	NotebookID  uuid.UUID
	Title       string
	BodyMD      string
	Source      Source
	CreatedBy   string
	CategoryIDs []uuid.UUID
}

// CreateNote writes a note, resolving the default notebook when none is named.
func (s *Service) CreateNote(ctx context.Context, userID uuid.UUID, in NewNote) (*Note, error) {
	if strings.TrimSpace(in.Title) == "" && strings.TrimSpace(in.BodyMD) == "" {
		return nil, fmt.Errorf("%w: a note needs a title or a body", ErrInvalid)
	}
	if len(in.Title) > MaxTitleLen {
		return nil, fmt.Errorf("%w: that title is too long", ErrInvalid)
	}
	if len(in.BodyMD) > MaxBodyLen {
		return nil, fmt.Errorf("%w: that note is too long", ErrInvalid)
	}
	if !in.Source.Valid() {
		return nil, fmt.Errorf("%w: unknown source kind %q", ErrInvalid, in.Source.Kind)
	}

	createdBy := in.CreatedBy
	if createdBy != CreatedByAgent {
		createdBy = CreatedByUser
	}

	notebookID := in.NotebookID
	if notebookID == uuid.Nil {
		nb, err := s.store.DefaultNotebook(ctx, userID)
		if err != nil {
			return nil, err
		}
		notebookID = nb.ID
	}

	return s.store.CreateNote(ctx, Note{
		UserID:      userID,
		NotebookID:  notebookID,
		Title:       strings.TrimSpace(in.Title),
		BodyMD:      in.BodyMD,
		Source:      in.Source,
		CreatedBy:   createdBy,
		CategoryIDs: in.CategoryIDs,
	})
}

// GetNote reads one note.
func (s *Service) GetNote(ctx context.Context, userID, id uuid.UUID) (*Note, error) {
	return s.store.GetNote(ctx, userID, id)
}

// ListNotes returns a notebook's notes.
func (s *Service) ListNotes(ctx context.Context, userID, notebookID uuid.UUID, f NoteFilter) ([]Note, error) {
	return s.store.ListNotes(ctx, userID, notebookID, f)
}

// UpdateNote applies a patch.
func (s *Service) UpdateNote(ctx context.Context, userID, id uuid.UUID, patch NotePatch) (*Note, error) {
	if patch.Title != nil && len(*patch.Title) > MaxTitleLen {
		return nil, fmt.Errorf("%w: that title is too long", ErrInvalid)
	}
	if patch.BodyMD != nil && len(*patch.BodyMD) > MaxBodyLen {
		return nil, fmt.Errorf("%w: that note is too long", ErrInvalid)
	}
	return s.store.UpdateNote(ctx, userID, id, patch)
}

// DeleteNote removes a note.
func (s *Service) DeleteNote(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.DeleteNote(ctx, userID, id)
}

// MoveNote moves a note to another notebook.
//
// The note's categories are NOT carried across: a category belongs to a
// notebook, so the links would point at labels the destination does not have.
// The store drops them in the same statement that moves the row.
func (s *Service) MoveNote(ctx context.Context, userID, noteID, toNotebookID uuid.UUID) (*Note, error) {
	return s.store.MoveNote(ctx, userID, noteID, toNotebookID)
}

// CopyNote duplicates a note into another notebook.
//
// The copy keeps the ORIGINAL's source and authorship. Rewriting either would
// turn "the model wrote this while reading page 14" into "the user wrote this",
// which is the one fact about a note that must survive being filed somewhere
// else.
func (s *Service) CopyNote(ctx context.Context, userID, noteID, toNotebookID uuid.UUID) (*Note, error) {
	src, err := s.store.GetNote(ctx, userID, noteID)
	if err != nil {
		return nil, err
	}
	target := toNotebookID
	if target == uuid.Nil {
		target = src.NotebookID
	}
	return s.store.CreateNote(ctx, Note{
		UserID:     userID,
		NotebookID: target,
		Title:      src.Title,
		BodyMD:     src.BodyMD,
		Source:     src.Source,
		CreatedBy:  src.CreatedBy,
	})
}

// ──────────────────────────────────────────────────────────────── categories

// CreateCategory adds a label to a notebook.
func (s *Service) CreateCategory(ctx context.Context, userID, notebookID uuid.UUID, name string) (*Category, error) {
	clean := strings.TrimSpace(name)
	if clean == "" || len(clean) > 100 {
		return nil, fmt.Errorf("%w: a category needs a name of 1-100 characters", ErrInvalid)
	}
	return s.store.CreateCategory(ctx, userID, notebookID, clean)
}

// ListCategories returns a notebook's categories.
func (s *Service) ListCategories(ctx context.Context, userID, notebookID uuid.UUID) ([]Category, error) {
	return s.store.ListCategories(ctx, userID, notebookID)
}

// DeleteCategory removes a label. Its notes survive; only the links go.
func (s *Service) DeleteCategory(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.DeleteCategory(ctx, userID, id)
}

// ─────────────────────────────────────────────────────── the write_note tool

// WriteNote implements tools.NoteWriter: the `write_note` tool phase 6 mounted
// against a nil implementation now has one.
//
// It writes into the user's DEFAULT notebook with `created_by=agent` and a
// session source, because those are the only two facts the tool's arguments
// cannot carry: the model is given a title and a body, and is deliberately not
// given a notebook to choose or an authorship to claim.
func (s *Service) WriteNote(
	ctx context.Context, userID, sessionID uuid.UUID, title, body string,
) (string, error) {
	src := Source{}
	if sessionID != uuid.Nil {
		src = Source{Kind: SourceSession, ID: sessionID.String()}
	}
	note, err := s.CreateNote(ctx, userID, NewNote{
		Title:     title,
		BodyMD:    body,
		Source:    src,
		CreatedBy: CreatedByAgent,
	})
	if err != nil {
		return "", err
	}
	return note.ID.String(), nil
}

func cleanName(name string) (string, error) {
	clean := strings.TrimSpace(name)
	if clean == "" || len(clean) > MaxNameLen {
		return "", fmt.Errorf("%w: a notebook needs a name of 1-%d characters", ErrInvalid, MaxNameLen)
	}
	return clean, nil
}
