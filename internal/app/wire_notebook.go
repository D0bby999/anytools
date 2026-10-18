package app

import (
	"github.com/D0bby999/anytools/internal/api/notebookapi"
	"github.com/D0bby999/anytools/internal/api/readingapi"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/capabilities/reading"
	"github.com/D0bby999/anytools/internal/capabilities/visualize"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/notebook"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_notebook.go assembles phase 8: the notebook, the reading workspace, the
// `reading` capability and the two HTTP handlers.
//
// It is a file of its own rather than more functions inside wire.go for the
// reason that file's own doc comment gives: the boot order is the only
// documentation of what depends on what, and a subsystem that can be read in
// one screen is one whose dependencies can be checked by reading.
//
// It is split in TWO because the dependencies genuinely interleave with the
// chat runtime's, and pretending otherwise would mean building something twice:
//
//	notebook service  ──▶ write_note tool  ──▶ tool registry ─┐
//	chat store ──▶ reading capability ──▶ capability registry ─┼─▶ orchestrator
//	                                                           │
//	                              readingapi (needs the orchestrator) ◀┘
//
// So newNotebook() runs before buildChatRuntime and buildReadingSurface() runs
// after it, with the same *notebook.Service passed through both.

// newNotebook builds the notebook service. It has no collaborators beyond the
// pool, which is what lets it be constructed before the turn engine that
// consumes it through the `write_note` tool.
func newNotebook(pool *pg.Pool) *notebook.Service {
	return notebook.NewService(pg.NewNotebookStore(pool))
}

// readingDeps are the already-built collaborators the reading surface needs.
//
// They are passed in rather than constructed here: a second ChatStore over the
// same pool would be a second idea of what a session is, and a second
// Orchestrator would run turns the SSE endpoint's bus registry has never heard
// of — the stream would then serve only the persisted log and never the live
// one, which looks like "streaming is slow" rather than like a wiring bug.
type readingDeps struct {
	Notes     *notebook.Service
	Chat      *pg.ChatStore
	Orch      *runtime.Orchestrator
	Knowledge *knowledge.Service
	Blobs     blob.Store
	Authz     *authz.Authorizer
	Diagrams  *visualize.Service
	Pages     reading.PageLoader
	Providers runtime.ChatProviderResolver
}

// buildReadingSurface wires the two phase-8 HTTP handlers.
func buildReadingSurface(pool *pg.Pool, d readingDeps) (*notebookapi.Handler, *readingapi.Handler) {
	workspaces := reading.NewWorkspaces(pg.NewReadingStore(pool))

	return notebookapi.NewHandler(d.Notes), readingapi.NewHandler(readingapi.Deps{
		Workspaces: workspaces,
		Notes:      d.Notes,
		Authz:      d.Authz,
		Documents:  d.Knowledge,
		Blobs:      d.Blobs,
		Sessions:   d.Chat,
		Orch:       d.Orch,
		Diagrams:   d.Diagrams,
		Pages:      d.Pages,
		Providers:  d.Providers,
		// A video's tutor window reads the stored transcript (phase 4).
		Transcripts: d.Knowledge,
	})
}
