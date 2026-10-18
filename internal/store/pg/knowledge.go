package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/knowledge"
)

// KnowledgeStore persists knowledge bases and documents.
//
// EVERY statement in this file carries `user_id = $n`, including the ones whose
// primary key already identifies the row uniquely. That is not belt and braces:
// red-team RT-3 found the source system's retrieval SQL had lost exactly that
// filter, and a WHERE clause that is present in fifteen statements and absent
// in the sixteenth is invisible in review. Here the rule is mechanical, so its
// absence is the thing that looks wrong.
type KnowledgeStore struct{ pool *Pool }

// NewKnowledgeStore returns a KnowledgeStore.
func NewKnowledgeStore(pool *Pool) *KnowledgeStore { return &KnowledgeStore{pool: pool} }

// ─────────────────────────────────────────────────────── authz.Lookup

// KBOwner implements authz.Lookup.
func (s *KnowledgeStore) KBOwner(ctx context.Context, kbID uuid.UUID) (uuid.UUID, error) {
	var owner uuid.UUID
	err := s.pool.QueryRow(ctx, `SELECT user_id FROM knowledge_bases WHERE id = $1`, kbID).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, authz.ErrNoAccess
	}
	if err != nil {
		return uuid.Nil, err
	}
	return owner, nil
}

// DocumentOwner implements authz.Lookup.
func (s *KnowledgeStore) DocumentOwner(ctx context.Context, docID uuid.UUID) (uuid.UUID, uuid.UUID, error) {
	var owner, kbID uuid.UUID
	err := s.pool.QueryRow(ctx, `SELECT user_id, kb_id FROM documents WHERE id = $1`, docID).Scan(&owner, &kbID)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, uuid.Nil, authz.ErrNoAccess
	}
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	return owner, kbID, nil
}

// ───────────────────────────────────────────────────── knowledge bases

// CreateKB inserts a knowledge base and its per-KB vector index.
//
// The index is created in the same call because Spike D made it a property of
// the KB rather than of the table: one global HNSW post-filtered by kb_id
// returned recall 0.000 for a small KB, while the per-KB partial returned 1.000
// and built in 0.04 s. Creating it here means it exists before the first chunk
// does, which is also when building it is free.
func (s *KnowledgeStore) CreateKB(ctx context.Context, userID uuid.UUID, name string) (*knowledge.KB, error) {
	var kb knowledge.KB
	err := s.pool.QueryRow(ctx, `
        INSERT INTO knowledge_bases (user_id, name)
        VALUES ($1, $2)
        RETURNING id, user_id, name, embedding_model, dims, fts_config, needs_reembed, created_at, updated_at`,
		userID, name).
		Scan(&kb.ID, &kb.UserID, &kb.Name, &kb.EmbeddingModel, &kb.Dims, &kb.FTSConfig,
			&kb.NeedsReembed, &kb.CreatedAt, &kb.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("pg: create kb: %w", err)
	}
	if err := CreateKBVectorIndex(ctx, s.pool, kb.ID); err != nil {
		// Leave the KB: it is usable, just without its partial index, and the
		// exact-scan path is correct (Spike D row B: recall 1.000 at 7.97 ms).
		// Deleting a KB the user just created because an index failed would be
		// the worse outcome.
		return &kb, fmt.Errorf("pg: create kb vector index: %w", err)
	}
	return &kb, nil
}

