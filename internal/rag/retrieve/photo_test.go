package retrieve_test

import (
	"context"
	"math/rand"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/rag/retrieve"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// A passage read from a photo names the model that read it, so a citation
// can say "read by <model> from a photo" (up-methods phase 16). A PDF the
// same model read is not a photo and says nothing of the kind.
func TestSearchNamesTheModelThatReadAPhoto(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()

	var userID uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO users (email, display_name) VALUES ($1, 'photo') RETURNING id`,
		"photo-"+uuid.NewString()+"@example.test").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID) })

	store := pg.NewKnowledgeStore(pool)
	chunks := pg.NewChunkStore(pool)
	kb, err := store.CreateKB(ctx, userID, "Photos KB")
	if err != nil {
		t.Fatal(err)
	}
	vec := randomUnit(rand.New(rand.NewSource(23)), dimsA)

	put := func(n int, mime string) {
		t.Helper()
		d := knowledgeDocument(userID, kb.ID, n)
		d.MIME, d.PageCount = mime, 2
		doc, err := store.CreateDocument(ctx, d)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE documents SET processed_by = '{"parser":"gemini","model":"gemini-3.6-flash"}'
			WHERE id = $1`, doc.ID); err != nil {
			t.Fatal(err)
		}
		c := mkChunk(0, "Photosynthesis needs light and water", padToStorage(vec))
		c.PageStart, c.PageEnd = 2, 2
		if err := chunks.ReplaceDocumentChunks(ctx, userID, kb.ID, doc.ID, []knowledge.StoredChunk{c}); err != nil {
			t.Fatal(err)
		}
	}
	put(1, parse.MimePhotoSet)
	put(2, "image/jpeg")
	put(3, "application/pdf")

	hits, err := retrieve.New(pool).Search(ctx, retrieve.Query{
		UserID: userID, KBIDs: []uuid.UUID{kb.ID}, Text: "photosynthesis light", Vector: vec, Dims: dimsA,
	})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, h := range hits {
		got[h.Title] = h.PhotoModel
	}
	if len(got) != 3 || got["Recall document 1"] != "gemini-3.6-flash" || got["Recall document 2"] != "gemini-3.6-flash" ||
		got["Recall document 3"] != "" {
		t.Fatalf("photo model by document = %v; want it for the two photo documents only", got)
	}
}
