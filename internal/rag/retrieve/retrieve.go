// Package retrieve runs hybrid search over a user's chunks.
//
// One SQL statement, two arms, reciprocal rank fusion. The shape and every
// number in it come from Spike D (reports/spike-stream-retrieval.md), measured
// against 50 000 chunks across 20 knowledge bases on pgvector 0.8.2:
//
//   - RRF k = 50, both arms plus the merge in ONE round trip: 20 rows, 4.92 ms.
//   - `to_tsvector('english', …)` + `websearch_to_tsquery('english', …)` +
//     `ts_rank_cd`. Against 'simple' over 20 morphological probes english won
//     14, simple won 0, 6 ties — and every tie was an irregular lemma Snowball
//     cannot fold, so english is never worse.
//   - `$1::halfvec(3072)`. Spike D could NOT reproduce the red-team claim that
//     `$1::vector` defeats the halfvec index: pg_cast makes vector→halfvec
//     implicit and no `halfvec <=> vector` operator exists, so the PARAMETER
//     gets cast down either way. The explicit cast is written because it says
//     what is happening and survives a future pgvector changing that cast, not
//     because the other one is broken.
//   - BOTH CTEs filter user_id (RT-3). Not the outer query: a WHERE on the
//     join would let another user's chunk consume one of the 50 slots an arm
//     has, silently degrading recall for the person who owns the data.
package retrieve

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/rag/embed"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// RRFK is the reciprocal-rank-fusion constant. Spike D ran the hybrid end to
// end at k = 50; the source system used 60. Lower k weights the top of each
// arm more heavily, which is what a 40-chunk knowledge base needs.
const RRFK = 50

// ArmLimit is how many rows each arm contributes before fusion.
const ArmLimit = 50

// DefaultLimit is how many fused rows come back.
const DefaultLimit = 20

// ErrNeedsReembed is returned when a KB's vectors no longer match its route.
var ErrNeedsReembed = errors.New("retrieve: knowledge base must be reindexed before it can be queried")

// Hit is one retrieved chunk.
type Hit struct {
	ChunkID     uuid.UUID `json:"chunk_id"`
	DocumentID  uuid.UUID `json:"document_id"`
	KBID        uuid.UUID `json:"kb_id"`
	Title       string    `json:"title"`
	HeadingPath string    `json:"heading_path"`
	PageStart   int       `json:"page_start"`
	PageEnd     int       `json:"page_end"`
	Text        string    `json:"text"`
	Score       float64   `json:"score"`
	FromText    bool      `json:"from_text"`
	FromVector  bool      `json:"from_vector"`
	// Seconds is where a video's cited page starts (documents.timeline), so a
	// citation can open the player there. Nil for everything but a timed video.
	Seconds *int `json:"seconds,omitempty"`
	// AITranscript marks a passage from a Gemini transcript, which can mishear.
	AITranscript bool `json:"ai_transcript,omitempty"`
	// Lines marks a passage of a repository's code file: PageStart and
	// PageEnd are its first and last lines (up-methods phase 18).
	Lines bool `json:"lines,omitempty"`
	// Sheet names a spreadsheet passage's sheet, so a citation can read
	// "Sheet: Budget, p. 2". It is the `## Sheet: <name>` heading the local
	// reader wrote (parse.localXLSXText), read only for a workbook: a Markdown
	// file with a heading that happens to say "Sheet:" is not a spreadsheet.
	Sheet string `json:"sheet,omitempty"`
	// PhotoModel is set for a passage read from a photo (up-methods phase
	// 16): the model that read it, so a citation can say "read by <model>
	// from a photo". It comes from the document's processed_by.
	PhotoModel string `json:"photo_model,omitempty"`
}

// Query is a retrieval request. The user id is separate from everything else on
// purpose: it is the one field a caller may never take from a tool argument.
type Query struct {
	UserID uuid.UUID
	KBIDs  []uuid.UUID
	Text   string
	// Vector is the query embedding at its NATIVE width. Padding happens here,
	// so a caller cannot forget it.
	Vector []float32
	// Dims is the native width, matched against chunks.dims so two embedding
	// spaces are never compared.
	Dims  int
	Limit int
}

