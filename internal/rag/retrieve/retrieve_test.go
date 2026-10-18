package retrieve_test

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"math/rand"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/embed"
	"github.com/D0bby999/anytools/internal/rag/retrieve"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// The recall corpus, matched to Spike D's shape: 50 000 chunks across 20
// knowledge bases, two embedding widths, and one deliberately TINY knowledge
// base (40 rows, 0.08 % of the table). The small KB is the whole experiment —
// it is the case where a global HNSW measured recall 0.000 and the per-KB
// partial measured 1.000.
const (
	totalChunks = 50_000
	numKBs      = 20
	smallKBIdx  = 7
	smallKBRows = 40

	// Native embedding widths. Spike D used 1536 and 3072; this suite uses 256
	// and 384 for the same geometry at a fraction of the wire cost — every
	// vector is still stored zero-padded in halfvec(3072), which is the column
	// behaviour under test, and a 3072-wide literal for 50 000 rows is 1.1 GB
	// of COPY text for no additional coverage.
	dimsA = 256
	dimsB = 384
)

var (
	corpusOnce sync.Once
	corpus     *seededCorpus
	corpusErr  error
)

type seededCorpus struct {
	userID  uuid.UUID
	otherID uuid.UUID
	kbIDs   []uuid.UUID
	// smallKBChunks are the 40 chunk ids in the small knowledge base, which is
	// the ground truth the recall assertion is measured against.
	smallKBChunks []uuid.UUID
	centroids     [][]float32
}

// TestMain removes the corpus after the package's tests finish.
//
// Without it every `go test` run leaves 50 000 rows and 20 HNSW indexes behind
// for good: the seeder inserts its users directly, so no per-test cleanup
// covers them, and the next run seeds another 50 000 on top of the last. It is
// package-level rather than per-test because the corpus is built once and
// shared — see seedCorpus.
//
// Deleting the users is the whole teardown: everything below them cascades.
// The indexes are dropped explicitly, because they hang off `chunks` and
// survive their knowledge base being cascade-deleted from underneath them.
func TestMain(m *testing.M) {
	code := m.Run()
	cleanupCorpus()
	os.Exit(code)
}

func cleanupCorpus() {
	if corpus == nil {
		return
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testutil.TestDSN())
	if err != nil {
		return
	}
	defer pool.Close()

	for _, id := range []uuid.UUID{corpus.userID, corpus.otherID} {
		if id != uuid.Nil {
			_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
		}
	}

	// Drop every partial index whose knowledge base no longer exists.
	//
	// Not just this package's: an index lives on `chunks`, so deleting a user
	// cascades the knowledge_bases row away and leaves the index behind. In
	// production that path does not run — accounts are soft-deleted, and
	// DeleteKB drops the index explicitly — but a test that hard-deletes users
	// hits it every run, and 20 orphaned HNSW indexes per run is how the local
	// test database ends up slower than the code it is testing.
	_, _ = pool.Exec(ctx, `
        DO $$
        DECLARE r record; kb uuid;
        BEGIN
          FOR r IN SELECT relname FROM pg_class
                   WHERE relkind = 'i' AND relname LIKE 'chunks\_emb\_hnsw\_kb\_%' LOOP
            BEGIN
              kb := (substr(r.relname, 20, 8) || '-' || substr(r.relname, 28, 4) || '-' ||
                     substr(r.relname, 32, 4) || '-' || substr(r.relname, 36, 4) || '-' ||
                     substr(r.relname, 40, 12))::uuid;
            EXCEPTION WHEN others THEN
              CONTINUE;
            END;
            IF NOT EXISTS (SELECT 1 FROM knowledge_bases WHERE id = kb) THEN
              EXECUTE 'DROP INDEX IF EXISTS ' || quote_ident(r.relname);
            END IF;
          END LOOP;
        END $$;`)
}

// HeavyTestsEnv opts into the tests that seed the 50 000-chunk corpus.
const HeavyTestsEnv = "ANYTOOLS_HEAVY_TESTS"

