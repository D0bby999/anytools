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

// A spreadsheet passage carries its sheet's name, so a citation can say which
// sheet it is on. Only a workbook's passages do: a Markdown note with a
// "Sheet: ..." heading is not a spreadsheet.
func TestSearchNamesTheSheetOfASpreadsheetPassage(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()

	var userID uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO users (email, display_name) VALUES ($1, 'sheet') RETURNING id`,
		"sheet-"+uuid.NewString()+"@example.test").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID) })

	store := pg.NewKnowledgeStore(pool)
	chunks := pg.NewChunkStore(pool)
	kb, err := store.CreateKB(ctx, userID, "Sheets KB")
	if err != nil {
		t.Fatal(err)
	}
	vec := randomUnit(rand.New(rand.NewSource(19)), dimsA)

	put := func(n int, mime, heading, text string) {
		t.Helper()
		d := knowledgeDocument(userID, kb.ID, n)
		d.MIME, d.PageCount = mime, 2
		doc, err := store.CreateDocument(ctx, d)
		if err != nil {
			t.Fatal(err)
		}
		c := mkChunk(0, text, padToStorage(vec))
		c.HeadingPath, c.PageStart, c.PageEnd = heading, 2, 2
		if err := chunks.ReplaceDocumentChunks(ctx, userID, kb.ID, doc.ID, []knowledge.StoredChunk{c}); err != nil {
			t.Fatal(err)
		}
	}
	put(1, parse.MimeXLSX, "Sheet: Budget", "Budget rent quarterly amount")
	put(2, "text/markdown", "Sheet: Budget", "Budget rent quarterly amount in a note")

	hits, err := retrieve.New(pool).Search(ctx, retrieve.Query{
		UserID: userID, KBIDs: []uuid.UUID{kb.ID}, Text: "budget rent", Vector: vec, Dims: dimsA,
	})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, h := range hits {
		got[h.Title] = h.Sheet
	}
	if len(got) != 2 || got["Recall document 1"] != "Budget" || got["Recall document 2"] != "" {
		t.Fatalf("sheet by document = %v; want Budget for the workbook only", got)
	}
}