// Retriever runs hybrid queries against Postgres.
type Retriever struct {
	pool *pgxpool.Pool
	// EFSearch and IterativeScan are the HNSW fallback knobs. Spike D found
	// the planner correctly prefers btree + exact sort at realistic KB sizes
	// and never touches HNSW there; these only matter once a single KB is
	// large enough for the per-KB partial index to win, and at ef_search >= 100
	// iterative scan costs 180-620 ms, so they are a fallback, not a default
	// speedup.
	EFSearch int
}

// New returns a Retriever.
func New(pool *pgxpool.Pool) *Retriever {
	return &Retriever{pool: pool, EFSearch: 100}
}

// hybridRRF is the statement. Spike D's shape, with user_id added to both arms
// and the document join that turns a chunk into a citation.
const hybridRRF = `
WITH fts AS (
    SELECT id,
           row_number() OVER (
               ORDER BY ts_rank_cd(tsv, websearch_to_tsquery('english', $3)) DESC, id
           ) AS rank
    FROM chunks
    WHERE user_id = $1
      AND kb_id = ANY($2)
      AND tsv @@ websearch_to_tsquery('english', $3)
    LIMIT $6
), semantic AS (
    SELECT id,
           row_number() OVER (ORDER BY embedding <=> $4::halfvec(3072)) AS rank
    FROM chunks
    WHERE user_id = $1
      AND kb_id = ANY($2)
      AND dims = $5
      AND embedding IS NOT NULL
    ORDER BY embedding <=> $4::halfvec(3072)
    LIMIT $6
)
SELECT c.id, c.document_id, c.kb_id, d.title, c.heading_path,
       c.page_start, c.page_end, c.text,
       COALESCE(1.0 / ($7 + fts.rank), 0.0) + COALESCE(1.0 / ($7 + semantic.rank), 0.0) AS score,
       fts.rank IS NOT NULL      AS from_text,
       semantic.rank IS NOT NULL AS from_vector,
       CASE WHEN d.source_kind IN ('youtube', 'media')
            THEN (d.timeline -> (c.page_start - 1) ->> 0)::int END AS seconds,
       COALESCE(d.transcript_source = 'ai_transcript', false) AS ai_transcript,
       d.page_unit = 'line' AS lines,
       CASE WHEN d.mime = $9 AND c.heading_path LIKE 'Sheet: %'
            THEN substr(c.heading_path, 8) ELSE '' END AS sheet,
       CASE WHEN d.mime = ANY($10)
            THEN COALESCE(d.processed_by ->> 'model', '') ELSE '' END AS photo_model
FROM fts
FULL OUTER JOIN semantic USING (id)
JOIN chunks    c ON c.id = COALESCE(fts.id, semantic.id) AND c.user_id = $1
JOIN documents d ON d.id = c.document_id AND d.user_id = $1
ORDER BY score DESC, c.id
LIMIT $8`

