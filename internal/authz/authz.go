// Package authz answers one question: does this user own this resource?
//
// It exists as its own package because red-team RT-3 found the same check
// written three different ways in the source system — inline in a handler, as a
// `WHERE user_id =` in one query and not at all in another — and because phase
// 6 will call it with resource ids that came out of a MODEL's tool arguments,
// where "the caller passed the right id" is not an assumption anyone can make.
//
// Two rules the callers depend on:
//
//  1. There is ONE error for "you may not have this", `ErrNoAccess`, and it is
//     returned identically whether the row is missing or belongs to someone
//     else. Distinguishing them turns any endpoint taking an id into an
//     existence oracle: probe uuids, learn which ones are real.
//  2. Every method takes the authenticated user id as an explicit argument
//     rather than reading it from the context. A function that reaches into the
//     context for its subject can be called from a place where the context
//     holds the wrong one; a function that takes it cannot.
package authz

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

// ErrNoAccess is the single answer to "no". Handlers map it to 404.
var ErrNoAccess = errors.New("authz: no access")

// Lookup is the narrow persistence surface authorization needs. It returns the
// OWNER of a resource, never a boolean keyed on a user the caller supplied —
// an "is this mine?" query is one forgotten parameter away from "does this
// exist?", and the difference is invisible in review.
type Lookup interface {
	// KBOwner returns the owner of a knowledge base, or ErrNoAccess when no
	// such row exists.
	KBOwner(ctx context.Context, kbID uuid.UUID) (uuid.UUID, error)
	// DocumentOwner returns the owner and containing KB of a document.
	DocumentOwner(ctx context.Context, docID uuid.UUID) (owner, kbID uuid.UUID, err error)
}

// Authorizer resolves ownership questions against a Lookup.
type Authorizer struct{ lookup Lookup }

// New returns an Authorizer backed by lookup.
func New(lookup Lookup) *Authorizer { return &Authorizer{lookup: lookup} }

// OwnsKB returns nil when user owns kbID and ErrNoAccess otherwise.
func (a *Authorizer) OwnsKB(ctx context.Context, user, kbID uuid.UUID) error {
	if user == uuid.Nil || kbID == uuid.Nil {
		return ErrNoAccess
	}
	owner, err := a.lookup.KBOwner(ctx, kbID)
	if err != nil {
		if errors.Is(err, ErrNoAccess) {
			return ErrNoAccess
		}
		// A lookup failure is not a decision. Propagating it lets the handler
		// answer 503; collapsing it into ErrNoAccess would answer 404 and make
		// a database blip look like a deleted knowledge base.
		return fmt.Errorf("authz: kb owner lookup: %w", err)
	}
	if owner != user {
		return ErrNoAccess
	}
	return nil
}

// OwnsDocument returns the document's KB id when user owns it.
//
// It returns the kb id because every caller needs it next — to scope a query,
// to publish an event — and re-reading it would be a second round trip that
// could observe a different row.
func (a *Authorizer) OwnsDocument(ctx context.Context, user, docID uuid.UUID) (uuid.UUID, error) {
	if user == uuid.Nil || docID == uuid.Nil {
		return uuid.Nil, ErrNoAccess
	}
	owner, kbID, err := a.lookup.DocumentOwner(ctx, docID)
	if err != nil {
		if errors.Is(err, ErrNoAccess) {
			return uuid.Nil, ErrNoAccess
		}
		return uuid.Nil, fmt.Errorf("authz: document owner lookup: %w", err)
	}
	if owner != user {
		return uuid.Nil, ErrNoAccess
	}
	return kbID, nil
}

// OwnsAllKBs checks a whole list, as phase 6's `rag_search(kb_ids, ...)` tool
// must: the model chooses that list, so every element is untrusted input.
//
// It fails on the FIRST element the user does not own rather than filtering the
// list down to the permitted ones. Silently narrowing a model-supplied id list
// would answer a question about five knowledge bases using two and report
// nothing about the difference.
func (a *Authorizer) OwnsAllKBs(ctx context.Context, user uuid.UUID, kbIDs []uuid.UUID) error {
	if len(kbIDs) == 0 {
		return ErrNoAccess
	}
	seen := make(map[uuid.UUID]bool, len(kbIDs))
	for _, id := range kbIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		if err := a.OwnsKB(ctx, user, id); err != nil {
			return err
		}
	}
	return nil
}
