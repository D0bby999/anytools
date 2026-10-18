package reading

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/knowledge"
)

// ErrNotFound is the single answer to "no such row for this user" — the same
// collapse of "missing" and "not yours" that internal/authz makes, for the same
// reason: anything finer is an existence oracle for other people's documents.
var ErrNotFound = errors.New("reading: not found")

// ErrInvalid marks a caller mistake the API answers with 400.
var ErrInvalid = errors.New("reading: invalid")

// MaxHighlightLen caps a highlight's text. It matches the database CHECK; a
// selection longer than this is a "select all", not a highlight.
const MaxHighlightLen = 10000

// Highlight colours. NAMES, not hex values: the world's palette is defined in
// ui/web/app/tokens.css, and a colour stored in the database is a colour the
// design tokens can never restyle. The same four strings are a CHECK constraint
// in the migration, and Colors() is what a test compares the two with.
func Colors() []string { return []string{"yellow", "green", "blue", "pink"} }

// ValidColor reports whether c is one of the four.
func ValidColor(c string) bool {
	for _, v := range Colors() {
		if v == c {
			return true
		}
	}
	return false
}

// Progress is how far through a document the reader got.
//
// Two numbers rather than one. A PDF knows its page; an EPUB knows only a
// fraction of the spine, because its "pages" depend on the viewport. Deriving
// either from the other would be a lie about precision, so both are stored and
// the viewer uses whichever its renderer actually produced.
type Progress struct {
	Page    int     `json:"page,omitempty"`
	Percent float64 `json:"percent,omitempty"`
}

