package knowledge_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/embed"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// lastAttempt is the default for tests that run a job once. The final attempt
// is the one that settles the document, which is what almost every test here
// is asserting; retry behaviour has its own file.
var lastAttempt = knowledge.Attempt{Number: 3, Max: 3}

type harness struct {
	svc    *knowledge.Service
	store  *memStore
	chunks *memChunks
	jobs   *memJobs
	blobs  *memBlobs
	events *knowledge.Events
	user   uuid.UUID
	kb     *knowledge.KB
}

func newHarness(t *testing.T, providers *fakeProviders) *harness {
	t.Helper()
	store := newMemStore()
	h := &harness{
		store:  store,
		chunks: newMemChunks(),
		jobs:   &memJobs{},
		blobs:  newMemBlobs(),
		events: knowledge.NewEvents(),
		user:   uuid.New(),
	}
	h.svc = knowledge.NewService(knowledge.Config{
		Store: store, Chunks: h.chunks, Blobs: h.blobs, Jobs: h.jobs,
		Providers: providers, Events: h.events,
	})
	kb, err := h.svc.CreateKB(context.Background(), h.user, "Test KB")
	if err != nil {
		t.Fatalf("CreateKB: %v", err)
	}
	h.kb = kb
	return h
}

func ragPDF(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "rag", "parse", "testdata", "rag.pdf"))
	if err != nil {
		t.Fatalf("read rag.pdf: %v", err)
	}
	return b
}

func drain(ch <-chan knowledge.Event) []knowledge.Event {
	var out []knowledge.Event
	for {
		select {
		case ev, ok := <-ch:
			if !ok {
				return out
			}
			out = append(out, ev)
		default:
			return out
		}
	}
}

// ── the happy path ─────────────────────────────────────────────────────────

func TestUploadThenProcessMakesADocumentReady(t *testing.T) {
	parser := newFakeParser("gemini")
	embedder := newFakeEmbedder("text-embedding-3-small", 1536)
	h := newHarness(t, &fakeProviders{
		chain:    []knowledge.Parser{parser},
		embedder: embedder,
	})
	ctx := context.Background()

	events, stop := h.events.Subscribe(h.user, h.kb.ID)
	defer stop()

	res, err := h.svc.Upload(ctx, h.user, h.kb.ID, "rag.pdf", ragPDF(t))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if res.Document.Status != knowledge.StatusQueued {
		t.Fatalf("status after upload = %q, want queued", res.Document.Status)
	}
	if res.Document.PageCount != 19 {
		t.Fatalf("page count = %d, want 19 — pages must be counted at upload so the cap is enforceable",
			res.Document.PageCount)
	}

	if err := h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{
		DocumentID: res.Document.ID, KBID: h.kb.ID,
	}, lastAttempt); err != nil {
		t.Fatalf("ProcessDocument: %v", err)
	}

	doc, err := h.svc.GetDocument(ctx, h.user, res.Document.ID)
	if err != nil {
		t.Fatalf("GetDocument: %v", err)
	}
	if doc.Status != knowledge.StatusReady {
		t.Fatalf("status = %q (%s), want ready", doc.Status, doc.Error)
	}

	// Provenance is recorded for BOTH halves of the pipeline (RT-14).
	var pb knowledge.ProcessedBy
	if err := json.Unmarshal(doc.ProcessedBy, &pb); err != nil {
		t.Fatalf("processed_by: %v", err)
	}
	if pb.Parser != "gemini" || pb.Model != "gemini-test-model" {
		t.Fatalf("parser provenance = %+v", pb)
	}
	if pb.Embedder != "fake" || pb.EmbedModel != "text-embedding-3-small" {
		t.Fatalf("embed provenance = %+v", pb)
	}
	if pb.Downgraded {
		t.Fatal("no fallback happened; Downgraded must be false")
	}

	// The KB pinned the route it was indexed with.
	kb, _ := h.svc.GetKB(ctx, h.user, h.kb.ID)
	if kb.EmbeddingModel != "text-embedding-3-small" || kb.Dims != 1536 {
		t.Fatalf("kb route = %q/%d", kb.EmbeddingModel, kb.Dims)
	}

	// Chunks exist, are padded to the storage width, and carry native dims.
	stored := h.chunks.get(doc.ID)
	if len(stored) < 20 {
		t.Fatalf("only %d chunks stored", len(stored))
	}
	for _, c := range stored {
		if len(c.Embedding) != embed.StorageDims {
			t.Fatalf("chunk %d embedding is %d wide; it must be padded before storage", c.Ord, len(c.Embedding))
		}
		if c.Dims != 1536 {
			t.Fatalf("chunk %d records dims %d, want the NATIVE width 1536", c.Ord, c.Dims)
		}
		if c.PageStart < 1 || c.PageEnd > 19 {
			t.Fatalf("chunk %d pages %d-%d out of range", c.Ord, c.PageStart, c.PageEnd)
		}
	}

	// Batching really is 64 at a time.
	for i, n := range embedder.batchSizes() {
		if n > knowledge.EmbedBatchSize {
			t.Fatalf("embed batch %d had %d texts, cap is %d", i, n, knowledge.EmbedBatchSize)
		}
	}

	// Indexing embeds with EmbedDocument, always. A task-aware model places a
	// QUESTION near the answers it should retrieve; embedding the corpus the
	// same way costs recall silently, since every call still succeeds.
	tasks := embedder.taskUsed()
	if len(tasks) == 0 {
		t.Fatal("no embed calls recorded")
	}
	for i, task := range tasks {
		if task != knowledge.EmbedDocument {
			t.Fatalf("embed call %d used task %q, want %q", i, task, knowledge.EmbedDocument)
		}
	}

	// The lifecycle was published in order, and ended terminal.
	var statuses []string
	for _, ev := range drain(events) {
		if ev.Type == knowledge.EventDocumentStatus {
			statuses = append(statuses, ev.Status)
		}
	}
	want := []string{knowledge.StatusQueued, knowledge.StatusParsing, knowledge.StatusIndexing, knowledge.StatusReady}
	if strings.Join(statuses, ",") != strings.Join(want, ",") {
		t.Fatalf("status events = %v, want %v", statuses, want)
	}
}

