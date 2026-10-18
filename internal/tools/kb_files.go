package tools

import (
	"context"
	"fmt"
	"strings"

	"github.com/D0bby999/anytools/internal/runtime"
)

// KBFiles is `kb_files(kb_id)` — "what is actually in here?".
//
// It exists because the honest answer to "does your book cover X" is sometimes
// "the knowledge base holds three files and none of them is that book", and a
// model with only rag_search answers that question by finding the nearest
// passage and sounding confident.
type KBFiles struct {
	lister FileLister
	authz  Authorizer
}

// NewKBFiles builds the tool.
func NewKBFiles(l FileLister, a Authorizer) *KBFiles { return &KBFiles{lister: l, authz: a} }

// Name implements runtime.Tool.
func (t *KBFiles) Name() string { return "kb_files" }

// NeedsNetwork implements runtime.Tool.
func (t *KBFiles) NeedsNetwork() bool { return false }

// Definition implements runtime.Tool.
func (t *KBFiles) Definition() runtime.ToolDefinition {
	return runtime.ToolDefinition{
		Type: "function",
		Function: runtime.ToolFunctionSchema{
			Name: t.Name(),
			Description: "List the documents in a knowledge base attached to this conversation, " +
				"with their page counts and indexing status. Use it before claiming a document is or is not present.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"kb_id": map[string]any{
						"type":        "string",
						"description": "Knowledge base to list. Omit to list every knowledge base attached to this conversation.",
					},
				},
			},
		},
	}
}

// Execute implements runtime.Tool.
func (t *KBFiles) Execute(ctx context.Context, args map[string]any, in runtime.ToolInput) (runtime.ToolResult, error) {
	requested, err := uuidListArg(args, "kb_id")
	if err != nil {
		return toolError("%s", err.Error()), nil
	}

	// THE GATE.
	kbIDs, refusal := authorizeKBs(ctx, t.authz, in, requested)
	if refusal != nil {
		return *refusal, nil
	}

	var b strings.Builder
	total := 0
	for _, kbID := range kbIDs {
		files, err := t.lister.Files(ctx, in.UserID, kbID)
		if err != nil {
			return runtime.ToolResult{}, fmt.Errorf("kb_files: %w", err)
		}
		for _, f := range files {
			total++
			fmt.Fprintf(&b, "- %s (id %s, %d pages, %s)\n", f.Title, f.DocumentID, f.Pages, f.Status)
		}
	}
	if total == 0 {
		return runtime.ToolResult{Content: "That knowledge base has no documents in it yet."}, nil
	}

	// Titles are user-supplied filenames and therefore untrusted text — a file
	// named "ignore previous instructions.pdf" is a one-line injection with no
	// document body at all. The listing goes in the envelope like any other
	// tool output.
	// Retrieved, even though there are no citable sources: these are the user's
	// own filenames, they go through the envelope, and a filename is a
	// perfectly good place to hide an instruction.
	return runtime.ToolResult{
		Retrieved: true,
		Content:   Wrap("knowledge base file listing", "kb_files", b.String()),
	}, nil
}