// ListKBs returns the user's knowledge bases with their document counts.
func (s *KnowledgeStore) ListKBs(ctx context.Context, userID uuid.UUID) ([]knowledge.KBSummary, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT k.id, k.user_id, k.name, k.embedding_model, k.dims, k.fts_config,
               k.needs_reembed, k.created_at, k.updated_at,
               count(d.id)                                              AS documents,
               count(d.id) FILTER (WHERE d.status = 'ready')            AS ready,
               count(d.id) FILTER (WHERE d.status = 'failed')           AS failed,
               count(d.id) FILTER (WHERE d.status IN ('queued','parsing','indexing')) AS working
        FROM knowledge_bases k
        LEFT JOIN documents d ON d.kb_id = k.id AND d.user_id = k.user_id
        WHERE k.user_id = $1
        GROUP BY k.id
        ORDER BY k.created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("pg: list kbs: %w", err)
	}
	defer rows.Close()

	var out []knowledge.KBSummary
	for rows.Next() {
		var s knowledge.KBSummary
		if err := rows.Scan(&s.KB.ID, &s.KB.UserID, &s.KB.Name, &s.KB.EmbeddingModel, &s.KB.Dims,
			&s.KB.FTSConfig, &s.KB.NeedsReembed, &s.KB.CreatedAt, &s.KB.UpdatedAt,
			&s.Documents, &s.Ready, &s.Failed, &s.Working); err != nil {
			return nil, fmt.Errorf("pg: scan kb: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetKB reads one knowledge base the user owns.
func (s *KnowledgeStore) GetKB(ctx context.Context, userID, kbID uuid.UUID) (*knowledge.KB, error) {
	var kb knowledge.KB
	err := s.pool.QueryRow(ctx, `
        SELECT id, user_id, name, embedding_model, dims, fts_config, needs_reembed, created_at, updated_at
        FROM knowledge_bases WHERE id = $1 AND user_id = $2`, kbID, userID).
		Scan(&kb.ID, &kb.UserID, &kb.Name, &kb.EmbeddingModel, &kb.Dims, &kb.FTSConfig,
			&kb.NeedsReembed, &kb.CreatedAt, &kb.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, authz.ErrNoAccess
	}
	if err != nil {
		return nil, fmt.Errorf("pg: get kb: %w", err)
	}
	return &kb, nil
}

// DeleteKB removes a knowledge base and everything under it.
func (s *KnowledgeStore) DeleteKB(ctx context.Context, userID, kbID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1 AND user_id = $2`, kbID, userID)
	if err != nil {
		return fmt.Errorf("pg: delete kb: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return authz.ErrNoAccess
	}
	// Best effort: the rows are gone, so a leftover empty partial index is a
	// housekeeping item, not a correctness problem.
	_ = DropKBVectorIndex(ctx, s.pool, kbID)
	return nil
}

// PinEmbeddingRoute records the embedding model and width a KB is indexed with.
//
// Changing either sets needs_reembed, which blocks queries until a reindex.
// Ranking vectors from one embedding space against a query from another does
// not fail — it returns plausible, wrong answers — so the block is the only way
// the user finds out.
func (s *KnowledgeStore) PinEmbeddingRoute(ctx context.Context, userID, kbID uuid.UUID, model string, dims int) error {
	tag, err := s.pool.Exec(ctx, `
        UPDATE knowledge_bases SET
            embedding_model = $3,
            dims            = $4,
            needs_reembed   = (embedding_model <> '' AND (embedding_model <> $3 OR dims <> $4))
                              OR needs_reembed,
            updated_at      = now()
        WHERE id = $1 AND user_id = $2`, kbID, userID, model, dims)
	if err != nil {
		return fmt.Errorf("pg: pin embedding route: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return authz.ErrNoAccess
	}
	return nil
}

// ClearNeedsReembed lifts the query block after a successful reindex.
func (s *KnowledgeStore) ClearNeedsReembed(ctx context.Context, userID, kbID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
        UPDATE knowledge_bases SET needs_reembed = false, updated_at = now()
        WHERE id = $1 AND user_id = $2`, kbID, userID)
	return err
}

// ─────────────────────────────────────────────────────────── documents

// CreateDocument inserts a queued document.
func (s *KnowledgeStore) CreateDocument(ctx context.Context, d knowledge.Document) (*knowledge.Document, error) {
	var out scannedDocument
	err := s.pool.QueryRow(ctx, `
        INSERT INTO documents (user_id, kb_id, source_kind, title, mime, bytes, sha256, page_count, status, zotero_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', $9)
        RETURNING `+documentColumns(""),
		d.UserID, d.KBID, d.SourceKind, d.Title, d.MIME, d.Bytes, d.SHA256, d.PageCount, nullableText(d.ZoteroKey)).
		Scan(documentTargets(&out)...)
	if err == nil {
		err = out.decodeLinkFields()
	}
	if err != nil {
		return nil, fmt.Errorf("pg: create document: %w", err)
	}
	return &out.Document, nil
}

// ZoteroItemAdded reports whether the knowledge base already holds a
// document added from this Zotero item (up-methods phase 20). The unique
// index documents_kb_zotero_unique is what refuses a copy that races past
// this check.
func (s *KnowledgeStore) ZoteroItemAdded(ctx context.Context, userID, kbID uuid.UUID, itemKey string) (bool, error) {
	var found bool
	err := s.pool.QueryRow(ctx, `
        SELECT EXISTS (SELECT 1 FROM documents WHERE user_id = $1 AND kb_id = $2 AND zotero_key = $3)`,
		userID, kbID, itemKey).Scan(&found)
	if err != nil {
		return false, fmt.Errorf("pg: zotero item added: %w", err)
	}
	return found, nil
}

// ListDocuments returns a KB's documents, newest first.
//
// This is the polling endpoint's query and the stand-in for the SSE stream
// phase 6 adds. It is scoped by BOTH user_id and kb_id: a caller that resolved
// the kb id correctly but the user id wrongly still gets nothing.
func (s *KnowledgeStore) ListDocuments(ctx context.Context, userID, kbID uuid.UUID) ([]knowledge.Document, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT `+documentColumns("d.")+`,
               (SELECT count(*) FROM chunks c WHERE c.document_id = d.id AND c.user_id = d.user_id)
        FROM documents d
        WHERE d.user_id = $1 AND d.kb_id = $2
        ORDER BY d.created_at DESC`, userID, kbID)
	if err != nil {
		return nil, fmt.Errorf("pg: list documents: %w", err)
	}
	defer rows.Close()

	var out []knowledge.Document
	for rows.Next() {
		var d scannedDocument
		if err := rows.Scan(append(documentTargets(&d), &d.ChunkCount)...); err != nil {
			return nil, fmt.Errorf("pg: scan document: %w", err)
		}
		if err := d.decodeLinkFields(); err != nil {
			return nil, err
		}
		out = append(out, d.Document)
	}
	return out, rows.Err()
}

// GetDocument reads one document the user owns.
func (s *KnowledgeStore) GetDocument(ctx context.Context, userID, docID uuid.UUID) (*knowledge.Document, error) {
	var d scannedDocument
	err := s.pool.QueryRow(ctx, `
        SELECT `+documentColumns("")+`
        FROM documents WHERE id = $1 AND user_id = $2`, docID, userID).
		Scan(documentTargets(&d)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, authz.ErrNoAccess
	}
	if err != nil {
		return nil, fmt.Errorf("pg: get document: %w", err)
	}
	if err := d.decodeLinkFields(); err != nil {
		return nil, err
	}
	return &d.Document, nil
}

// SetDocumentStatus moves a document through its lifecycle.
//
// `error` is set only on the failed path and cleared on every other, which is
// what keeps the documents_failed_has_error constraint satisfiable and stops a
// stale message from a previous attempt being shown next to a ready document.
//
// A document that has REACHED a terminal state does not leave it through this
// method — in EITHER direction. That guard closes a window the lease machinery
// opens: the reaper takes a job back when its lease expires, but the worker
// that held it only finds out at its next heartbeat, up to a third of a lease
// later. In between, that worker is a zombie running with a live context, and
// it can write anything.
//
// Both directions matter, and the second was missed on the first attempt at
// this guard:
//
//   - A late `parsing` over the reaper's `failed` leaves a document working
//     with nothing running — the stuck document, arriving through the
//     subsystem built to prevent it.
//   - A late `failed` over another worker's `ready` un-publishes a document
//     that is indexed and retrievable, and the chunks in the table belong to
//     the worker that actually won.
//
// The only sanctioned way out of a terminal state is
// ResetDocumentForReprocessing, which is a separate method precisely so that no
// code path reaches it by accident.
func (s *KnowledgeStore) SetDocumentStatus(ctx context.Context, userID, docID uuid.UUID, status, errMsg string) error {
	if status == knowledge.StatusFailed && errMsg == "" {
		errMsg = "parse failed without a reported reason"
	}
	if status != knowledge.StatusFailed {
		errMsg = ""
	}

	tag, err := s.pool.Exec(ctx, `
        UPDATE documents SET status = $3, error = $4, updated_at = now()
        WHERE id = $1 AND user_id = $2
          AND status NOT IN ('ready', 'failed', 'needs_transcript')`,
		docID, userID, status, errMsg)
	if err != nil {
		return fmt.Errorf("pg: set document status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Either the document is not this user's, or it is already finished and
		// this is a late write from a worker that has lost its lease. Both are
		// "you do not get to change this row".
		return s.refusedOrNoAccess(ctx, userID, docID)
	}
	return nil
}

// RequeueDocument puts a document that failed RETRYABLY back on the queue.
//
// Separate from SetDocumentStatus because it carries a reason onto a
// non-`failed` row, which that method deliberately refuses to do: everywhere
// else, a message next to a non-failed document is a stale one from a previous
// attempt. Here it is current — the document really is waiting to be retried,
// and the user is owed the reason it did not work the first time.
//
// It is still refused for a terminal row, so a straggler cannot use it to
// revive a document either.
func (s *KnowledgeStore) RequeueDocument(ctx context.Context, userID, docID uuid.UUID, reason string) error {
	tag, err := s.pool.Exec(ctx, `
        UPDATE documents SET status = 'queued', error = $3, updated_at = now()
        WHERE id = $1 AND user_id = $2
          AND status NOT IN ('ready', 'failed', 'needs_transcript')`,
		docID, userID, reason)
	if err != nil {
		return fmt.Errorf("pg: requeue document: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return s.refusedOrNoAccess(ctx, userID, docID)
	}
	return nil
}

// refusedOrNoAccess distinguishes "not yours" from "already finished" for the
// caller's error, without leaking the difference to a user: ErrDocumentFinal is
// only ever reached by a caller that already proved ownership.
func (s *KnowledgeStore) refusedOrNoAccess(ctx context.Context, userID, docID uuid.UUID) error {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM documents WHERE id = $1 AND user_id = $2)`,
		docID, userID).Scan(&exists)
	if err != nil {
		return fmt.Errorf("pg: set document status: %w", err)
	}
	if exists {
		return knowledge.ErrDocumentFinal
	}
	return authz.ErrNoAccess
}

// ResetDocumentForReprocessing puts a finished document back on the queue.
//
// The one sanctioned way out of a terminal state, and a separate method rather
// than a status argument because what makes the guard above work is that no
// code path can reach it by accident.
//
// It BUMPS the version, which is what makes the versioned parsed-Markdown path
// mean something: blob.PutParsed writes `<doc>-v<version>.md`, so the re-parse
// writes a new file and the viewer keeps serving the old one until the new one
// is complete. Without the bump, a re-parse that failed halfway would have
// already overwritten the copy the user is reading.
func (s *KnowledgeStore) ResetDocumentForReprocessing(ctx context.Context, userID, docID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
        UPDATE documents SET
            status = 'queued', error = '', version = version + 1, updated_at = now()
        WHERE id = $1 AND user_id = $2`, docID, userID)
	if err != nil {
		return fmt.Errorf("pg: reset document: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return authz.ErrNoAccess
	}
	return nil
}

// FailDocumentTx marks a document failed inside a caller's transaction.
//
// The reaper and the queue's gave-up hook both use it, so the job row and the
// document row move together. As two transactions, a crash between them would
// leave the job `failed` and the document `parsing` — precisely the stuck state
// the jobs package exists to make impossible.
//
// It is a BACKSTOP, so it never overwrites a document that is already terminal.
// The handler's own failure message names the actual cause ("the model returned
// far less text than this document contains"); this one can only say that
// processing stopped. Letting the backstop win would replace every specific
// reason with a generic one at the moment the user most needs the specific one.
func FailDocumentTx(ctx context.Context, tx pgx.Tx, userID, docID uuid.UUID, reason string) error {
	if reason == "" {
		reason = "the worker processing this document stopped unexpectedly"
	}
	_, err := tx.Exec(ctx, `
        UPDATE documents SET status = 'failed', error = $3, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND status NOT IN ('ready', 'failed', 'needs_transcript')`,
		docID, userID, reason)
	return err
}

// RequeueDocumentTx puts a document back to `queued` inside a transaction.
func RequeueDocumentTx(ctx context.Context, tx pgx.Tx, userID, docID uuid.UUID) error {
	_, err := tx.Exec(ctx, `
        UPDATE documents SET status = 'queued', error = '', updated_at = now()
        WHERE id = $1 AND user_id = $2 AND status IN ('parsing', 'indexing')`, docID, userID)
	return err
}

// FinishDocument records a successful parse: provenance, page count, the parsed
// path, and `ready`.
//
// Only from a WORKING state. Without that clause a straggler whose lease the
// reaper already took could flip a `failed` document to `ready` and overwrite
// page_count, parsed_markdown_path and processed_by with its own — while the
// rows in `chunks` belong to whichever worker actually won. The document would
// then advertise a page count and a parsed file that do not match its passages.
func (s *KnowledgeStore) FinishDocument(ctx context.Context, userID, docID uuid.UUID, pageCount int, processedBy knowledge.ProcessedBy, parsedPath string) error {
	raw, err := json.Marshal(processedBy)
	if err != nil {
		return fmt.Errorf("pg: marshal processed_by: %w", err)
	}
	tag, err := s.pool.Exec(ctx, `
        UPDATE documents SET
            status = 'ready', error = '', page_count = $3,
            processed_by = $4, parsed_markdown_path = $5, updated_at = now()
        WHERE id = $1 AND user_id = $2
          AND status IN ('parsing', 'indexing')`,
		docID, userID, pageCount, raw, parsedPath)
	if err != nil {
		return fmt.Errorf("pg: finish document: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return s.refusedOrNoAccess(ctx, userID, docID)
	}
	return nil
}

// RecordProcessedBy stores provenance without changing status, so a fallback is
// visible while the document is still being worked on.
//
// MERGES rather than replaces (`||`). Two reasons, and the Document.ProcessedBy
// comment promises both: a field a later phase adds must survive a
// read-modify-write by this one, and a second fallback in the same document
// must not erase the first — a chain that went gemini → openai → anthropic
// should still say so after the third hop.
func (s *KnowledgeStore) RecordProcessedBy(ctx context.Context, userID, docID uuid.UUID, processedBy knowledge.ProcessedBy) error {
	raw, err := json.Marshal(processedBy)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
        UPDATE documents SET processed_by = processed_by || $3::jsonb, updated_at = now()
        WHERE id = $1 AND user_id = $2`, docID, userID, raw)
	return err
}