// ── provenance on the fallback path ────────────────────────────────────────

// RT-14: a chain that silently re-sends a document to the next provider is the
// failure the user most needs to see, so it must reach BOTH the stored
// provenance and a document event.
func TestProviderFallbackIsRecordedAndPublished(t *testing.T) {
	broken := newFakeParser("openai")
	broken.failWith = errors.New("429 quota exhausted")
	working := newFakeParser("gemini")

	h := newHarness(t, &fakeProviders{
		chain:    []knowledge.Parser{broken, working},
		embedder: newFakeEmbedder("embed-1", 768),
	})
	ctx := context.Background()

	events, stop := h.events.Subscribe(h.user, h.kb.ID)
	defer stop()

	res, err := h.svc.Upload(ctx, h.user, h.kb.ID, "rag.pdf", ragPDF(t))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if err := h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{
		DocumentID: res.Document.ID, KBID: h.kb.ID,
	}, lastAttempt); err != nil {
		t.Fatalf("ProcessDocument: %v", err)
	}

	doc, _ := h.svc.GetDocument(ctx, h.user, res.Document.ID)
	var pb knowledge.ProcessedBy
	_ = json.Unmarshal(doc.ProcessedBy, &pb)
	if !pb.Downgraded {
		t.Fatal("processed_by must record that the first provider was not the one that worked")
	}
	if pb.Parser != "gemini" {
		t.Fatalf("processed_by names %q; it must name the provider that actually read the document", pb.Parser)
	}
	if !strings.Contains(pb.Note, "openai") {
		t.Fatalf("the note must name the provider that was tried first: %q", pb.Note)
	}

	var fallbacks []knowledge.Event
	for _, ev := range drain(events) {
		if ev.Type == knowledge.EventDocumentFallback {
			fallbacks = append(fallbacks, ev)
		}
	}
	if len(fallbacks) != 1 {
		t.Fatalf("got %d fallback events, want 1", len(fallbacks))
	}
	if !strings.Contains(fallbacks[0].Message, "openai") || !strings.Contains(fallbacks[0].Message, "gemini") {
		t.Fatalf("fallback message must name both lanes: %q", fallbacks[0].Message)
	}
}

// ── failures are terminal and legible ──────────────────────────────────────

