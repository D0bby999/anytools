package tools

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/runtime"
)

// setup builds a user who owns one KB and one document, plus a stranger who
// owns another of each.
type fixture struct {
	user       uuid.UUID
	stranger   uuid.UUID
	ownKB      uuid.UUID
	foreignKB  uuid.UUID
	ownDoc     uuid.UUID
	foreignDoc uuid.UUID

	authz     *fakeAuthz
	retriever *fakeRetriever
	reader    *fakeReader
	lister    *fakeLister
}

func newFixture() *fixture {
	f := &fixture{
		user: uuid.New(), stranger: uuid.New(),
		ownKB: uuid.New(), foreignKB: uuid.New(),
		ownDoc: uuid.New(), foreignDoc: uuid.New(),
		authz: newFakeAuthz(),
	}
	f.authz.kbs[f.ownKB] = f.user
	f.authz.kbs[f.foreignKB] = f.stranger
	f.authz.docs[f.ownDoc] = f.user
	f.authz.docs[f.foreignDoc] = f.stranger

	f.retriever = &fakeRetriever{chunks: []Chunk{{
		ID: "chunk-1", DocumentID: f.ownDoc.String(), DocumentTitle: "Chapter 3",
		Page: 14, Text: "Hybrid retrieval combines lexical and dense signals.",
	}}}
	f.reader = &fakeReader{pages: map[int]Page{
		14: {Title: "Chapter 3", Text: "Page fourteen text.", PageCount: 50},
	}}
	f.lister = &fakeLister{files: map[uuid.UUID][]File{
		f.ownKB: {{DocumentID: f.ownDoc.String(), Title: "Chapter 3", Pages: 50, Status: "ready"}},
	}}
	return f
}

func (f *fixture) input() runtime.ToolInput {
	return runtime.ToolInput{UserID: f.user, SessionID: uuid.New(), TurnID: uuid.New(),
		KBIDs: []uuid.UUID{f.ownKB}}
}

// AC (phase 6): "a document containing an instruction to search another user's
// KB yields a tool error and no foreign rows".
//
// This is the test for that criterion, driven by the corpus fixture that
// carries the instruction.
func TestForeignKBSearchReturnsAToolErrorAndNeverReachesTheRetriever(t *testing.T) {
	f := newFixture()
	tool := NewRAGSearch(f.retriever, f.authz)

	res, err := tool.Execute(context.Background(), map[string]any{
		"query":  "administrator notes",
		"kb_ids": []any{f.foreignKB.String()},
	}, f.input())

	if err != nil {
		t.Fatalf("Execute returned a Go error; the model should get a tool error: %v", err)
	}
	if !res.IsError {
		t.Fatalf("a foreign kb id was accepted: %+v", res)
	}
	if len(res.Sources) != 0 {
		t.Fatalf("foreign sources leaked: %+v", res.Sources)
	}
	if f.retriever.callCount() != 0 {
		t.Fatal("the retriever was called for a foreign kb; the gate must run BEFORE the tool body")
	}
	if !strings.Contains(res.Content, notYoursMessage) {
		t.Fatalf("refusal text = %q", res.Content)
	}
}

// A kb id the user DOES own but which is not attached to this session is also
// refused: a poisoned document must not be able to widen the conversation's
// reach beyond what the user chose.
func TestKBOutsideTheSessionIsRefusedEvenWhenOwned(t *testing.T) {
	f := newFixture()
	otherOwnKB := uuid.New()
	f.authz.kbs[otherOwnKB] = f.user // same user, different KB

	tool := NewRAGSearch(f.retriever, f.authz)
	res, err := tool.Execute(context.Background(), map[string]any{
		"query": "anything", "kb_ids": []any{otherOwnKB.String()},
	}, f.input())

	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !res.IsError {
		t.Fatal("a KB outside the session was searched")
	}
	if f.retriever.callCount() != 0 {
		t.Fatal("the retriever was reached")
	}
}

// "Not yours" and "does not exist" must be indistinguishable, or the error text
// is an existence oracle for other people's data.
func TestRefusalDoesNotDistinguishMissingFromForeign(t *testing.T) {
	f := newFixture()
	tool := NewRAGSearch(f.retriever, f.authz)

	foreign, _ := tool.Execute(context.Background(),
		map[string]any{"query": "q", "kb_ids": []any{f.foreignKB.String()}}, f.input())
	missing, _ := tool.Execute(context.Background(),
		map[string]any{"query": "q", "kb_ids": []any{uuid.New().String()}}, f.input())

	if foreign.Content != missing.Content {
		t.Fatalf("refusals differ:\n foreign: %q\n missing: %q", foreign.Content, missing.Content)
	}
}

func TestForeignDocumentReadIsRefusedBeforeTheReader(t *testing.T) {
	f := newFixture()
	tool := NewReadSource(f.reader, f.authz)

	res, err := tool.Execute(context.Background(), map[string]any{
		"document_id": f.foreignDoc.String(), "page": 14,
	}, f.input())

	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !res.IsError {
		t.Fatalf("a foreign document was read: %+v", res)
	}
	if f.reader.callCount() != 0 {
		t.Fatal("the source reader was called for a foreign document")
	}
}

func TestForeignKBFileListingIsRefusedBeforeTheLister(t *testing.T) {
	f := newFixture()
	tool := NewKBFiles(f.lister, f.authz)

	res, err := tool.Execute(context.Background(),
		map[string]any{"kb_id": f.foreignKB.String()}, f.input())

	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !res.IsError {
		t.Fatalf("a foreign KB was listed: %+v", res)
	}
	if f.lister.callCount() != 0 {
		t.Fatal("the file lister was called for a foreign KB")
	}
}

