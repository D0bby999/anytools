package knowledge_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// Security audit F-5: deleting a document deletes its uploaded bytes too —
// unless another document of the same user is the same file.
func TestDeletingADocumentRemovesItsOriginalUnlessShared(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, &fakeProviders{})
	other, err := h.svc.CreateKB(ctx, h.user, "Other KB")
	if err != nil {
		t.Fatal(err)
	}
	pdf := ragPDF(t)
	first, err := h.svc.Upload(ctx, h.user, h.kb.ID, "rag.pdf", pdf)
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	second, err := h.svc.Upload(ctx, h.user, other.ID, "rag.pdf", pdf)
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	digest := first.Document.SHA256

	if err := h.svc.DeleteDocument(ctx, h.user, h.kb.ID, first.Document.ID); err != nil {
		t.Fatalf("DeleteDocument: %v", err)
	}
	if _, err := h.blobs.GetOriginal(ctx, h.user, digest); err != nil {
		t.Fatal("the original was deleted while another document still uses it")
	}

	if err := h.svc.DeleteKB(ctx, h.user, other.ID); err != nil {
		t.Fatalf("DeleteKB: %v", err)
	}
	if _, err := h.blobs.GetOriginal(ctx, h.user, digest); err == nil {
		t.Fatalf("the original outlived the last document that named it (doc %s)", second.Document.ID)
	}
}

// fakeCleaner records the cleaner calls and can fail them.
type fakeCleaner struct {
	docs, kbs []uuid.UUID
	fail      bool
}

func (c *fakeCleaner) DeleteDocumentRecordings(_ context.Context, _, doc uuid.UUID) error {
	if c.fail {
		return errors.New("read-only file system")
	}
	c.docs = append(c.docs, doc)
	return nil
}

func (c *fakeCleaner) DeleteKBRecordings(_ context.Context, _, kb uuid.UUID) error {
	if c.fail {
		return errors.New("read-only file system")
	}
	c.kbs = append(c.kbs, kb)
	return nil
}

// Up-methods phase 7: a worksheet attached to a document holds recordings,
// and the document's delete cascades to them; their files go first, and a
// file that cannot be deleted fails the delete with the document kept.
func TestDeletingADocumentOrAKnowledgeBaseCleansItsRecordingsFirst(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, &fakeProviders{})
	cleaner := &fakeCleaner{fail: true}
	h.svc.SetRecordingCleaner(cleaner)
	up, err := h.svc.Upload(ctx, h.user, h.kb.ID, "rag.pdf", ragPDF(t))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	doc := up.Document.ID

	if err := h.svc.DeleteDocument(ctx, h.user, h.kb.ID, doc); err == nil {
		t.Fatal("a document whose recordings could not be deleted was deleted")
	}
	if _, err := h.svc.GetDocument(ctx, h.user, doc); err != nil {
		t.Fatalf("the document went anyway: %v", err)
	}
	if err := h.svc.DeleteKB(ctx, h.user, h.kb.ID); err == nil {
		t.Fatal("a knowledge base whose recordings could not be deleted was deleted")
	}
	if _, err := h.svc.GetKB(ctx, h.user, h.kb.ID); err != nil {
		t.Fatalf("the knowledge base went anyway: %v", err)
	}

	cleaner.fail = false
	if err := h.svc.DeleteDocument(ctx, h.user, h.kb.ID, doc); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.DeleteKB(ctx, h.user, h.kb.ID); err != nil {
		t.Fatal(err)
	}
	if len(cleaner.docs) != 1 || cleaner.docs[0] != doc || len(cleaner.kbs) != 1 || cleaner.kbs[0] != h.kb.ID {
		t.Fatalf("cleaner calls: documents %v, knowledge bases %v", cleaner.docs, cleaner.kbs)
	}
}
