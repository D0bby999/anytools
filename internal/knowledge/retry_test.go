package knowledge_test

import (
	"context"
	"errors"
	"testing"

	"github.com/D0bby999/anytools/internal/knowledge"
)

// A RETRYABLE failure must leave the document in a state the next attempt can
// actually work from.
//
// This is the regression the terminal-state guard introduced and the test suite
// missed, because every failure test ran ProcessDocument exactly ONCE. Writing
// `failed` for a transient embed blip and then refusing to move out of a
// terminal state meant attempts 2 and 3 returned immediately without doing any
// work, the job was marked `done`, and a 503 that cleared a second later killed
// the document permanently. max_attempts bought nothing.
func TestARetryableFailureCanActuallyBeRetried(t *testing.T) {
	embedder := newFakeEmbedder("embed-1", 768)
	embedder.failWith = errors.New("503 upstream blip")
	h := newHarness(t, &fakeProviders{
		chain:    []knowledge.Parser{newFakeParser("gemini")},
		embedder: embedder,
	})
	ctx := context.Background()

	res, err := h.svc.Upload(ctx, h.user, h.kb.ID, "rag.pdf", ragPDF(t))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	payload := knowledge.ParseJobPayload{DocumentID: res.Document.ID, KBID: h.kb.ID}
	attempt1 := knowledge.Attempt{Number: 1, Max: 3}

	if err := h.svc.ProcessDocument(ctx, h.user, payload, attempt1); err == nil {
		t.Fatal("attempt 1 should have reported the upstream failure")
	} else if knowledge.IsTerminal(err) {
		t.Fatalf("a 503 is not terminal: %v", err)
	}

	// While attempts remain the document must NOT be terminal, or the next one
	// cannot move it.
	doc, _ := h.svc.GetDocument(ctx, h.user, res.Document.ID)
	if doc.Status == knowledge.StatusFailed {
		t.Fatal("a document with attempts left must not be marked failed — nothing could revive it")
	}

	// The blip clears; attempt 2 must re-run the work for real.
	embedder.failWith = nil
	if err := h.svc.ProcessDocument(ctx, h.user, payload,
		knowledge.Attempt{Number: 2, Max: 3}); err != nil {
		t.Fatalf("attempt 2 must re-run the work: %v", err)
	}

	doc, _ = h.svc.GetDocument(ctx, h.user, res.Document.ID)
	if doc.Status != knowledge.StatusReady {
		t.Fatalf("after a successful retry the document is %q (%s), want ready", doc.Status, doc.Error)
	}
	if len(h.chunks.get(doc.ID)) == 0 {
		t.Fatal("the retry reported success without storing any passages")
	}
}

// The LAST attempt is the one that settles the document.
func TestTheFinalAttemptFailsTheDocument(t *testing.T) {
	embedder := newFakeEmbedder("embed-1", 768)
	embedder.failWith = errors.New("503 upstream blip")
	h := newHarness(t, &fakeProviders{
		chain:    []knowledge.Parser{newFakeParser("gemini")},
		embedder: embedder,
	})
	ctx := context.Background()

	res, err := h.svc.Upload(ctx, h.user, h.kb.ID, "rag.pdf", ragPDF(t))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	payload := knowledge.ParseJobPayload{DocumentID: res.Document.ID, KBID: h.kb.ID}

	for attempt := 1; attempt <= 3; attempt++ {
		if err := h.svc.ProcessDocument(ctx, h.user, payload,
			knowledge.Attempt{Number: attempt, Max: 3}); err == nil {
			t.Fatalf("attempt %d should have failed", attempt)
		}
		doc, _ := h.svc.GetDocument(ctx, h.user, res.Document.ID)
		if attempt < 3 && doc.Status == knowledge.StatusFailed {
			t.Fatalf("attempt %d of 3 marked the document failed with retries still to come", attempt)
		}
		if attempt == 3 && doc.Status != knowledge.StatusFailed {
			t.Fatalf("the last attempt left the document %q — nothing will ever finish it", doc.Status)
		}
	}

	doc, _ := h.svc.GetDocument(ctx, h.user, res.Document.ID)
	if doc.Error == "" {
		t.Fatal("a failed document must say why")
	}
}

// A terminal cause must not burn the remaining attempts on a foregone
// conclusion.
func TestATerminalCauseFailsOnTheFirstAttempt(t *testing.T) {
	h := newHarness(t, &fakeProviders{
		chain:    []knowledge.Parser{newFakeParser("gemini")},
		embedErr: errors.New("no embedding route configured"),
	})
	ctx := context.Background()

	res, err := h.svc.Upload(ctx, h.user, h.kb.ID, "rag.pdf", ragPDF(t))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	err = h.svc.ProcessDocument(ctx, h.user,
		knowledge.ParseJobPayload{DocumentID: res.Document.ID, KBID: h.kb.ID},
		knowledge.Attempt{Number: 1, Max: 3})
	if !knowledge.IsTerminal(err) {
		t.Fatalf("a missing embed route will not fix itself on a retry: %v", err)
	}

	doc, _ := h.svc.GetDocument(ctx, h.user, res.Document.ID)
	if doc.Status != knowledge.StatusFailed {
		t.Fatalf("status = %q, want failed on the first attempt", doc.Status)
	}
}