// DeleteDocument removes a document and its chunks.
func (s *KnowledgeStore) DeleteDocument(ctx context.Context, userID, kbID, docID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
        DELETE FROM documents WHERE id = $1 AND user_id = $2 AND kb_id = $3`, docID, userID, kbID)
	if err != nil {
		return fmt.Errorf("pg: delete document: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return authz.ErrNoAccess
	}
	return nil
}

// ListDocumentIDs returns a KB's document ids, for reindexing.
func (s *KnowledgeStore) ListDocumentIDs(ctx context.Context, userID, kbID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT id FROM documents
        WHERE user_id = $1 AND kb_id = $2 AND status = 'ready'
        ORDER BY created_at`, userID, kbID)
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

// Touch bumps updated_at, used to make a poll see progress on a long parse.
func (s *KnowledgeStore) Touch(ctx context.Context, userID, docID uuid.UUID) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE documents SET updated_at = $3 WHERE id = $1 AND user_id = $2`,
		docID, userID, time.Now())
	return err
}

// OriginalReferenced reports whether any of the user's documents names sha256,
// as what it parses or as its recording (up-methods phase 15).
func (s *KnowledgeStore) OriginalReferenced(ctx context.Context, userID uuid.UUID, sha256 string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM documents WHERE user_id = $1 AND (sha256 = $2 OR media_sha256 = $2))`,
		userID, sha256).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("original referenced: %w", err)
	}
	return ok, nil
}