// Search runs the hybrid query.
//
// Ownership of every kb id in the query MUST already have been established by
// authz.OwnsAllKBs. The user_id filters below are defence in depth, not the
// check: they make a forgotten authorization call return nothing instead of
// someone else's documents, which is the difference between a bug and a breach.
func (r *Retriever) Search(ctx context.Context, q Query) ([]Hit, error) {
	if q.UserID == uuid.Nil {
		return nil, errors.New("retrieve: no user")
	}
	if len(q.KBIDs) == 0 {
		return nil, errors.New("retrieve: no knowledge base selected")
	}
	if err := embed.ValidateDims(q.Dims); err != nil {
		return nil, err
	}
	padded, err := embed.Pad(q.Vector)
	if err != nil {
		return nil, err
	}
	limit := q.Limit
	if limit <= 0 || limit > 100 {
		limit = DefaultLimit
	}

	// A transaction, because `SET LOCAL` is the only form of these settings
	// that cannot leak onto the next borrower of a pooled connection. A plain
	// SET on a pgxpool connection outlives the query and silently reconfigures
	// unrelated work.
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("retrieve: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // read-only; rollback is the close

	if _, err := tx.Exec(ctx, "SET LOCAL hnsw.iterative_scan = relaxed_order"); err != nil {
		return nil, fmt.Errorf("retrieve: set iterative_scan: %w", err)
	}
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL hnsw.ef_search = %d", clampEF(r.EFSearch))); err != nil {
		return nil, fmt.Errorf("retrieve: set ef_search: %w", err)
	}

	rows, err := tx.Query(ctx, hybridRRF,
		q.UserID, q.KBIDs, q.Text, embed.Literal(padded), q.Dims, ArmLimit, RRFK, limit, parse.MimeXLSX,
		parse.PhotoMIMEs())
	if err != nil {
		return nil, fmt.Errorf("retrieve: query: %w", err)
	}
	defer rows.Close()

	var hits []Hit
	for rows.Next() {
		var h Hit
		if err := rows.Scan(&h.ChunkID, &h.DocumentID, &h.KBID, &h.Title, &h.HeadingPath,
			&h.PageStart, &h.PageEnd, &h.Text, &h.Score, &h.FromText, &h.FromVector,
			&h.Seconds, &h.AITranscript, &h.Lines, &h.Sheet, &h.PhotoModel); err != nil {
			return nil, fmt.Errorf("retrieve: scan: %w", err)
		}
		hits = append(hits, h)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("retrieve: rows: %w", err)
	}
	return hits, nil
}

// VectorOnly runs just the semantic arm. It exists for the recall test, which
// has to measure the vector arm's behaviour without the text arm rescuing it.
func (r *Retriever) VectorOnly(ctx context.Context, q Query, k int) ([]uuid.UUID, error) {
	padded, err := embed.Pad(q.Vector)
	if err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `
        SELECT id FROM chunks
        WHERE user_id = $1 AND kb_id = ANY($2) AND dims = $3 AND embedding IS NOT NULL
        ORDER BY embedding <=> $4::halfvec(3072)
        LIMIT $5`, q.UserID, q.KBIDs, q.Dims, embed.Literal(padded), k)
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

// clampEF keeps ef_search inside pgvector's accepted range. The value is
// formatted into SQL because SET LOCAL does not take a bind parameter; clamping
// to an int range is what makes that safe.
func clampEF(n int) int {
	if n < 1 {
		return 100
	}
	if n > 1000 {
		return 1000
	}
	return n
}

// Nearest is the cosine similarity of the closest passage in one knowledge
// base to each vector, 0 when the base has none of that width
// (the private design notes, phase 4: is a proposed point in the
// learner's material at all). Exact, one query per vector, inside one
// read-only transaction; a plan has at most sixty points.
func (r *Retriever) Nearest(ctx context.Context, userID, kbID uuid.UUID, dims int, vectors [][]float32) ([]float64, error) {
	if userID == uuid.Nil || kbID == uuid.Nil {
		return nil, errors.New("retrieve: no user or knowledge base")
	}
	if err := embed.ValidateDims(dims); err != nil {
		return nil, err
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("retrieve: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // read-only; rollback is the close

	out := make([]float64, len(vectors))
	for i, v := range vectors {
		padded, err := embed.Pad(v)
		if err != nil {
			return nil, err
		}
		var sim *float64
		if err := tx.QueryRow(ctx, `
			SELECT 1 - (embedding <=> $4::halfvec(3072))
			  FROM chunks
			 WHERE user_id = $1 AND kb_id = $2 AND dims = $3 AND embedding IS NOT NULL
			 ORDER BY embedding <=> $4::halfvec(3072)
			 LIMIT 1`, userID, kbID, dims, embed.Literal(padded)).Scan(&sim); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("retrieve: nearest: %w", err)
		}
		if sim != nil {
			out[i] = *sim
		}
	}
	return out, nil
}