// seedCorpus builds the corpus once for the whole package. Rebuilding it per
// test would dominate the suite's runtime and prove nothing extra.
func seedCorpus(t *testing.T, pool *pgxpool.Pool) *seededCorpus {
	t.Helper()
	// OPT-IN, because this corpus is expensive and the database is shared.
	//
	// Measured 2026-09-17: 227 s to seed 50 000 chunks across 20 knowledge
	// bases and build 20 HNSW indexes, holding writes on a database that three
	// other agents' suites were using at the same time. Left on by default it
	// is not a slow test, it is a four-minute stall in everybody else's
	// `go test ./...`.
	//
	// It still runs on every push: CI sets both CI=1 and ANYTOOLS_HEAVY_TESTS=1,
	// and the check below honours either, so the recall claim cannot be lost by
	// someone editing one of them out of the workflow. `-short` is honoured on
	// top of that for the developer who asked for a fast run explicitly.
	if testing.Short() {
		t.Skip("-short: skipping the 50k-chunk recall corpus")
	}
	if config.Getenv(HeavyTestsEnv) != "1" && !testutil.InCI() {
		t.Skipf("%s=1 not set: skipping the 50k-chunk recall corpus (~227 s on a shared database)", HeavyTestsEnv)
	}
	corpusOnce.Do(func() { corpus, corpusErr = buildCorpus(pool) })
	if corpusErr != nil {
		t.Fatalf("seed corpus: %v", corpusErr)
	}
	return corpus
}

func buildCorpus(pool *pgxpool.Pool) (*seededCorpus, error) {
	ctx := context.Background()
	rng := rand.New(rand.NewSource(20260916))

	c := &seededCorpus{}
	for _, target := range []*uuid.UUID{&c.userID, &c.otherID} {
		if err := pool.QueryRow(ctx,
			`INSERT INTO users (email, display_name) VALUES ($1, 'recall') RETURNING id`,
			"recall-"+uuid.NewString()+"@example.test").Scan(target); err != nil {
			return nil, err
		}
	}

	store := pg.NewKnowledgeStore(pool)
	for i := 0; i < numKBs; i++ {
		kb, err := store.CreateKB(ctx, c.userID, fmt.Sprintf("Recall KB %d", i))
		if err != nil {
			return nil, err
		}
		c.kbIDs = append(c.kbIDs, kb.ID)
		c.centroids = append(c.centroids, randomUnit(rng, dimsFor(i)))
	}

	// One document per KB to hang the chunks off.
	docIDs := make([]uuid.UUID, numKBs)
	for i, kbID := range c.kbIDs {
		doc, err := store.CreateDocument(ctx, knowledgeDocument(c.userID, kbID, i))
		if err != nil {
			return nil, err
		}
		docIDs[i] = doc.ID
	}

	// Row counts: the small KB gets exactly smallKBRows, the rest share the
	// remainder.
	counts := make([]int, numKBs)
	counts[smallKBIdx] = smallKBRows
	remaining := totalChunks - smallKBRows
	for i := range counts {
		if i == smallKBIdx {
			continue
		}
		counts[i] = remaining / (numKBs - 1)
	}
	counts[0] += remaining - (remaining/(numKBs-1))*(numKBs-1)

	// Drop the per-KB HNSW indexes for the duration of the load.
	//
	// Spike D's note, learned again the hard way here: "an HNSW index
	// maintained during a 50k-row COPY costs far more than one built once at
	// the end." With the 20 partial indexes live, this COPY was still running
	// after ten minutes; built afterwards they cost 0.04 s each. A production
	// bulk import would do the same thing, and a normal upload — a few hundred
	// rows into one KB — never hits this path at all.
	for _, kbID := range c.kbIDs {
		if err := pg.DropKBVectorIndex(ctx, pool, kbID); err != nil {
			return nil, fmt.Errorf("drop partial index before load: %w", err)
		}
	}

	// COPY from a pipe rather than one giant string: 50 000 rows of padded
	// halfvec literal is hundreds of megabytes, and buffering all of it before
	// sending any of it makes the seed cost memory it does not need to.
	pr, pw := io.Pipe()
	go func() {
		w := bufio.NewWriterSize(pw, 1<<20)
		ord := 0
		for kb := 0; kb < numKBs; kb++ {
			dims := dimsFor(kb)
			for n := 0; n < counts[kb]; n++ {
				id := uuid.New()
				if kb == smallKBIdx {
					c.smallKBChunks = append(c.smallKBChunks, id)
				}
				vec := nearCentroid(rng, c.centroids[kb], 0.30)
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%d\t%s\t%d\t%d\t%s\t",
					id, c.userID, c.kbIDs[kb], docIDs[kb], ord,
					"KB > Section", 1, 1, copyEscape(chunkText(rng, kb, n)))
				writePaddedLiteral(w, vec)
				fmt.Fprintf(w, "\t%d\n", dims)
				ord++
			}
		}
		_ = w.Flush()
		_ = pw.Close()
	}()

	conn, err := pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()

	_, err = conn.Conn().PgConn().CopyFrom(ctx, pr,
		`COPY chunks (id, user_id, kb_id, document_id, ord, heading_path,
		              page_start, page_end, text, embedding, dims) FROM STDIN`)
	if err != nil {
		return nil, fmt.Errorf("copy chunks: %w", err)
	}

	// Rebuild the partial indexes the way a KB gets one in production — through
	// the same function the store calls — so the recall assertion below is
	// measured against the real index definition and not a test-local one.
	for _, kbID := range c.kbIDs {
		if err := pg.CreateKBVectorIndex(ctx, pool, kbID); err != nil {
			return nil, fmt.Errorf("rebuild partial index after load: %w", err)
		}
	}

	// ANALYZE so the planner's choices below are made on real statistics rather
	// than on the defaults for an empty table.
	if _, err := pool.Exec(ctx, "ANALYZE chunks"); err != nil {
		return nil, err
	}
	return c, nil
}