// Every exit leaves the document terminal. This is the stuck-`parsing` failure
// red-team RT-8 named, tested at the service layer rather than only through the
// reaper.
func TestEveryFailurePathEndsTerminalWithAReason(t *testing.T) {
	cases := []struct {
		name      string
		providers *fakeProviders
		filename  string
		data      []byte
		wantIn    string
		terminal  bool
	}{
		{
			name:      "no embedder configured",
			providers: &fakeProviders{chain: []knowledge.Parser{newFakeParser("gemini")}, embedErr: errors.New("no key")},
			filename:  "rag.pdf",
			wantIn:    "embedding model",
			terminal:  true,
		},
		{
			name: "embed route unreachable",
			providers: func() *fakeProviders {
				e := newFakeEmbedder("embed-1", 768)
				e.failWith = errors.New("503 upstream")
				return &fakeProviders{chain: []knowledge.Parser{newFakeParser("gemini")}, embedder: e}
			}(),
			filename: "rag.pdf",
			wantIn:   "embedding model could not be reached",
			terminal: false, // a blip is worth another attempt
		},
		{
			name: "embed route returns a ragged batch",
			providers: func() *fakeProviders {
				e := newFakeEmbedder("embed-1", 768)
				e.ragged = true
				return &fakeProviders{chain: []knowledge.Parser{newFakeParser("gemini")}, embedder: e}
			}(),
			filename: "rag.pdf",
			wantIn:   "embedding model could not be reached",
			terminal: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t, tc.providers)
			ctx := context.Background()
			data := tc.data
			if data == nil {
				data = ragPDF(t)
			}

			res, err := h.svc.Upload(ctx, h.user, h.kb.ID, tc.filename, data)
			if err != nil {
				t.Fatalf("Upload: %v", err)
			}
			err = h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{
				DocumentID: res.Document.ID, KBID: h.kb.ID,
			}, lastAttempt)
			if err == nil {
				t.Fatal("expected the job to report a failure")
			}
			if knowledge.IsTerminal(err) != tc.terminal {
				t.Fatalf("IsTerminal = %v, want %v (err: %v)", knowledge.IsTerminal(err), tc.terminal, err)
			}

			doc, _ := h.svc.GetDocument(ctx, h.user, res.Document.ID)
			if doc.Status != knowledge.StatusFailed {
				t.Fatalf("status = %q, want failed — never left mid-flight", doc.Status)
			}
			if !strings.Contains(doc.Error, tc.wantIn) {
				t.Fatalf("error %q does not mention %q", doc.Error, tc.wantIn)
			}
		})
	}
}

// A scanned PDF with no model configured is the one failure with an actionable
// answer, and the message has to carry it.
func TestScannedPDFWithoutAModelFailsActionably(t *testing.T) {
	scanned, err := os.ReadFile(filepath.Join("..", "rag", "parse", "testdata", "scanned-rag-10p.pdf"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	h := newHarness(t, &fakeProviders{embedder: newFakeEmbedder("embed-1", 768)})
	ctx := context.Background()

	res, err := h.svc.Upload(ctx, h.user, h.kb.ID, "scanned.pdf", scanned)
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	err = h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{
		DocumentID: res.Document.ID, KBID: h.kb.ID,
	}, lastAttempt)
	if !knowledge.IsTerminal(err) {
		t.Fatalf("a scan with no model will never succeed on retry; err = %v", err)
	}
	doc, _ := h.svc.GetDocument(ctx, h.user, res.Document.ID)
	if !strings.Contains(doc.Error, "Settings") {
		t.Fatalf("the message must tell the user what to do: %q", doc.Error)
	}
}

// With no model at all, a born-digital PDF still indexes — through the local
// text layer, and the provenance says so plainly.
func TestNoModelStillIndexesAPDFWithATextLayer(t *testing.T) {
	h := newHarness(t, &fakeProviders{embedder: newFakeEmbedder("embed-1", 768)})
	ctx := context.Background()

	res, err := h.svc.Upload(ctx, h.user, h.kb.ID, "rag.pdf", ragPDF(t))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if err := h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{
		DocumentID: res.Document.ID, KBID: h.kb.ID,
	}, lastAttempt); err != nil {
		t.Fatalf("ProcessDocument: %v", err)
	}
	doc, _ := h.svc.GetDocument(ctx, h.user, res.Document.ID)
	if doc.Status != knowledge.StatusReady {
		t.Fatalf("status = %q (%s)", doc.Status, doc.Error)
	}
	var pb knowledge.ProcessedBy
	_ = json.Unmarshal(doc.ProcessedBy, &pb)
	if !strings.HasPrefix(pb.Parser, "local:") {
		t.Fatalf("parser = %q, want a local lane", pb.Parser)
	}
	if !strings.Contains(pb.Note, "no model") {
		t.Fatalf("the note must say no model was used: %q", pb.Note)
	}
}