// Workspace is one document's reading state for one user.
type Workspace struct {
	ID         uuid.UUID `json:"id"`
	UserID     uuid.UUID `json:"-"`
	DocumentID uuid.UUID `json:"document_id"`
	Progress   Progress  `json:"progress"`
	// SessionID is the chat session the tutor pane's turns run on, created on
	// the first selection action rather than with the workspace: opening a
	// document to read it should not manufacture an empty conversation.
	SessionID *uuid.UUID `json:"session_id,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// Highlight is one marked passage.
type Highlight struct {
	ID          uuid.UUID `json:"id"`
	UserID      uuid.UUID `json:"-"`
	WorkspaceID uuid.UUID `json:"workspace_id"`
	Page        int       `json:"page"`
	Text        string    `json:"text"`
	Color       string    `json:"color"`
	// NoteID links a highlight to the note it was saved into. Nil is the normal
	// case: most highlights are just highlights.
	NoteID    *uuid.UUID `json:"note_id,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// HighlightPatch carries the fields an update may change.
type HighlightPatch struct {
	Color  *string
	NoteID *uuid.UUID
}

// Store is the persistence surface this package consumes. pg.ReadingStore
// implements it.
type Store interface {
	// EnsureWorkspace returns the user's workspace for a document, creating it
	// on first open. Upsert-shaped rather than read-then-write: two tabs opened
	// at once would otherwise both see "none" and race to create, and the
	// unique constraint would turn the loser into an error on a page load.
	EnsureWorkspace(ctx context.Context, userID, documentID uuid.UUID) (*Workspace, error)
	ListWorkspaces(ctx context.Context, userID uuid.UUID, limit int) ([]Workspace, error)
	GetWorkspace(ctx context.Context, userID, id uuid.UUID) (*Workspace, error)
	DeleteWorkspace(ctx context.Context, userID, id uuid.UUID) error
	SetProgress(ctx context.Context, userID, id uuid.UUID, p Progress) (*Workspace, error)
	AttachSession(ctx context.Context, userID, id, sessionID uuid.UUID) (*Workspace, error)

	CreateHighlight(ctx context.Context, h Highlight) (*Highlight, error)
	ListHighlights(ctx context.Context, userID, workspaceID uuid.UUID) ([]Highlight, error)
	GetHighlight(ctx context.Context, userID, id uuid.UUID) (*Highlight, error)
	UpdateHighlight(ctx context.Context, userID, id uuid.UUID, patch HighlightPatch) (*Highlight, error)
	DeleteHighlight(ctx context.Context, userID, id uuid.UUID) error
}

// Workspaces is the application logic over Store.
type Workspaces struct{ store Store }

// NewWorkspaces returns a Workspaces over store.
func NewWorkspaces(store Store) *Workspaces { return &Workspaces{store: store} }

// Open returns the workspace for a document, creating it on first read.
//
// The caller must have authorized the document FIRST. This method does not
// check ownership itself and cannot: it is handed a document id, and a store
// that answered "is this yours?" by trying to write a row would create the row
// as a side effect of asking.
func (w *Workspaces) Open(ctx context.Context, userID, documentID uuid.UUID) (*Workspace, error) {
	return w.store.EnsureWorkspace(ctx, userID, documentID)
}

// List returns the user's reading workspaces, most recently read first.
func (w *Workspaces) List(ctx context.Context, userID uuid.UUID, limit int) ([]Workspace, error) {
	return w.store.ListWorkspaces(ctx, userID, limit)
}

// Get reads one workspace.
func (w *Workspaces) Get(ctx context.Context, userID, id uuid.UUID) (*Workspace, error) {
	return w.store.GetWorkspace(ctx, userID, id)
}

// Delete removes a workspace and, by cascade, its highlights.
func (w *Workspaces) Delete(ctx context.Context, userID, id uuid.UUID) error {
	return w.store.DeleteWorkspace(ctx, userID, id)
}

// SaveProgress records where the reader got to.
func (w *Workspaces) SaveProgress(ctx context.Context, userID, id uuid.UUID, p Progress) (*Workspace, error) {
	if p.Page < 0 {
		return nil, fmt.Errorf("%w: page cannot be negative", ErrInvalid)
	}
	if p.Percent < 0 || p.Percent > 1 {
		return nil, fmt.Errorf("%w: percent must be between 0 and 1", ErrInvalid)
	}
	return w.store.SetProgress(ctx, userID, id, p)
}

// AttachSession records the chat session the tutor pane uses.
func (w *Workspaces) AttachSession(ctx context.Context, userID, id, sessionID uuid.UUID) (*Workspace, error) {
	return w.store.AttachSession(ctx, userID, id, sessionID)
}

// NewHighlight is the input for marking a passage.
type NewHighlight struct {
	Page   int
	Text   string
	Color  string
	NoteID *uuid.UUID
}

// AddHighlight marks a passage.
func (w *Workspaces) AddHighlight(
	ctx context.Context, userID, workspaceID uuid.UUID, in NewHighlight,
) (*Highlight, error) {
	text := strings.TrimSpace(in.Text)
	if text == "" {
		return nil, fmt.Errorf("%w: a highlight needs some text", ErrInvalid)
	}
	if len([]rune(text)) > MaxHighlightLen {
		return nil, fmt.Errorf("%w: that selection is too long to highlight", ErrInvalid)
	}
	if in.Page < 1 {
		return nil, fmt.Errorf("%w: a highlight needs a page", ErrInvalid)
	}
	color := in.Color
	if color == "" {
		color = "yellow"
	}
	if !ValidColor(color) {
		return nil, fmt.Errorf("%w: %q is not a highlight colour", ErrInvalid, color)
	}
	return w.store.CreateHighlight(ctx, Highlight{
		UserID:      userID,
		WorkspaceID: workspaceID,
		Page:        in.Page,
		Text:        text,
		Color:       color,
		NoteID:      in.NoteID,
	})
}

// ListHighlights returns a workspace's highlights, page order then age.
func (w *Workspaces) ListHighlights(ctx context.Context, userID, workspaceID uuid.UUID) ([]Highlight, error) {
	return w.store.ListHighlights(ctx, userID, workspaceID)
}

// GetHighlight reads one highlight.
func (w *Workspaces) GetHighlight(ctx context.Context, userID, id uuid.UUID) (*Highlight, error) {
	return w.store.GetHighlight(ctx, userID, id)
}

// UpdateHighlight recolours a highlight or links it to a note.
func (w *Workspaces) UpdateHighlight(
	ctx context.Context, userID, id uuid.UUID, patch HighlightPatch,
) (*Highlight, error) {
	if patch.Color != nil && !ValidColor(*patch.Color) {
		return nil, fmt.Errorf("%w: %q is not a highlight colour", ErrInvalid, *patch.Color)
	}
	return w.store.UpdateHighlight(ctx, userID, id, patch)
}

// DeleteHighlight removes a highlight.
func (w *Workspaces) DeleteHighlight(ctx context.Context, userID, id uuid.UUID) error {
	return w.store.DeleteHighlight(ctx, userID, id)
}

// ErrNoText is returned for a document with no parsed text: it has not been
// parsed yet, so there is nothing to check a selection against.
var ErrNoText = errors.New("reading: the document has no text yet")

// ParsedReader reads a document's stored parsed Markdown, scoped to its owner
// (blob.GetParsed on the path the document row records). It answers ErrNoText
// for a document that has none.
type ParsedReader interface {
	ParsedMarkdown(ctx context.Context, userID, documentID uuid.UUID) (string, error)
}

// PageLoader cuts one page of a workspace's document out of the parsed text
// the SERVER stored. It is what a selection is checked against: the client
// says what it selected and on which page, and this is what that page says.
type PageLoader struct {
	Workspaces *Workspaces
	Parsed     ParsedReader
}

// WorkspacePage returns the workspace's document id and the text of `page`
// and the page after it — a selection that runs across a page break is filed
// under the page it began on (reading-selection.ts), so its tail is on the
// next one. Page 0 (a renderer that knows no pages) is the whole document.
// A workspace that is not the user's is ErrNotFound before anything is read.
func (l PageLoader) WorkspacePage(ctx context.Context, userID, workspaceID uuid.UUID, page int) (uuid.UUID, string, error) {
	ws, err := l.Workspaces.Get(ctx, userID, workspaceID)
	if err != nil {
		return uuid.Nil, "", err
	}
	md, err := l.Parsed.ParsedMarkdown(ctx, userID, ws.DocumentID)
	if err != nil {
		return uuid.Nil, "", err
	}
	pages := knowledge.SplitPages(md)
	var b strings.Builder
	for _, p := range pages {
		if page < 1 || p.Number == page || p.Number == page+1 {
			b.WriteString(p.Markdown)
			b.WriteString("\n\n")
		}
	}
	return ws.DocumentID, b.String(), nil
}