func dimsFor(kb int) int {
	if kb%2 == 0 {
		return dimsA
	}
	return dimsB
}

// ── the recall test ────────────────────────────────────────────────────────

// The phase's named test. A 40-chunk knowledge base inside a 50 000-row table
// must return its own nearest neighbours in the VECTOR arm at k = 50.
//
// Spike D measured this shape failing catastrophically the obvious way: a
// single global HNSW post-filtered by kb_id returned 0 of 40. Only 18 of the
// exact global top-50 belonged to the small KB at all, so the index walk never
// reached the rows the filter wanted. The fix is the per-KB partial index —
// created with the KB, not in the migration — plus the btree that lets the
// planner choose an exact scan when the KB is small enough for that to be
// cheaper, which at this size it is.
func TestRecallForASmallKBInsideALargeTable(t *testing.T) {
	pool := testutil.TestDB(t)
	c := seedCorpus(t, pool)
	ctx := context.Background()

	r := retrieve.New(pool)
	query := nearCentroid(rand.New(rand.NewSource(99)), c.centroids[smallKBIdx], 0.30)
	smallKB := c.kbIDs[smallKBIdx]

	// Ground truth: an exact scan of the small KB alone.
	truth, err := exactTopK(ctx, pool, c.userID, smallKB, dimsFor(smallKBIdx), query, 50)
	if err != nil {
		t.Fatalf("ground truth: %v", err)
	}
	if len(truth) != smallKBRows {
		t.Fatalf("ground truth has %d rows, want %d", len(truth), smallKBRows)
	}

	got, err := r.VectorOnly(ctx, retrieve.Query{
		UserID: c.userID, KBIDs: []uuid.UUID{smallKB},
		Vector: query, Dims: dimsFor(smallKBIdx),
	}, 50)
	if err != nil {
		t.Fatalf("VectorOnly: %v", err)
	}

	inResult := map[uuid.UUID]bool{}
	for _, id := range got {
		inResult[id] = true
	}

	// The phase's assertion: the ground-truth top 5 all come back.
	for rank, id := range truth[:5] {
		if !inResult[id] {
			t.Fatalf("ground-truth rank %d (%s) is missing from the k=50 vector arm.\n"+
				"That is the recall cliff Spike D measured at 0.000 with a global HNSW index.",
				rank+1, id)
		}
	}

	// And, stronger: full recall over all 40, which is what the partial index
	// and the btree exact path both deliver.
	hits := 0
	for _, id := range truth {
		if inResult[id] {
			hits++
		}
	}
	recall := float64(hits) / float64(len(truth))
	if recall < 1.0 {
		t.Fatalf("recall@50 = %d/%d = %.3f, want 1.000", hits, len(truth), recall)
	}
	t.Logf("recall@50 = %d/%d = %.3f over %d rows in %d knowledge bases",
		hits, len(truth), recall, totalChunks, numKBs)
}

