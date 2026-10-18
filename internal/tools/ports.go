// Package tools holds the callables a turn may run: retrieval, source reading,
// file listing, asking the user a question, and (stubbed until phase 8) note
// writing.
//
// Two rules govern every tool here and are worth stating once:
//
//  1. **Authorization comes before the tool body.** Every argument that names a
//     resource — a kb id, a document id — is checked against the Authorizer
//     first. Red-team Security 3: `rag_search(kb_ids, query)` lets the MODEL
//     choose which knowledge bases to read, and the model's instructions can
//     come from a document an attacker wrote. A foreign id returns a tool
//     error; it never returns rows.
//
//  2. **Everything a tool returns is untrusted data.** Tool output is wrapped
//     in a provenance envelope (envelope.go) and the system prompt says to read
//     it as quoted material, never as instructions. Red-team Security 4: the
//     guard postclaw ships under a similar name (`providers/system_guard.go`)
//     is a billing entitlement check, not an injection defense, and porting it
//     here would have been security theatre.
package tools

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ports.go defines the CONSUMER-SIDE interfaces this package needs from phase
// 5 (`internal/rag/retrieve`, `internal/knowledge`) and phase 5's
// `internal/authz`, both of which are built on other branches. Fakes for tests
// live in fakes_test.go. At merge, adapters in those packages satisfy these
// signatures; nothing in this package changes.

// ErrNotFound is what a port returns when the resource does not exist. It is
// distinct from "not yours": the tools deliberately collapse both into the same
// tool error text, so the model cannot use the difference as an existence
// oracle for another user's documents.
var ErrNotFound = errors.New("not found")

// Chunk is one retrieved passage.
type Chunk struct {
	ID            string
	DocumentID    string
	DocumentTitle string
	Page          int
	Text          string
	Score         float64
	// Seconds and AITranscript describe a video passage (retrieve.Hit).
	Seconds      *int
	AITranscript bool
	// Lines marks a code file's passage: Page to PageEnd are line numbers.
	Lines   bool
	PageEnd int
	// Sheet names a spreadsheet passage's sheet (retrieve.Hit).
	Sheet string
	// PhotoModel names the model that read a photo's passage (retrieve.Hit).
	PhotoModel string
}

// Retriever runs the hybrid search phase 5 builds: vector + FTS, RRF-merged,
// scoped to the given knowledge bases.
//
// userID is a parameter and not optional. The retrieval SQL postclaw was ported
// from dropped its owner filter (red-team Security 3, `hybrid_query.go:30-53`),
// and a search scoped only by kb_id is one join away from another account's
// chunks the moment a kb id leaks or is guessed.
type Retriever interface {
	Search(ctx context.Context, userID uuid.UUID, kbIDs []uuid.UUID, query string, limit int) ([]Chunk, error)
}

// SourceReader returns the text of one page of one document.
type SourceReader interface {
	ReadPage(ctx context.Context, userID, documentID uuid.UUID, page int) (Page, error)
}

// Page is one document page.
type Page struct {
	DocumentID string
	Title      string
	Page       int
	Text       string
	// PageCount lets a tool tell the model "that page does not exist, the
	// document has 12" instead of returning empty text it will treat as fact.
	PageCount int
}

// File is one document in a knowledge base, as `kb_files` lists it.
type File struct {
	DocumentID string
	Title      string
	Pages      int
	Status     string
}

// FileLister backs the `kb_files` tool.
//
// DEVIATION, recorded: the wave-ownership note named three stand-ins
// (Retriever, SourceReader, Authorizer), but the phase also mandates a
// `kb_files(kb_id)` tool, and neither of the other two can answer "what is in
// this KB". Folding a Files method onto Retriever would have made an interface
// named for search also mean enumeration. This is the fourth port the merge
// must satisfy; `internal/knowledge` is its natural implementer.
type FileLister interface {
	Files(ctx context.Context, userID, kbID uuid.UUID) ([]File, error)
}

// Authorizer answers "does this user own this resource".
//
// It returns (false, nil) for both "belongs to someone else" and "does not
// exist". A caller that needed to tell those apart would be building the
// existence oracle described above.
type Authorizer interface {
	OwnsKB(ctx context.Context, userID, kbID uuid.UUID) (bool, error)
	OwnsDocument(ctx context.Context, userID, documentID uuid.UUID) (bool, error)
}

// NoteWriter is phase 8's notebook. The `write_note` tool is stubbed against it
// until then.
type NoteWriter interface {
	WriteNote(ctx context.Context, userID, sessionID uuid.UUID, title, body string) (string, error)
}

// WebResult is one web search hit.
type WebResult struct {
	Title   string
	URL     string
	Snippet string
}

// ErrNoSearchKey is what a WebSearcher returns when the user has connected no
// Tavily or Brave key. There is no platform key to fall back on (RT-13): the
// honest outcome is "the web is not available", and research runs KB-only.
var ErrNoSearchKey = errors.New("no web search key is configured")

// WebSearcher runs a web search on the USER's own key. internal/app adapts
// byok.Service.SearchFor to it, so a failing key is benched by the same chain
// that benches a failing chat connection.
type WebSearcher interface {
	// Available reports whether the user has any search key at all, without
	// spending a query to find out.
	Available(ctx context.Context, userID uuid.UUID) (bool, error)
	Search(ctx context.Context, userID uuid.UUID, query string, limit int) ([]WebResult, error)
}

// KeylessSearcher is implemented by a WebSearcher that can still search when
// the user has no key (DuckDuckGo, internal/rag/search/duckduckgo.go).
// Research asks it so it can say which engine it used.
type KeylessSearcher interface {
	Keyless() bool
}
