package knowledge_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/knowledge"
)

// A parse that needs an original out of reach in the learner's Drive fails
// at once, with the reason as the document's error: another attempt would
// meet the same answer until the learner acts (drive-user-storage phase 3).
func TestAParseWhoseOriginalIsOutOfReachSaysWhy(t *testing.T) {
	for _, tc := range []struct {
		err    error
		reason blob.Reason
	}{
		{fmt.Errorf("drive: %w", blob.ErrReconnect), blob.ReasonReconnect},
		{fmt.Errorf("drive: %w", blob.ErrRemoved), blob.ReasonRemoved},
	} {
		h := newHarness(t, &fakeProviders{
			chain:    []knowledge.Parser{newFakeParser("gemini")},
			embedder: newFakeEmbedder("text-embedding-3-small", 1536),
		})
		ctx := context.Background()
		res, err := h.svc.Upload(ctx, h.user, h.kb.ID, "rag.pdf", ragPDF(t))
		if err != nil {
			t.Fatal(err)
		}
		h.blobs.getErr = tc.err
		err = h.svc.ProcessDocument(ctx, h.user,
			knowledge.ParseJobPayload{DocumentID: res.Document.ID, KBID: h.kb.ID},
			knowledge.Attempt{Number: 1, Max: 3})
		if !knowledge.IsTerminal(err) {
			t.Fatalf("%s: retried: %v", tc.reason.Code, err)
		}
		doc, _ := h.svc.GetDocument(ctx, h.user, res.Document.ID)
		if doc.Status != knowledge.StatusFailed || doc.Error != tc.reason.Message {
			t.Fatalf("%s: the document says %q (%s)", tc.reason.Code, doc.Error, doc.Status)
		}
	}
}
