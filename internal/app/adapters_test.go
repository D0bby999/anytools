package app

// adapters_test.go — the seams, against fakes.
//
// Every test here is about a CONVERSION or a RULE that lives only in the
// adapter: a stop field becoming a batching decision, a vector width being
// measured rather than assumed, a stale knowledge base being dropped rather
// than searched. The subsystems on either side have their own suites; what has
// no other home is the translation between them, which is exactly the code a
// merge introduces and nobody owns.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/embed"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/rag/retrieve"
	"github.com/D0bby999/anytools/internal/tools"
)

// ───────────────────────────────────────────────────────────────── parse

// fakeDocumentParser is phase 4's client shape.
type fakeDocumentParser struct {
	name, model string
	result      parse.Result
	err         error
	gotStart    int
	gotEnd      int
	gotBytes    int
	gotMIME     string
}

func (p *fakeDocumentParser) Name() string  { return p.name }
func (p *fakeDocumentParser) Model() string { return p.model }
func (p *fakeDocumentParser) Ping(context.Context) error {
	return nil
}
func (p *fakeDocumentParser) ParsePages(_ context.Context, data []byte, start, end int) (parse.Result, error) {
	p.gotStart, p.gotEnd, p.gotBytes = start, end, len(data)
	return p.result, p.err
}
func (p *fakeDocumentParser) ParseImage(_ context.Context, data []byte, mime string) (parse.Result, error) {
	p.gotBytes, p.gotMIME = len(data), mime
	return p.result, p.err
}

// A photo's page goes to the client's image call with its own type; a PDF
// window never does (up-methods phase 16).
func TestPageParserSendsAPhotoToTheImageCall(t *testing.T) {
	inner := &fakeDocumentParser{name: "gemini", model: "gemini-3.6-flash",
		result: parse.Result{Markdown: "Notes.", FinishReason: "STOP"}}
	got, err := pageParser{inner: inner}.ParsePages(context.Background(), parse.PageRequest{
		Data: []byte("\xff\xd8\xffjpeg"), MIME: "image/jpeg", Start: 3, End: 3,
	})
	if err != nil {
		t.Fatalf("ParsePages: %v", err)
	}
	if inner.gotMIME != "image/jpeg" || inner.gotStart != 0 {
		t.Fatalf("photo went to mime %q, page call %d", inner.gotMIME, inner.gotStart)
	}
	if got.Model != "gemini-3.6-flash" || got.Finish != parse.PageFinishStop {
		t.Fatalf("result = %+v", got)
	}

	inner.gotMIME = ""
	if _, err := (pageParser{inner: inner}).ParsePages(context.Background(), parse.PageRequest{
		Data: []byte("%PDF-x"), MIME: "application/pdf", Start: 1, End: 1}); err != nil {
		t.Fatal(err)
	}
	if inner.gotMIME != "" || inner.gotStart != 1 {
		t.Fatalf("a PDF window went to the image call (%q)", inner.gotMIME)
	}
}

func TestPageParserCarriesTheWindowAndTheModelThrough(t *testing.T) {
	inner := &fakeDocumentParser{
		name: "gemini", model: "gemini-3.6-flash",
		result: parse.Result{
			Markdown: "<!-- page: 11 -->\nhello", FinishReason: "STOP",
			InputTokens: 120, OutputTokens: 40,
		},
	}
	got, err := pageParser{inner: inner}.ParsePages(context.Background(), parse.PageRequest{
		Data: []byte("%PDF-fake"), MIME: "application/pdf", Start: 11, End: 20,
	})
	if err != nil {
		t.Fatalf("ParsePages: %v", err)
	}

	// The ABSOLUTE page numbers must survive: they are what the markers in the
	// output are checked against, and an adapter that renumbered from 1 would
	// mis-attribute every citation in the document.
	if inner.gotStart != 11 || inner.gotEnd != 20 {
		t.Fatalf("client saw pages %d-%d, want 11-20", inner.gotStart, inner.gotEnd)
	}
	if inner.gotBytes != len("%PDF-fake") {
		t.Fatalf("client saw %d bytes of the window", inner.gotBytes)
	}
	// documents.processed_by shows the MODEL next to the lane; the page-level
	// interface has no Model() of its own, so the adapter is the only place it
	// can come from.
	if got.Model != "gemini-3.6-flash" {
		t.Fatalf("model = %q, want the client's", got.Model)
	}
	if got.Finish != parse.PageFinishStop {
		t.Fatalf("finish = %q, want stop", got.Finish)
	}
	if got.InputTokens != 120 || got.OutputTokens != 40 {
		t.Fatalf("token counts lost: %+v", got)
	}
	if (pageParser{inner: inner}).ProviderName() != "gemini" {
		t.Fatal("ProviderName must be the lane, which is what the user sees")
	}
}