// A worker that the reaper has already given up on must stop quietly rather
// than overwrite the account the reaper wrote.
//
// This is the straggler half of RT-8. The reaper takes a job back when its
// lease expires, but the worker only learns so at its next heartbeat; in
// between it is still running with a live context. If it were allowed to write
// `parsing` over the reaper's `failed`, the document would sit in a working
// state with no job left to finish it — the stuck document, arriving through
// the machinery built to prevent it.
func TestAStragglerWorkerDoesNotReviveASettledDocument(t *testing.T) {
	h := newHarness(t, &fakeProviders{
		chain:    []knowledge.Parser{newFakeParser("gemini")},
		embedder: newFakeEmbedder("embed-1", 768),
	})
	ctx := context.Background()

	res, err := h.svc.Upload(ctx, h.user, h.kb.ID, "rag.pdf", ragPDF(t))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}

	// The reaper ran out of attempts and settled the document while this
	// worker was still inside its parse.
	h.store.settle(res.Document.ID, knowledge.StatusFailed,
		"processing stopped unexpectedly and has been retried as many times as allowed")

	// The straggler now finishes its work and tries to report.
	if err := h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{
		DocumentID: res.Document.ID, KBID: h.kb.ID,
	}, lastAttempt); err != nil {
		t.Fatalf("a straggler must stop cleanly, not report a failure of its own: %v", err)
	}

	doc, _ := h.svc.GetDocument(ctx, h.user, res.Document.ID)
	if doc.Status != knowledge.StatusFailed {
		t.Fatalf("status = %q — the straggler revived a settled document", doc.Status)
	}
	if !strings.Contains(doc.Error, "retried as many times") {
		t.Fatalf("the reaper's reason was overwritten: %q", doc.Error)
	}
}

// ── upload validation ──────────────────────────────────────────────────────

func TestUploadRefusesUnsupportedTypesBeforeStoringAnything(t *testing.T) {
	h := newHarness(t, &fakeProviders{})
	_, err := h.svc.Upload(context.Background(), h.user, h.kb.ID, "payload.exe", []byte("MZ\x90\x00"))
	if !errors.Is(err, parse.ErrUnsupportedType) {
		t.Fatalf("err = %v, want ErrUnsupportedType", err)
	}
	if len(h.jobs.enqueued) != 0 {
		t.Fatal("a refused upload must not queue work")
	}
}

func TestUploadRefusesAnOversizeFile(t *testing.T) {
	h := newHarness(t, &fakeProviders{})
	huge := make([]byte, knowledge.MaxUploadBytes+1)
	copy(huge, "%PDF-1.4")
	_, err := h.svc.Upload(context.Background(), h.user, h.kb.ID, "big.pdf", huge)
	if err == nil || !strings.Contains(err.Error(), "limit") {
		t.Fatalf("err = %v, want a size-limit error", err)
	}
}

// The cap must bite before any provider quota is spent, which means at upload,
// not inside the job.
func TestPageCapIsEnforcedAtUpload(t *testing.T) {
	parser := newFakeParser("gemini")
	h := newHarness(t, &fakeProviders{chain: []knowledge.Parser{parser}, embedder: newFakeEmbedder("e", 768)})
	h.svc = knowledge.NewService(knowledge.Config{
		Store: h.store, Chunks: h.chunks, Blobs: h.blobs, Jobs: h.jobs,
		Providers: &fakeProviders{chain: []knowledge.Parser{parser}, embedder: newFakeEmbedder("e", 768)},
		Events:    h.events,
		Parse:     parse.Options{MaxPages: 5},
	})

	_, err := h.svc.Upload(context.Background(), h.user, h.kb.ID, "rag.pdf", ragPDF(t))
	if err == nil || !strings.Contains(err.Error(), "limit is 5") {
		t.Fatalf("err = %v, want a page-cap refusal naming the limit", err)
	}
	if len(parser.calls()) != 0 {
		t.Fatal("the cap must be checked before any provider call")
	}
}

func TestUploadFailsTheDocumentIfItCannotBeQueued(t *testing.T) {
	h := newHarness(t, &fakeProviders{})
	h.jobs.failWith = errors.New("database down")

	_, err := h.svc.Upload(context.Background(), h.user, h.kb.ID, "rag.pdf", ragPDF(t))
	if err == nil {
		t.Fatal("expected the enqueue failure to surface")
	}
	// The row exists but nothing will ever work on it: it must say so rather
	// than sitting in `queued` forever.
	docs, _ := h.svc.ListDocuments(context.Background(), h.user, h.kb.ID)
	if len(docs) != 1 {
		t.Fatalf("got %d documents", len(docs))
	}
	if docs[0].Status != knowledge.StatusFailed {
		t.Fatalf("status = %q, want failed", docs[0].Status)
	}
}

// ── reindex ────────────────────────────────────────────────────────────────