// The other half of RT-3: the query must be scoped by user_id, not only by
// kb_id. A caller that resolved the kb id correctly but the user id wrongly
// must get nothing.
func TestVectorArmIsScopedByUser(t *testing.T) {
	pool := testutil.TestDB(t)
	c := seedCorpus(t, pool)
	ctx := context.Background()

	r := retrieve.New(pool)
	query := nearCentroid(rand.New(rand.NewSource(99)), c.centroids[smallKBIdx], 0.30)

	got, err := r.VectorOnly(ctx, retrieve.Query{
		UserID: c.otherID, // the wrong user, the right KB
		KBIDs:  []uuid.UUID{c.kbIDs[smallKBIdx]},
		Vector: query, Dims: dimsFor(smallKBIdx),
	}, 50)
	if err != nil {
		t.Fatalf("VectorOnly: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("another user's query returned %d chunks", len(got))
	}
}

// Two embedding widths live in one column. Comparing across them would rank
// vectors from different spaces against each other, which produces plausible
// nonsense rather than an error.
func TestDimsFilterKeepsEmbeddingSpacesApart(t *testing.T) {
	pool := testutil.TestDB(t)
	c := seedCorpus(t, pool)
	ctx := context.Background()

	r := retrieve.New(pool)
	kb := c.kbIDs[smallKBIdx] // seeded at dimsFor(7) = 384
	query := nearCentroid(rand.New(rand.NewSource(99)), c.centroids[smallKBIdx], 0.30)

	// Asking with the OTHER width must match nothing in this KB.
	wrong := make([]float32, dimsA)
	copy(wrong, query)
	got, err := r.VectorOnly(ctx, retrieve.Query{
		UserID: c.userID, KBIDs: []uuid.UUID{kb}, Vector: wrong, Dims: dimsA,
	}, 50)
	if err != nil {
		t.Fatalf("VectorOnly: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("a query at %d dims matched %d chunks stored at %d dims",
			dimsA, len(got), dimsFor(smallKBIdx))
	}
}

// ── the hybrid statement ───────────────────────────────────────────────────

// RRF in ONE statement, both arms, with user_id on both CTEs.
func TestHybridSearchFusesBothArmsInOneStatement(t *testing.T) {
	pool := testutil.TestDB(t)
	c := seedCorpus(t, pool)
	ctx := context.Background()

	r := retrieve.New(pool)
	kb := c.kbIDs[smallKBIdx]
	query := nearCentroid(rand.New(rand.NewSource(99)), c.centroids[smallKBIdx], 0.30)

	hits, err := r.Search(ctx, retrieve.Query{
		UserID: c.userID, KBIDs: []uuid.UUID{kb},
		Text: "retrieval augmented generation", Vector: query, Dims: dimsFor(smallKBIdx),
	})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(hits) == 0 {
		t.Fatal("hybrid search returned nothing")
	}

	fromText, fromVector := 0, 0
	for _, h := range hits {
		if h.FromText {
			fromText++
		}
		if h.FromVector {
			fromVector++
		}
		if h.Score <= 0 {
			t.Fatalf("chunk %s has score %g", h.ChunkID, h.Score)
		}
		if h.KBID != kb {
			t.Fatalf("a hit from knowledge base %s leaked into a query for %s", h.KBID, kb)
		}
		if h.Title == "" {
			t.Fatal("a hit must carry its document title — a citation needs it")
		}
		if h.PageStart < 1 {
			t.Fatalf("a hit must carry a page: %+v", h)
		}
	}
	if fromVector == 0 {
		t.Fatal("the vector arm contributed nothing")
	}
	if fromText == 0 {
		t.Fatal("the full-text arm contributed nothing")
	}

	// Scores are non-increasing: RRF ordering is the whole point of fusing.
	for i := 1; i < len(hits); i++ {
		if hits[i].Score > hits[i-1].Score {
			t.Fatalf("hit %d scores higher than hit %d", i, i-1)
		}
	}
	t.Logf("%d fused hits: %d from text, %d from vector", len(hits), fromText, fromVector)
}

func TestHybridSearchIsScopedByUser(t *testing.T) {
	pool := testutil.TestDB(t)
	c := seedCorpus(t, pool)
	ctx := context.Background()

	hits, err := retrieve.New(pool).Search(ctx, retrieve.Query{
		UserID: c.otherID,
		KBIDs:  []uuid.UUID{c.kbIDs[smallKBIdx]},
		Text:   "retrieval augmented generation",
		Vector: nearCentroid(rand.New(rand.NewSource(99)), c.centroids[smallKBIdx], 0.30),
		Dims:   dimsFor(smallKBIdx),
	})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(hits) != 0 {
		t.Fatalf("another user's hybrid query returned %d hits", len(hits))
	}
}

// ── FTS morphology ─────────────────────────────────────────────────────────

// Spike D's dictionary comparison, as a test: 'english' stems, 'simple' does
// not, and the schema's generated tsv column is the english one. A query for
// "regulation" must find a passage that says "regulates".
func TestEnglishStemmingFindsAMorphologicalVariant(t *testing.T) {
	pool := testutil.TestDB(t)
	c := seedCorpus(t, pool)
	ctx := context.Background()

	store := pg.NewKnowledgeStore(pool)
	chunks := pg.NewChunkStore(pool)

	kb, err := store.CreateKB(ctx, c.userID, "Morphology KB")
	if err != nil {
		t.Fatalf("CreateKB: %v", err)
	}
	doc, err := store.CreateDocument(ctx, knowledgeDocument(c.userID, kb.ID, 999))
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}

	vec := padToStorage(randomUnit(rand.New(rand.NewSource(7)), dimsA))
	if err := chunks.ReplaceDocumentChunks(ctx, c.userID, kb.ID, doc.ID, []knowledgeChunk{
		mkChunk(0, "The enzyme regulates transcription of the operon.", vec),
		mkChunk(1, "Several proteins were tokenized and chunked for indexing.", vec),
		mkChunk(2, "Nothing here is about biology at all.", vec),
	}); err != nil {
		t.Fatalf("ReplaceDocumentChunks: %v", err)
	}

	cases := []struct {
		query     string
		wantMatch string
		reason    string
	}{
		{"regulation", "regulates", "regular lemma: 'english' folds regulation/regulates, 'simple' does not"},
		{"regulating", "regulates", "regular lemma, present participle"},
		{"tokenization", "tokenized", "Spike D measured english 7180 hits vs simple 1851 on this stem"},
		{"chunking", "chunked", "Spike D: english 7072 vs simple 1851"},
	}
	for _, tc := range cases {
		t.Run(tc.query, func(t *testing.T) {
			var text string
			err := pool.QueryRow(ctx, `
                SELECT text FROM chunks
                WHERE user_id = $1 AND kb_id = $2
                  AND tsv @@ websearch_to_tsquery('english', $3)
                LIMIT 1`, c.userID, kb.ID, tc.query).Scan(&text)
			if err != nil {
				t.Fatalf("%q matched nothing (%s): %v", tc.query, tc.reason, err)
			}
			if !strings.Contains(text, tc.wantMatch) {
				t.Fatalf("%q matched %q, want the passage containing %q", tc.query, text, tc.wantMatch)
			}
		})
	}

	// And the contrast that makes the choice measurable rather than a
	// preference: 'simple' finds nothing for the same query.
	var n int
	if err := pool.QueryRow(ctx, `
        SELECT count(*) FROM chunks
        WHERE user_id = $1 AND kb_id = $2
          AND to_tsvector('simple', text) @@ websearch_to_tsquery('simple', 'regulation')`,
		c.userID, kb.ID).Scan(&n); err != nil {
		t.Fatalf("simple probe: %v", err)
	}
	if n != 0 {
		t.Fatalf("'simple' matched %d rows for 'regulation'; the comparison this schema is built on no longer holds", n)
	}
}