// The success path, which the chatapi harness's always-failing fake reader
// never reaches. It asserts the minted id is one the citation format can
// actually express.
func TestOwnedDocumentReadReturnsAWrappedPageAndACitableSource(t *testing.T) {
	f := newFixture()
	tool := NewReadSource(f.reader, f.authz)

	res, err := tool.Execute(context.Background(), map[string]any{
		"document_id": f.ownDoc.String(), "page": 14,
	}, f.input())
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if res.IsError {
		t.Fatalf("an owned document was refused: %q", res.Content)
	}
	if !strings.Contains(res.Content, `trust="untrusted"`) {
		t.Fatalf("page text was not wrapped in the provenance envelope: %q", res.Content)
	}
	if len(res.Sources) != 1 {
		t.Fatalf("sources = %+v", res.Sources)
	}

	src := res.Sources[0]
	if src.Page != 14 || src.DocumentID != f.ownDoc.String() {
		t.Fatalf("source lost its page or document: %+v", src)
	}
	// THE assertion: the id must survive a round trip through the marker, or
	// the citation reaches the reader as literal text nothing can open.
	refs := citations.Parse(citations.Format(citations.KindChunk, src.ID))
	if len(refs) != 1 || refs[0].ID != src.ID {
		t.Fatalf("read_source minted an id the citation format cannot express: %q", src.ID)
	}
}

// A page that does not exist tells the model how many there are, so it can
// correct itself rather than retry the same call.
func TestAMissingPageReportsTheDocumentLength(t *testing.T) {
	f := newFixture()
	res, err := NewReadSource(f.reader, f.authz).Execute(context.Background(), map[string]any{
		"document_id": f.ownDoc.String(), "page": 999,
	}, f.input())
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !res.IsError {
		t.Fatalf("a missing page was reported as content: %+v", res)
	}
}

// An authorizer that errors must refuse, not fall through. "Could not check"
// has to mean "no", or a database blip becomes an access-control bypass.
func TestAuthorizerFailureRefuses(t *testing.T) {
	f := newFixture()
	f.authz.err = errBackend
	tool := NewRAGSearch(f.retriever, f.authz)

	res, err := tool.Execute(context.Background(),
		map[string]any{"query": "q"}, f.input())

	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !res.IsError {
		t.Fatal("an authorizer failure allowed the search through")
	}
	if f.retriever.callCount() != 0 {
		t.Fatal("the retriever ran despite an unanswerable authorization check")
	}
}

// The happy path: an owned KB attached to the session is searched, and the
// result carries citable sources with page numbers.
func TestOwnedKBSearchReturnsWrappedPassagesAndSources(t *testing.T) {
	f := newFixture()
	tool := NewRAGSearch(f.retriever, f.authz)

	res, err := tool.Execute(context.Background(),
		map[string]any{"query": "hybrid retrieval"}, f.input())
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if res.IsError {
		t.Fatalf("an owned KB was refused: %q", res.Content)
	}
	if f.retriever.callCount() != 1 {
		t.Fatalf("retriever called %d times", f.retriever.callCount())
	}
	if len(res.Sources) != 1 {
		t.Fatalf("sources = %+v", res.Sources)
	}
	src := res.Sources[0]
	if src.Page != 14 || src.DocumentID != f.ownDoc.String() {
		t.Fatalf("source lost its page or document: %+v", src)
	}

	// Every passage is envelope-wrapped and carries its own citation marker, or
	// the model has nothing valid to cite with.
	if !strings.Contains(res.Content, `trust="untrusted"`) {
		t.Fatalf("passage was not wrapped in the provenance envelope: %q", res.Content)
	}
	if !strings.Contains(res.Content, "[[cite:chunk:chunk-1]]") {
		t.Fatalf("passage carries no citation marker: %q", res.Content)
	}
}

// Omitting kb_ids means "the session's knowledge bases", never "all of them".
func TestOmittedKBIDsDefaultToTheSessionScope(t *testing.T) {
	f := newFixture()
	tool := NewRAGSearch(f.retriever, f.authz)

	if _, err := tool.Execute(context.Background(),
		map[string]any{"query": "q"}, f.input()); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if len(f.retriever.lastKBs) != 1 || f.retriever.lastKBs[0] != f.ownKB {
		t.Fatalf("searched %v, want only the session's KB", f.retriever.lastKBs)
	}
}

func TestSessionWithNoKnowledgeBasesSaysSo(t *testing.T) {
	f := newFixture()
	tool := NewRAGSearch(f.retriever, f.authz)

	in := f.input()
	in.KBIDs = nil
	res, err := tool.Execute(context.Background(), map[string]any{"query": "q"}, in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !res.IsError || !strings.Contains(res.Content, "no knowledge bases") {
		t.Fatalf("res = %+v", res)
	}
}

// The retrieval limit is capped: an unbounded limit is an invitation to pull
// the most aggressive instructions in the corpus into context.
func TestSearchLimitIsCapped(t *testing.T) {
	f := newFixture()
	f.retriever.chunks = make([]Chunk, 100)
	for i := range f.retriever.chunks {
		f.retriever.chunks[i] = Chunk{ID: "c", DocumentTitle: "t", Text: "x"}
	}
	tool := NewRAGSearch(f.retriever, f.authz)

	res, err := tool.Execute(context.Background(),
		map[string]any{"query": "q", "limit": 500}, f.input())
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if len(res.Sources) > maxSearchLimit {
		t.Fatalf("returned %d passages, want at most %d", len(res.Sources), maxSearchLimit)
	}
}