// A reindex re-embeds the EXISTING chunks. Re-parsing would spend the user's
// parse quota again to produce the same Markdown.
func TestReindexReembedsWithoutReparsing(t *testing.T) {
	parser := newFakeParser("gemini")
	h := newHarness(t, &fakeProviders{
		chain:    []knowledge.Parser{parser},
		embedder: newFakeEmbedder("embed-v1", 768),
	})
	ctx := context.Background()

	res, _ := h.svc.Upload(ctx, h.user, h.kb.ID, "rag.pdf", ragPDF(t))
	if err := h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{
		DocumentID: res.Document.ID, KBID: h.kb.ID,
	}, lastAttempt); err != nil {
		t.Fatalf("ProcessDocument: %v", err)
	}
	parseCallsBefore := len(parser.calls())
	before := h.chunks.get(res.Document.ID)

	// The user switches embedding route.
	newProviders := &fakeProviders{
		chain:    []knowledge.Parser{parser},
		embedder: newFakeEmbedder("embed-v2", 1536),
	}
	h.svc = knowledge.NewService(knowledge.Config{
		Store: h.store, Chunks: h.chunks, Blobs: h.blobs, Jobs: h.jobs,
		Providers: newProviders, Events: h.events,
	})

	if err := h.svc.ReindexKB(ctx, h.user, knowledge.ReindexJobPayload{KBID: h.kb.ID}); err != nil {
		t.Fatalf("ReindexKB: %v", err)
	}

	if len(parser.calls()) != parseCallsBefore {
		t.Fatalf("reindex made %d extra parse calls; it must not re-parse",
			len(parser.calls())-parseCallsBefore)
	}

	after := h.chunks.get(res.Document.ID)
	if len(after) != len(before) {
		t.Fatalf("chunk count changed %d -> %d across a reindex", len(before), len(after))
	}
	for i := range after {
		if after[i].Text != before[i].Text || after[i].PageStart != before[i].PageStart {
			t.Fatalf("chunk %d text or page changed across a reindex", i)
		}
		if after[i].Dims != 1536 {
			t.Fatalf("chunk %d still records dims %d after switching route", i, after[i].Dims)
		}
	}

	kb, _ := h.svc.GetKB(ctx, h.user, h.kb.ID)
	if kb.NeedsReembed {
		t.Fatal("a completed reindex must lift the query block")
	}
	if kb.EmbeddingModel != "embed-v2" || kb.Dims != 1536 {
		t.Fatalf("kb route = %q/%d after reindex", kb.EmbeddingModel, kb.Dims)
	}
}

// Changing the embed route must BLOCK queries until a reindex. Ranking vectors
// from one space against a query from another does not fail — it returns
// plausible, wrong answers.
func TestChangingTheEmbedRouteSetsNeedsReembed(t *testing.T) {
	h := newHarness(t, &fakeProviders{
		chain:    []knowledge.Parser{newFakeParser("gemini")},
		embedder: newFakeEmbedder("embed-v1", 768),
	})
	ctx := context.Background()

	res, _ := h.svc.Upload(ctx, h.user, h.kb.ID, "rag.pdf", ragPDF(t))
	if err := h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{
		DocumentID: res.Document.ID, KBID: h.kb.ID,
	}, lastAttempt); err != nil {
		t.Fatalf("ProcessDocument: %v", err)
	}
	if kb, _ := h.svc.GetKB(ctx, h.user, h.kb.ID); kb.NeedsReembed {
		t.Fatal("a freshly indexed KB must not need a reindex")
	}

	// A second document arrives on a different route.
	h.svc = knowledge.NewService(knowledge.Config{
		Store: h.store, Chunks: h.chunks, Blobs: h.blobs, Jobs: h.jobs,
		Providers: &fakeProviders{
			chain:    []knowledge.Parser{newFakeParser("gemini")},
			embedder: newFakeEmbedder("embed-v2", 1536),
		},
		Events: h.events,
	})
	res2, _ := h.svc.Upload(ctx, h.user, h.kb.ID, "concrete.pdf",
		mustRead(t, filepath.Join("..", "rag", "parse", "testdata", "concrete-ai-safety.pdf")))
	if err := h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{
		DocumentID: res2.Document.ID, KBID: h.kb.ID,
	}, lastAttempt); err != nil {
		t.Fatalf("ProcessDocument: %v", err)
	}

	kb, _ := h.svc.GetKB(ctx, h.user, h.kb.ID)
	if !kb.NeedsReembed {
		t.Fatal("changing the embed route must block queries until the whole KB is reindexed")
	}
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return b
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