// ── helpers ────────────────────────────────────────────────────────────────

func exactTopK(ctx context.Context, pool *pgxpool.Pool, userID, kbID uuid.UUID, dims int, query []float32, k int) ([]uuid.UUID, error) {
	padded, err := embed.Pad(query)
	if err != nil {
		return nil, err
	}
	// enable_indexscan off forces the exact answer, whatever index exists.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	for _, s := range []string{"SET LOCAL enable_indexscan = off", "SET LOCAL enable_bitmapscan = off"} {
		if _, err := tx.Exec(ctx, s); err != nil {
			return nil, err
		}
	}
	rows, err := tx.Query(ctx, `
        SELECT id FROM chunks
        WHERE user_id = $1 AND kb_id = $2 AND dims = $3
        ORDER BY embedding <=> $4::halfvec(3072)
        LIMIT $5`, userID, kbID, dims, embed.Literal(padded), k)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func randomUnit(rng *rand.Rand, dims int) []float32 {
	v := make([]float32, dims)
	var norm float64
	for i := range v {
		x := rng.NormFloat64()
		v[i] = float32(x)
		norm += x * x
	}
	inv := float32(1 / sqrt(norm))
	for i := range v {
		v[i] *= inv
	}
	return v
}

// nearCentroid places a point near a knowledge base's centre with alpha of the
// vector's weight on the centroid. Spike D used 0.30 deliberately: tighter
// clusters would make a post-filtered global index pass by accident.
func nearCentroid(rng *rand.Rand, centroid []float32, alpha float64) []float32 {
	v := make([]float32, len(centroid))
	var norm float64
	for i := range v {
		x := alpha*float64(centroid[i]) + (1-alpha)*rng.NormFloat64()
		v[i] = float32(x)
		norm += x * x
	}
	inv := float32(1 / sqrt(norm))
	for i := range v {
		v[i] *= inv
	}
	return v
}