// The mapping that decides whether the batcher halves the window and re-parses.
//
// Getting "other" and "truncated" the wrong way round is silent in both
// directions: a truncated window would be indexed half-empty, and a
// safety-refused one would be re-requested four more times.
func TestPageFinishMapsProviderStopFields(t *testing.T) {
	cases := []struct {
		name string
		in   parse.Result
		want parse.PageFinish
	}{
		{"gemini clean", parse.Result{FinishReason: "STOP"}, parse.PageFinishStop},
		{"gemini ceiling", parse.Result{FinishReason: "MAX_TOKENS", Truncated: true}, parse.PageFinishTruncated},
		{"gemini safety", parse.Result{FinishReason: "SAFETY", Truncated: true}, parse.PageFinishOther},
		{"openai ceiling", parse.Result{FinishReason: "incomplete:max_output_tokens", Truncated: true}, parse.PageFinishTruncated},
		{"openai filtered", parse.Result{FinishReason: "incomplete:content_filter", Truncated: true}, parse.PageFinishOther},
		{"anthropic ceiling", parse.Result{FinishReason: "max_tokens", Truncated: true}, parse.PageFinishTruncated},
		{"anthropic refusal", parse.Result{FinishReason: "refusal", Truncated: true}, parse.PageFinishOther},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := pageFinish(tc.in); got != tc.want {
				t.Fatalf("pageFinish(%+v) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// ───────────────────────────────────────────────────────────────── embed

type fakeEmbedder struct {
	model, name string
	dims        int
	vectors     [][]float32
	err         error
	gotTasks    []embed.Task
}

func (e *fakeEmbedder) Name() string                      { return e.name }
func (e *fakeEmbedder) Model() string                     { return e.model }
func (e *fakeEmbedder) Dims() int                         { return e.dims }
func (e *fakeEmbedder) Ping(context.Context) (int, error) { return e.dims, nil }
func (e *fakeEmbedder) Embed(_ context.Context, texts []string, task embed.Task) ([][]float32, error) {
	e.gotTasks = append(e.gotTasks, task)
	if e.err != nil {
		return nil, e.err
	}
	if e.vectors != nil {
		return e.vectors, nil
	}
	out := make([][]float32, len(texts))
	for i := range out {
		out[i] = make([]float32, e.dims)
	}
	return out, nil
}

// The width comes back from the CALL, not from the route, because a connection
// nobody has verified legitimately reports Dims() == 0 — and a knowledge base
// pinned at 0 is a knowledge base no query can filter on.
func TestEmbedderMeasuresTheWidthItActuallyGot(t *testing.T) {
	inner := &fakeEmbedder{model: "text-embedding-3-small", name: "openai", dims: 0,
		vectors: [][]float32{make([]float32, 1536), make([]float32, 1536)}}

	vectors, dims, err := routedEmbedder{inner: inner}.
		Embed(context.Background(), []string{"a", "b"}, knowledge.EmbedDocument)
	if err != nil {
		t.Fatalf("Embed: %v", err)
	}
	if dims != 1536 {
		t.Fatalf("dims = %d, want 1536 measured off the vectors (route says %d)", dims, inner.dims)
	}
	if len(vectors) != 2 {
		t.Fatalf("got %d vectors for 2 inputs", len(vectors))
	}
}

// A ragged batch must be an error. Accepting it attaches passage 7's embedding
// to passage 6 and nothing downstream can ever detect that.
func TestEmbedderRefusesARaggedBatch(t *testing.T) {
	inner := &fakeEmbedder{model: "m", name: "p",
		vectors: [][]float32{make([]float32, 768), make([]float32, 384)}}

	_, _, err := routedEmbedder{inner: inner}.
		Embed(context.Background(), []string{"a", "b"}, knowledge.EmbedDocument)
	if !errors.Is(err, embed.ErrDimensionMismatch) {
		t.Fatalf("error = %v, want ErrDimensionMismatch", err)
	}
}

// The task must survive the conversion. Embedding the corpus and the question
// the same way degrades retrieval and does it silently — every call succeeds.
func TestEmbedTaskSurvivesTheConversion(t *testing.T) {
	inner := &fakeEmbedder{model: "m", name: "p", dims: 768}
	a := routedEmbedder{inner: inner}

	if _, _, err := a.Embed(context.Background(), []string{"x"}, knowledge.EmbedDocument); err != nil {
		t.Fatalf("Embed: %v", err)
	}
	if _, _, err := a.Embed(context.Background(), []string{"x"}, knowledge.EmbedQuery); err != nil {
		t.Fatalf("Embed: %v", err)
	}
	want := []embed.Task{embed.TaskDocument, embed.TaskQuery}
	for i, task := range want {
		if inner.gotTasks[i] != task {
			t.Fatalf("call %d used task %q, want %q", i, inner.gotTasks[i], task)
		}
	}
}

// ─────────────────────────────────────────────────────────── ownership

type fakeLookup struct {
	kbs  map[uuid.UUID]uuid.UUID
	docs map[uuid.UUID]uuid.UUID
	err  error
}

func (l fakeLookup) KBOwner(_ context.Context, kbID uuid.UUID) (uuid.UUID, error) {
	if l.err != nil {
		return uuid.Nil, l.err
	}
	owner, ok := l.kbs[kbID]
	if !ok {
		return uuid.Nil, authz.ErrNoAccess
	}
	return owner, nil
}

func (l fakeLookup) DocumentOwner(_ context.Context, docID uuid.UUID) (uuid.UUID, uuid.UUID, error) {
	if l.err != nil {
		return uuid.Nil, uuid.Nil, l.err
	}
	owner, ok := l.docs[docID]
	if !ok {
		return uuid.Nil, uuid.Nil, authz.ErrNoAccess
	}
	return owner, uuid.New(), nil
}

// "Not yours" and "does not exist" must both be a plain false, and a LOOKUP
// FAILURE must not be either: reporting a database blip as "not yours" tells a
// user their knowledge base is gone and hides the outage from whoever reads the
// logs.
func TestOwnershipCollapsesMissingAndForeignButNotBroken(t *testing.T) {
	alice, bob := uuid.New(), uuid.New()
	mine, theirs, gone := uuid.New(), uuid.New(), uuid.New()
	doc := uuid.New()

	o := ownership{authz: authz.New(fakeLookup{
		kbs:  map[uuid.UUID]uuid.UUID{mine: alice, theirs: bob},
		docs: map[uuid.UUID]uuid.UUID{doc: bob},
	})}
	ctx := context.Background()

	for _, tc := range []struct {
		name string
		kb   uuid.UUID
		want bool
	}{
		{"own", mine, true},
		{"someone else's", theirs, false},
		{"does not exist", gone, false},
	} {
		got, err := o.OwnsKB(ctx, alice, tc.kb)
		if err != nil {
			t.Fatalf("%s: unexpected error %v", tc.name, err)
		}
		if got != tc.want {
			t.Fatalf("%s: OwnsKB = %v, want %v", tc.name, got, tc.want)
		}
	}

	if got, err := o.OwnsDocument(ctx, alice, doc); err != nil || got {
		t.Fatalf("another user's document: (%v, %v), want (false, nil)", got, err)
	}

	broken := ownership{authz: authz.New(fakeLookup{err: errors.New("connection reset")})}
	if _, err := broken.OwnsKB(ctx, alice, mine); err == nil {
		t.Fatal("a lookup failure was reported as a decision")
	}
}

// ───────────────────────────────────────────────────────── rag retrieval

type fakeKnowledge struct {
	kbs      map[uuid.UUID]*knowledge.KB
	docs     map[uuid.UUID][]knowledge.Document
	content  map[uuid.UUID]*knowledge.DocumentContent
	contErr  error
	listErr  error
	kbErrFor map[uuid.UUID]error
}

func (f fakeKnowledge) GetKB(_ context.Context, _, kbID uuid.UUID) (*knowledge.KB, error) {
	if err, ok := f.kbErrFor[kbID]; ok {
		return nil, err
	}
	kb, ok := f.kbs[kbID]
	if !ok {
		return nil, authz.ErrNoAccess
	}
	return kb, nil
}

func (f fakeKnowledge) ListDocuments(_ context.Context, _, kbID uuid.UUID) ([]knowledge.Document, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	return f.docs[kbID], nil
}

func (f fakeKnowledge) DocumentContent(_ context.Context, _, docID uuid.UUID, _ int) (*knowledge.DocumentContent, error) {
	if f.contErr != nil {
		return nil, f.contErr
	}
	c, ok := f.content[docID]
	if !ok {
		return nil, authz.ErrNoAccess
	}
	return c, nil
}

type fakeSearch struct {
	queries []retrieve.Query
	hits    []retrieve.Hit
}

func (s *fakeSearch) Search(_ context.Context, q retrieve.Query) ([]retrieve.Hit, error) {
	s.queries = append(s.queries, q)
	return s.hits, nil
}

type fixedProviders struct{ embedder knowledge.Embedder }

func (p fixedProviders) ParserChain(context.Context, knowledge.UserID) ([]knowledge.Parser, error) {
	return nil, nil
}
func (p fixedProviders) EmbedderFor(context.Context, knowledge.UserID) (knowledge.Embedder, error) {
	if p.embedder == nil {
		return nil, ErrNoEmbedRoute
	}
	return p.embedder, nil
}

func kbAt(model string, dims int, needsReembed bool) *knowledge.KB {
	return &knowledge.KB{ID: uuid.New(), EmbeddingModel: model, Dims: dims, NeedsReembed: needsReembed}
}

// A knowledge base whose vectors were written by a different model must be
// DROPPED from the search, not ranked: comparing two embedding spaces does not
// fail, it returns confident nonsense.
func TestRAGSearchDropsKnowledgeBasesFromAnotherEmbeddingSpace(t *testing.T) {
	current, stale := uuid.New(), uuid.New()
	kbs := fakeKnowledge{kbs: map[uuid.UUID]*knowledge.KB{
		current: kbAt("text-embedding-3-small", 1536, false),
		stale:   kbAt("gemini-embedding-001", 3072, false),
	}}
	search := &fakeSearch{hits: []retrieve.Hit{{
		ChunkID: uuid.New(), DocumentID: uuid.New(), Title: "Chapter 3",
		PageStart: 14, PageEnd: 14, Text: "hybrid retrieval", Score: 0.4,
	}}}
	r := kbRetriever{
		retriever: search, kbs: kbs,
		providers: fixedProviders{embedder: routedEmbedder{inner: &fakeEmbedder{
			model: "text-embedding-3-small", name: "openai",
			vectors: [][]float32{make([]float32, 1536)},
		}}},
	}

	chunks, err := r.Search(context.Background(), uuid.New(), []uuid.UUID{current, stale}, "q", 8)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(search.queries) != 1 {
		t.Fatalf("ran %d queries, want 1", len(search.queries))
	}
	q := search.queries[0]
	if len(q.KBIDs) != 1 || q.KBIDs[0] != current {
		t.Fatalf("searched %v, want only the knowledge base on the current route", q.KBIDs)
	}
	if q.Dims != 1536 {
		t.Fatalf("query dims = %d, want the pinned 1536", q.Dims)
	}
	if len(chunks) != 1 || chunks[0].Page != 14 {
		t.Fatalf("hit did not survive the conversion: %+v", chunks)
	}
	if chunks[0].DocumentTitle != "Chapter 3" {
		t.Fatal("a citation needs the document's title")
	}
}

// When every named knowledge base is stale, "nothing matched" would be a lie
// with the wrong remedy. The turn must say "reindex it".
func TestRAGSearchSaysReindexRatherThanNothingMatched(t *testing.T) {
	stale := uuid.New()
	r := kbRetriever{
		retriever: &fakeSearch{},
		kbs:       fakeKnowledge{kbs: map[uuid.UUID]*knowledge.KB{stale: kbAt("old-model", 768, true)}},
		providers: fixedProviders{embedder: routedEmbedder{inner: &fakeEmbedder{
			model: "new-model", name: "openai", dims: 768,
		}}},
	}

	_, err := r.Search(context.Background(), uuid.New(), []uuid.UUID{stale}, "q", 8)
	if !errors.Is(err, retrieve.ErrNeedsReembed) {
		t.Fatalf("error = %v, want retrieve.ErrNeedsReembed", err)
	}
}

// An empty knowledge base is not stale. It is empty, and the honest answer is
// "no passage matched" — which the tool renders as "say so plainly rather than
// answering from memory".
func TestRAGSearchTreatsAnUnindexedKnowledgeBaseAsEmpty(t *testing.T) {
	fresh := uuid.New()
	search := &fakeSearch{}
	r := kbRetriever{
		retriever: search,
		kbs:       fakeKnowledge{kbs: map[uuid.UUID]*knowledge.KB{fresh: kbAt("", 0, false)}},
		providers: fixedProviders{embedder: routedEmbedder{inner: &fakeEmbedder{model: "m", name: "p", dims: 768}}},
	}

	chunks, err := r.Search(context.Background(), uuid.New(), []uuid.UUID{fresh}, "q", 8)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(chunks) != 0 {
		t.Fatalf("got %d chunks from a knowledge base with nothing in it", len(chunks))
	}
	if len(search.queries) != 0 {
		t.Fatal("the retrieval statement ran for a knowledge base with no vectors")
	}
}

// The question is embedded as a QUERY. The corpus was embedded as documents;
// using one task for both is the silent recall loss knowledge.EmbedTask exists
// to prevent.
func TestRAGSearchEmbedsTheQuestionAsAQuery(t *testing.T) {
	kb := uuid.New()
	inner := &fakeEmbedder{model: "m", name: "p", vectors: [][]float32{make([]float32, 768)}}
	r := kbRetriever{
		retriever: &fakeSearch{},
		kbs:       fakeKnowledge{kbs: map[uuid.UUID]*knowledge.KB{kb: kbAt("m", 768, false)}},
		providers: fixedProviders{embedder: routedEmbedder{inner: inner}},
	}

	if _, err := r.Search(context.Background(), uuid.New(), []uuid.UUID{kb}, "what is rrf", 8); err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(inner.gotTasks) != 1 || inner.gotTasks[0] != embed.TaskQuery {
		t.Fatalf("question embedded with %v, want the query task", inner.gotTasks)
	}
}

// ───────────────────────────────────────────────── read_source, kb_files

func TestReadPageReportsAnUnparsedDocumentAsEmptyRatherThanMissing(t *testing.T) {
	docID := uuid.New()
	s := kbSourceReader{kbs: fakeKnowledge{contErr: knowledge.ErrNoParsedContent}}

	page, err := s.ReadPage(context.Background(), uuid.New(), docID, 3)
	if err != nil {
		t.Fatalf("ReadPage: %v", err)
	}
	if page.Text != "" {
		t.Fatal("an unparsed document has no text")
	}
	// Denying the document exists would contradict the Knowledge Center, which
	// is showing it as "indexing" on the same screen.
	if page.DocumentID != docID.String() {
		t.Fatalf("document id = %q, want the one that was asked for", page.DocumentID)
	}
}

func TestReadPageHidesAForeignDocumentBehindNotFound(t *testing.T) {
	s := kbSourceReader{kbs: fakeKnowledge{contErr: authz.ErrNoAccess}}
	if _, err := s.ReadPage(context.Background(), uuid.New(), uuid.New(), 1); !errors.Is(err, tools.ErrNotFound) {
		t.Fatalf("error = %v, want tools.ErrNotFound", err)
	}
}

func TestReadPageCarriesTheTitleAndPageCount(t *testing.T) {
	docID := uuid.New()
	s := kbSourceReader{kbs: fakeKnowledge{content: map[uuid.UUID]*knowledge.DocumentContent{
		docID: {
			Document: &knowledge.Document{ID: docID, Title: "rag.pdf", PageCount: 19},
			Pages:    []knowledge.Page{{Number: 14, Markdown: "Hybrid retrieval merges…"}},
		},
	}}}

	page, err := s.ReadPage(context.Background(), uuid.New(), docID, 14)
	if err != nil {
		t.Fatalf("ReadPage: %v", err)
	}
	if page.Title != "rag.pdf" || page.Page != 14 || page.PageCount != 19 {
		t.Fatalf("page = %+v", page)
	}
	if page.Text == "" {
		t.Fatal("the page carried no text")
	}
}

func TestFileListingCarriesStatusSoTheModelCanSayNotIndexedYet(t *testing.T) {
	kbID := uuid.New()
	l := kbFileLister{kbs: fakeKnowledge{docs: map[uuid.UUID][]knowledge.Document{
		kbID: {
			{ID: uuid.New(), Title: "rag.pdf", PageCount: 19, Status: knowledge.StatusReady},
			{ID: uuid.New(), Title: "scan.pdf", PageCount: 4, Status: knowledge.StatusFailed},
		},
	}}}

	files, err := l.Files(context.Background(), uuid.New(), kbID)
	if err != nil {
		t.Fatalf("Files: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("got %d files", len(files))
	}
	if files[1].Status != knowledge.StatusFailed || files[1].Pages != 4 {
		t.Fatalf("second file = %+v — a listing that hides a failure invites a confident 'it is not in here'", files[1])
	}
}
