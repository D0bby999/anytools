package authz_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/authz"
)

type fakeLookup struct {
	kbs  map[uuid.UUID]uuid.UUID    // kb -> owner
	docs map[uuid.UUID][2]uuid.UUID // doc -> {owner, kb}
	err  error                      // a transport failure to simulate
	seen map[uuid.UUID]int          // call counting
}

func newFake() *fakeLookup {
	return &fakeLookup{
		kbs:  map[uuid.UUID]uuid.UUID{},
		docs: map[uuid.UUID][2]uuid.UUID{},
		seen: map[uuid.UUID]int{},
	}
}

func (f *fakeLookup) KBOwner(_ context.Context, kbID uuid.UUID) (uuid.UUID, error) {
	if f.err != nil {
		return uuid.Nil, f.err
	}
	f.seen[kbID]++
	owner, ok := f.kbs[kbID]
	if !ok {
		return uuid.Nil, authz.ErrNoAccess
	}
	return owner, nil
}

func (f *fakeLookup) DocumentOwner(_ context.Context, docID uuid.UUID) (uuid.UUID, uuid.UUID, error) {
	if f.err != nil {
		return uuid.Nil, uuid.Nil, f.err
	}
	row, ok := f.docs[docID]
	if !ok {
		return uuid.Nil, uuid.Nil, authz.ErrNoAccess
	}
	return row[0], row[1], nil
}

func TestOwnsKB(t *testing.T) {
	alice, bob := uuid.New(), uuid.New()
	aliceKB, bobKB := uuid.New(), uuid.New()

	f := newFake()
	f.kbs[aliceKB] = alice
	f.kbs[bobKB] = bob
	a := authz.New(f)
	ctx := context.Background()

	if err := a.OwnsKB(ctx, alice, aliceKB); err != nil {
		t.Fatalf("alice must own her own KB: %v", err)
	}

	// The core isolation property, and the identical answer for a KB that does
	// not exist: "you may not have this" and "this is not here" must be
	// indistinguishable, or the endpoint is an existence oracle.
	someoneElses := a.OwnsKB(ctx, alice, bobKB)
	neverExisted := a.OwnsKB(ctx, alice, uuid.New())
	if !errors.Is(someoneElses, authz.ErrNoAccess) {
		t.Fatalf("alice must not reach bob's KB, got %v", someoneElses)
	}
	if !errors.Is(neverExisted, authz.ErrNoAccess) {
		t.Fatalf("a missing KB must answer ErrNoAccess, got %v", neverExisted)
	}
	if someoneElses.Error() != neverExisted.Error() {
		t.Fatalf("the two answers differ (%q vs %q) — that is an existence oracle",
			someoneElses, neverExisted)
	}
}

func TestNilIdentifiersAreRefusedWithoutALookup(t *testing.T) {
	f := newFake()
	a := authz.New(f)
	ctx := context.Background()

	if err := a.OwnsKB(ctx, uuid.Nil, uuid.New()); !errors.Is(err, authz.ErrNoAccess) {
		t.Fatalf("a nil user must be refused, got %v", err)
	}
	if err := a.OwnsKB(ctx, uuid.New(), uuid.Nil); !errors.Is(err, authz.ErrNoAccess) {
		t.Fatalf("a nil resource must be refused, got %v", err)
	}
	if len(f.seen) != 0 {
		t.Fatal("a nil identifier must not reach the database at all")
	}
}

// A lookup failure is not an authorization decision. Collapsing it into
// ErrNoAccess would turn a database blip into "your knowledge base is gone".
func TestLookupFailureIsNotADenial(t *testing.T) {
	boom := errors.New("connection reset")
	f := newFake()
	f.err = boom
	a := authz.New(f)

	err := a.OwnsKB(context.Background(), uuid.New(), uuid.New())
	if errors.Is(err, authz.ErrNoAccess) {
		t.Fatal("a transport failure must not be reported as a denial")
	}
	if !errors.Is(err, boom) {
		t.Fatalf("the cause must be preserved, got %v", err)
	}
}

func TestOwnsDocumentReturnsItsKB(t *testing.T) {
	alice, bob := uuid.New(), uuid.New()
	kb, doc := uuid.New(), uuid.New()
	bobDoc := uuid.New()

	f := newFake()
	f.docs[doc] = [2]uuid.UUID{alice, kb}
	f.docs[bobDoc] = [2]uuid.UUID{bob, uuid.New()}
	a := authz.New(f)
	ctx := context.Background()

	got, err := a.OwnsDocument(ctx, alice, doc)
	if err != nil {
		t.Fatalf("OwnsDocument: %v", err)
	}
	if got != kb {
		t.Fatalf("kb = %s, want %s", got, kb)
	}

	if _, err := a.OwnsDocument(ctx, alice, bobDoc); !errors.Is(err, authz.ErrNoAccess) {
		t.Fatalf("alice must not reach bob's document, got %v", err)
	}
}

// Phase 6's `rag_search(kb_ids, query)` takes this list from a MODEL. Every
// element is untrusted input, and one bad element must fail the call rather
// than narrow it: silently answering a question about five knowledge bases
// using two, and saying nothing about the difference, is worse than an error.
func TestOwnsAllKBsFailsClosedOnOneBadID(t *testing.T) {
	alice, bob := uuid.New(), uuid.New()
	a1, a2, b1 := uuid.New(), uuid.New(), uuid.New()

	f := newFake()
	f.kbs[a1], f.kbs[a2], f.kbs[b1] = alice, alice, bob
	a := authz.New(f)
	ctx := context.Background()

	if err := a.OwnsAllKBs(ctx, alice, []uuid.UUID{a1, a2}); err != nil {
		t.Fatalf("alice owns both: %v", err)
	}
	if err := a.OwnsAllKBs(ctx, alice, []uuid.UUID{a1, b1, a2}); !errors.Is(err, authz.ErrNoAccess) {
		t.Fatalf("one unowned id must fail the whole call, got %v", err)
	}
	if err := a.OwnsAllKBs(ctx, alice, nil); !errors.Is(err, authz.ErrNoAccess) {
		t.Fatalf("an empty list must not be treated as 'all of them', got %v", err)
	}
}

func TestOwnsAllKBsChecksEachIDOnce(t *testing.T) {
	alice := uuid.New()
	kb := uuid.New()
	f := newFake()
	f.kbs[kb] = alice
	a := authz.New(f)

	if err := a.OwnsAllKBs(context.Background(), alice, []uuid.UUID{kb, kb, kb}); err != nil {
		t.Fatalf("OwnsAllKBs: %v", err)
	}
	if f.seen[kb] != 1 {
		t.Fatalf("looked the same id up %d times; a model repeating an id must not multiply the queries", f.seen[kb])
	}
}