func padToStorage(v []float32) []float32 {
	out, err := embed.Pad(v)
	if err != nil {
		panic(err)
	}
	return out
}

// zeroTails caches the ",0,0,…" suffix for each native width.
//
// Padding is zeros, and formatting 2 700 of them per row with strconv is what
// made the first version of this seed take over ten minutes. The suffix is
// identical for every row of a given width, so it is built once. The bytes on
// the wire are exactly what embed.Literal would have produced — asserted by
// TestPaddedLiteralMatchesEmbedLiteral below, so the shortcut cannot drift
// away from the thing it is standing in for.
var (
	zeroTailMu sync.Mutex
	zeroTails  = map[int]string{}
)

func zeroTail(nativeDims int) string {
	zeroTailMu.Lock()
	defer zeroTailMu.Unlock()
	if s, ok := zeroTails[nativeDims]; ok {
		return s
	}
	s := strings.Repeat(",0", embed.StorageDims-nativeDims)
	zeroTails[nativeDims] = s
	return s
}

func writePaddedLiteral(w *bufio.Writer, vec []float32) {
	w.WriteByte('[')
	for i, v := range vec {
		if i > 0 {
			w.WriteByte(',')
		}
		// 'f', matching pgvector-go's own EncodeText. 'g' switches to exponent
		// notation for small magnitudes, which TestPaddedLiteralMatchesEmbedLiteral
		// caught at 384 dims and not at 256 — exactly the silent drift that
		// guard exists to prevent.
		w.WriteString(strconv.FormatFloat(float64(v), 'f', -1, 32))
	}
	w.WriteString(zeroTail(len(vec)))
	w.WriteByte(']')
}

func sqrt(x float64) float64 {
	if x <= 0 {
		return 1
	}
	z := x
	for i := 0; i < 40; i++ {
		z = (z + x/z) / 2
	}
	return z
}

var filler = []string{
	"retrieval", "augmented", "generation", "passage", "index", "vector",
	"query", "document", "embedding", "semantic", "ranking", "hybrid",
	"knowledge", "context", "citation", "evidence", "corpus", "neighbour",
}

// chunkText deliberately avoids the words the morphology test probes, so that
// test measures the dictionary rather than this generator. Spike D's first run
// had exactly that bug and reported 50 000 hits for "chunked".
func chunkText(rng *rand.Rand, kb, n int) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Base %d item %d. ", kb, n)
	for i := 0; i < 24; i++ {
		sb.WriteString(filler[rng.Intn(len(filler))])
		sb.WriteByte(' ')
	}
	return sb.String()
}

// copyEscape escapes the characters COPY's text format treats specially.
func copyEscape(s string) string {
	r := strings.NewReplacer("\\", "\\\\", "\t", "\\t", "\n", "\\n", "\r", "\\r")
	return r.Replace(s)
}

// knowledgeChunk and mkChunk keep the morphology test readable.
type knowledgeChunk = knowledge.StoredChunk

func mkChunk(ord int, text string, vec []float32) knowledgeChunk {
	return knowledgeChunk{
		Ord: ord, HeadingPath: "Morphology", PageStart: 1, PageEnd: 1,
		Text: text, Embedding: vec, Dims: dimsA,
	}
}

// The seed's fast path must produce byte-for-byte what the production
// formatter produces, or the corpus it builds is not the corpus the code under
// test would have written.
func TestPaddedLiteralMatchesEmbedLiteral(t *testing.T) {
	for _, dims := range []int{dimsA, dimsB} {
		vec := randomUnit(rand.New(rand.NewSource(int64(dims))), dims)

		var buf bytes.Buffer
		w := bufio.NewWriter(&buf)
		writePaddedLiteral(w, vec)
		_ = w.Flush()

		want := embed.Literal(padToStorage(vec))
		if buf.String() != want {
			t.Fatalf("dims=%d: the seed's literal differs from embed.Literal", dims)
		}
	}
}

func knowledgeDocument(userID, kbID uuid.UUID, n int) knowledge.Document {
	return knowledge.Document{
		UserID: userID, KBID: kbID, SourceKind: knowledge.SourceUpload,
		Title: fmt.Sprintf("Recall document %d", n),
		MIME:  "application/pdf", Bytes: 1,
		SHA256: fmt.Sprintf("%064x", uuid.New().ID())[:64], PageCount: 1,
	}
}
