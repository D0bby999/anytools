package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/runtime"
)

// argument coercion, because a model's JSON is loosely typed by nature: an
// integer arrives as a float64 through encoding/json, a single-element array
// arrives as a bare string, and a uuid arrives with whitespace around it. These
// helpers accept what models actually send and reject what is not recognisable
// — they never guess a default for a resource id.

func stringArg(args map[string]any, key string) string {
	v, ok := args[key]
	if !ok {
		return ""
	}
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case json.Number:
		return t.String()
	case float64:
		return fmt.Sprintf("%g", t)
	default:
		return ""
	}
}

func intArg(args map[string]any, key string) (int, bool) {
	v, ok := args[key]
	if !ok {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		return int(t), true
	case int:
		return t, true
	case json.Number:
		n, err := t.Int64()
		return int(n), err == nil
	case string:
		var n int
		if _, err := fmt.Sscanf(strings.TrimSpace(t), "%d", &n); err == nil {
			return n, true
		}
	}
	return 0, false
}

// uuidListArg reads a list of uuids, tolerating a bare string for the
// one-element case.
func uuidListArg(args map[string]any, key string) ([]uuid.UUID, error) {
	raw, ok := args[key]
	if !ok {
		return nil, nil
	}
	var parts []string
	switch t := raw.(type) {
	case string:
		if s := strings.TrimSpace(t); s != "" {
			parts = []string{s}
		}
	case []any:
		for _, item := range t {
			if s, ok := item.(string); ok {
				parts = append(parts, strings.TrimSpace(s))
			}
		}
	case []string:
		parts = t
	default:
		return nil, fmt.Errorf("%s must be a list of ids", key)
	}

	out := make([]uuid.UUID, 0, len(parts))
	for _, p := range parts {
		id, err := uuid.Parse(p)
		if err != nil {
			return nil, fmt.Errorf("%q is not a valid id", p)
		}
		out = append(out, id)
	}
	return out, nil
}

// toolError builds the result a tool returns to the MODEL when its arguments
// are wrong or refer to something the user does not own.
//
// It is deliberately identical for "no such knowledge base" and "that
// knowledge base is not yours". The difference is exactly the signal an
// attacker's document would be probing for — a poisoned PDF that asks the model
// to search a list of guessed kb ids learns nothing from a uniform refusal.
func toolError(format string, a ...any) runtime.ToolResult {
	return runtime.ToolResult{IsError: true, Content: fmt.Sprintf(format, a...)}
}

const notYoursMessage = "no knowledge base with that id is available in this session"
const noDocumentMessage = "no document with that id is available in this session"

// authorizeKBs is the gate every kb-id argument passes BEFORE a tool body runs.
//
// Two checks, and both are needed:
//
//  1. the id must be one of the session's own kb_ids — otherwise the model,
//     which may be repeating instructions from a document, could widen the
//     turn's reach beyond what the user chose for this conversation;
//  2. the user must still own it — a session row written before a KB was
//     deleted or transferred must not keep reading it.
//
// Checking only (1) trusts a row; checking only (2) lets a poisoned document
// pull in any KB the user happens to have. Ownership is the security boundary;
// session scope is the user's intent. Both.
func authorizeKBs(
	ctx context.Context, authz Authorizer, in runtime.ToolInput, requested []uuid.UUID,
) ([]uuid.UUID, *runtime.ToolResult) {
	allowed := make(map[uuid.UUID]bool, len(in.KBIDs))
	for _, id := range in.KBIDs {
		allowed[id] = true
	}

	// No explicit ids: the model means "the session's knowledge bases".
	if len(requested) == 0 {
		requested = in.KBIDs
	}
	if len(requested) == 0 {
		res := toolError("this session has no knowledge bases attached; ask the user to add one")
		return nil, &res
	}

	out := make([]uuid.UUID, 0, len(requested))
	for _, id := range requested {
		if !allowed[id] {
			res := toolError("%s", notYoursMessage)
			return nil, &res
		}
		owns, err := authz.OwnsKB(ctx, in.UserID, id)
		if err != nil {
			res := toolError("could not check access to that knowledge base")
			return nil, &res
		}
		if !owns {
			res := toolError("%s", notYoursMessage)
			return nil, &res
		}
		out = append(out, id)
	}
	return out, nil
}
