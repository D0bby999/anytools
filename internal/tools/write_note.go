package tools

import (
	"context"
	"fmt"

	"github.com/D0bby999/anytools/internal/runtime"
)

// WriteNote is `write_note(title, body)`.
//
// Phase 6 mounted this against a nil NoteWriter and said so to the model; phase
// 8 supplies the notebook. The nil path is KEPT rather than deleted: a
// deployment can still boot with the notebook unwired (a test harness, a
// partially-wired process), and "tell the user it was not saved" remains a
// better answer there than a panic or a silent success.
//
// Three things the tool deliberately does NOT let the model choose:
//
//   - the notebook. The note lands in the user's default notebook. A model
//     that could pick would need a notebook id in its arguments, which is one
//     more untrusted resource id to authorize, for a choice the reader can make
//     afterwards by moving the note.
//   - the authorship. The NoteWriter writes `created_by=agent`; there is no
//     argument for it. The notebook's whole value in phase 10 is telling what
//     the reader worked out from what a model produced.
//   - the user. UserID comes from runtime.ToolInput — the authenticated
//     request and the session row — never from the arguments.
type WriteNote struct {
	notes NoteWriter
}

// NewWriteNote builds the tool. A nil NoteWriter is the unwired case above;
// phase 8's wiring passes the real notebook service.
func NewWriteNote(n NoteWriter) *WriteNote { return &WriteNote{notes: n} }

// Name implements runtime.Tool.
func (t *WriteNote) Name() string { return "write_note" }

// NeedsNetwork implements runtime.Tool.
func (t *WriteNote) NeedsNetwork() bool { return false }

// maxNoteBody caps what one tool call may store.
//
// It is smaller than the notebook's own column limit on purpose: this is a
// MODEL-authored string arriving in a loop that may run eight rounds, and the
// note it is meant to write is a paragraph the reader asked to keep, not a
// transcript. A body over the cap is refused with a sentence the model can act
// on rather than truncated, because a note that silently loses its last half is
// worse than one that was not written.
const maxNoteBody = 32 << 10

// Definition implements runtime.Tool.
func (t *WriteNote) Definition() runtime.ToolDefinition {
	return runtime.ToolDefinition{
		Type: "function",
		Function: runtime.ToolFunctionSchema{
			Name: t.Name(),
			Description: "Save a short note to the user's notebook. Use it when the user asks " +
				"you to remember or write something down. The note is saved to their default " +
				"notebook and is marked as written by you.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title": map[string]any{"type": "string", "description": "A short title."},
					"body":  map[string]any{"type": "string", "description": "The note, in Markdown. Keep citations intact."},
				},
				"required": []string{"title", "body"},
			},
		},
	}
}

// Execute implements runtime.Tool.
func (t *WriteNote) Execute(ctx context.Context, args map[string]any, in runtime.ToolInput) (runtime.ToolResult, error) {
	title := stringArg(args, "title")
	body := stringArg(args, "body")
	if title == "" || body == "" {
		return toolError("write_note needs both a title and a body"), nil
	}
	if len(body) > maxNoteBody {
		return toolError(
			"that note is too long to save (%d characters, the limit is %d); write a shorter one",
			len(body), maxNoteBody), nil
	}

	if t.notes == nil {
		return toolError("the notebook is not available yet; tell the user the note was not saved"), nil
	}

	id, err := t.notes.WriteNote(ctx, in.UserID, in.SessionID, title, body)
	if err != nil {
		return runtime.ToolResult{}, fmt.Errorf("write_note: %w", err)
	}
	// The id is returned so the model can refer to the note, and the sentence
	// says it is in the notebook — not "saved", which a model has been known to
	// paraphrase as "saved to your file".
	return runtime.ToolResult{
		Content: fmt.Sprintf("Saved to the user's notebook as note %s.", id),
	}, nil
}
