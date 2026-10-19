package pg

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/embed"
	"github.com/D0bby999/anytools/internal/store/kbindex"
)

// ChunkStore writes and deletes chunks.
type ChunkStore struct{ pool *Pool }

// NewChunkStore returns a ChunkStore.
func NewChunkStore(pool *Pool) *ChunkStore { return &ChunkStore{pool: pool} }

// kbIndexName is the per-KB partial HNSW index's name.
//
// The uuid's hyphens are stripped so the identifier is 51 characters, inside
// Postgres's 63-byte limit. Every character comes from a parsed uuid.UUID's
// canonical rendering — hex and hyphens — so this cannot become an injection
// vector no matter what a caller passes: a value that is not a uuid never gets
// this far.
func kbIndexName(kbID uuid.UUID) string { return kbindex.Name(kbID) }

// CreateKBVectorIndex builds the partial HNSW index for one knowledge base.
//
// This is the single most consequential line Spike D produced. The obvious
// design — one HNSW over `chunks`, filtered by kb_id at query time — measured
// recall 0/40 = 0.000 for a 40-row KB inside 50 000 rows, because the index
// walk finds the global nearest neighbours and every one of them belongs to
// somebody else's knowledge base. The partial index measured 1.000 at 1.29 ms
// and built in 0.04 s against 214 s for the global one.
//
// pgx does not parameterise DDL, so the identifier is interpolated; see
// kbIndexName for why that is safe here.
func CreateKBVectorIndex(ctx context.Context, pool *Pool, kbID uuid.UUID) error {
	name := pgx.Identifier{kbIndexName(kbID)}.Sanitize()
	sql := fmt.Sprintf(`CREATE INDEX IF NOT EXISTS %s ON chunks
        USING hnsw (embedding halfvec_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        WHERE kb_id = '%s'`, name, kbID.String())
	if _, err := pool.Exec(ctx, sql); err != nil {
		return fmt.Errorf("pg: create partial hnsw for kb %s: %w", kbID, err)
	}
	return nil
}

// DropKBVectorIndex removes a KB's partial index.
func DropKBVectorIndex(ctx context.Context, pool *Pool, kbID uuid.UUID) error {
	name := pgx.Identifier{kbIndexName(kbID)}.Sanitize()
	_, err := pool.Exec(ctx, "DROP INDEX IF EXISTS "+name)
	return err
}

// HasKBVectorIndex reports whether the partial index exists, for tests and
// diagnostics.
func HasKBVectorIndex(ctx context.Context, pool *Pool, kbID uuid.UUID) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = $1)`,
		kbIndexName(kbID)).Scan(&exists)
	return exists, err
}

// ReplaceDocumentChunks swaps a document's chunks for a new set atomically.
//
// Delete-then-insert in ONE transaction, because the alternative — delete,
// commit, insert — leaves a window in which the document is `ready` and
// retrieves nothing. A re-parse would silently un-answer questions that worked
// a second ago.
func (s *ChunkStore) ReplaceDocumentChunks(ctx context.Context, userID, kbID, docID uuid.UUID, chunks []knowledge.StoredChunk) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("pg: chunks begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx,
		`DELETE FROM chunks WHERE document_id = $1 AND user_id = $2`, docID, userID); err != nil {
		return fmt.Errorf("pg: delete old chunks: %w", err)
	}

	for _, c := range chunks {
		if err := embed.ValidateDims(c.Dims); err != nil {
			return err
		}
		if len(c.Embedding) != embed.StorageDims {
			return fmt.Errorf("pg: chunk %d embedding is %d wide, column is %d — pad before writing",
				c.Ord, len(c.Embedding), embed.StorageDims)
		}
		if _, err := tx.Exec(ctx, `
            INSERT INTO chunks (user_id, kb_id, document_id, ord, heading_path,
                                page_start, page_end, text, embedding, dims)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::halfvec(3072), $10)`,
			userID, kbID, docID, c.Ord, c.HeadingPath, c.PageStart, c.PageEnd, c.Text,
			embed.Literal(c.Embedding), c.Dims); err != nil {
			return fmt.Errorf("pg: insert chunk %d: %w", c.Ord, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("pg: chunks commit: %w", err)
	}
	return nil
}

// DeleteDocumentChunks removes every chunk of a document.
func (s *ChunkStore) DeleteDocumentChunks(ctx context.Context, userID, docID uuid.UUID) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM chunks WHERE document_id = $1 AND user_id = $2`, docID, userID)
	return err
}

// CountChunks counts a KB's chunks.
func (s *ChunkStore) CountChunks(ctx context.Context, userID, kbID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM chunks WHERE user_id = $1 AND kb_id = $2`, userID, kbID).Scan(&n)
	return n, err
}

// ChunkTexts returns a document's chunk texts in order, for a reindex that must
// re-embed without re-parsing.
func (s *ChunkStore) ChunkTexts(ctx context.Context, userID, docID uuid.UUID) ([]knowledge.StoredChunk, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT ord, heading_path, page_start, page_end, text
        FROM chunks WHERE user_id = $1 AND document_id = $2
        ORDER BY ord`, userID, docID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []knowledge.StoredChunk
	for rows.Next() {
		var c knowledge.StoredChunk
		if err := rows.Scan(&c.Ord, &c.HeadingPath, &c.PageStart, &c.PageEnd, &c.Text); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
