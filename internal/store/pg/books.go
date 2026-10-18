package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/capabilities/book"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/vocab"
)

// BookStore is books, book_chapters and book_blocks (learning-depth phase
// 11). Every statement names the owner.
//
// A chapter's anchors are chunk ids in jsonb, with no foreign key. They are
// resolved with the owner's user_id AND the book's kb_id whenever they are
// saved (ResolveAnchors, on an edit and on confirmation) and whenever they
// are used (Material, on every compile call): an id that is not the owner's
// chunk in that knowledge base is never read. A quiz block's question ids
// are resolved the same way when the chapter is read (book.Service.fill).
type BookStore struct{ pool *Pool }

// NewBookStore builds the store.
func NewBookStore(pool *Pool) *BookStore { return &BookStore{pool: pool} }

var _ book.Store = (*BookStore)(nil)

const bookColumns = `id, user_id, kb_id, title, goal, length, status, proposal,
	consecutive_failures, paused_reason, job_id, created_at, updated_at`

func scanBook(row pgx.Row) (*book.Book, error) {
	var (
		b        book.Book
		proposal []byte
	)
	err := row.Scan(&b.ID, &b.UserID, &b.KBID, &b.Title, &b.Goal, &b.Length, &b.Status, &proposal,
		&b.Failures, &b.PausedReason, &b.JobID, &b.CreatedAt, &b.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, book.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("book: scan: %w", err)
	}
	if err := json.Unmarshal(proposal, &b.Proposal); err != nil {
		return nil, fmt.Errorf("book: decode proposal: %w", err)
	}
	b.Chapters = []book.Chapter{}
	return &b, nil
}

const chapterSelect = `
	SELECT ch.id, ch.book_id, ch.ord, ch.title, ch.objectives, ch.prereqs, ch.anchors, ch.status, ch.error,
	       ch.source_versions, ch.compiled_at,
	       (SELECT count(*) FROM book_blocks bb
	         WHERE bb.chapter_id = ch.id AND bb.user_id = ch.user_id AND bb.type <> 'note'),
	       (SELECT count(*) FROM book_blocks bb
	         WHERE bb.chapter_id = ch.id AND bb.user_id = ch.user_id AND bb.type <> 'note' AND bb.status = 'ready')
	  FROM book_chapters ch`

func scanChapter(row pgx.Row) (*book.Chapter, error) {
	var (
		c                                   book.Chapter
		objectives, prereqs, anchors, versi []byte
	)
	err := row.Scan(&c.ID, &c.BookID, &c.Ord, &c.Title, &objectives, &prereqs, &anchors, &c.Status, &c.Error,
		&versi, &c.CompiledAt, &c.Blocks, &c.Ready)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, book.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("book chapter: scan: %w", err)
	}
	c.Objectives, c.Prereqs, c.Anchors, c.SourceVersions = []string{}, []int{}, []uuid.UUID{}, map[string]int{}
	_ = json.Unmarshal(objectives, &c.Objectives)
	_ = json.Unmarshal(prereqs, &c.Prereqs)
	_ = json.Unmarshal(anchors, &c.Anchors)
	_ = json.Unmarshal(versi, &c.SourceVersions)
	return &c, nil
}

func (s *BookStore) chapters(ctx context.Context, userID, bookID uuid.UUID) ([]book.Chapter, error) {
	rows, err := s.pool.Query(ctx, chapterSelect+` WHERE ch.book_id = $1 AND ch.user_id = $2 ORDER BY ch.ord`, bookID, userID)
	if err != nil {
		return nil, fmt.Errorf("book chapters: %w", err)
	}
	defer rows.Close()
	out := []book.Chapter{}
	for rows.Next() {
		c, err := scanChapter(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// KBName implements book.Store.
func (s *BookStore) KBName(ctx context.Context, userID, kbID uuid.UUID) (string, error) {
	var name string
	err := s.pool.QueryRow(ctx, `SELECT name FROM knowledge_bases WHERE id = $1 AND user_id = $2`, kbID, userID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", book.ErrNotFound
	}
	return name, err
}

// Outline implements book.Store: up to limit chunks spread evenly across the
// knowledge base in reading order, so a long document gets more of the
// sample than a short one and every part of it is seen.
func (s *BookStore) Outline(ctx context.Context, userID, kbID uuid.UUID, limit int) ([]book.Passage, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id FROM chunks c
		  JOIN documents d ON d.id = c.document_id AND d.user_id = c.user_id
		 WHERE c.user_id = $1 AND c.kb_id = $2
		 ORDER BY d.created_at, c.document_id, c.ord
		 LIMIT 20000`, userID, kbID)
	if err != nil {
		return nil, fmt.Errorf("book outline: %w", err)
	}
	var all []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		all = append(all, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	picked := all
	if len(all) > limit {
		picked = make([]uuid.UUID, 0, limit)
		for i := 0; i < limit; i++ {
			picked = append(picked, all[i*len(all)/limit])
		}
	}
	return s.passages(ctx, userID, kbID, picked)
}

// passages reads chunks with their document titles, owner- and kb-scoped, in
// reading order.
func (s *BookStore) passages(ctx context.Context, userID, kbID uuid.UUID, ids []uuid.UUID) ([]book.Passage, error) {
	out := []book.Passage{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.document_id, d.title, c.page_start, c.heading_path, c.text
		  FROM chunks c
		  JOIN documents d ON d.id = c.document_id AND d.user_id = c.user_id
		 WHERE c.user_id = $1 AND c.kb_id = $2 AND c.id = ANY($3)
		 ORDER BY d.created_at, c.document_id, c.ord`, userID, kbID, ids)
	if err != nil {
		return nil, fmt.Errorf("book passages: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var p book.Passage
		if err := rows.Scan(&p.ChunkID, &p.DocumentID, &p.Title, &p.Page, &p.Heading, &p.Text); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ResolveAnchors implements book.Store.
func (s *BookStore) ResolveAnchors(ctx context.Context, userID, kbID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]bool, error) {
	out := map[uuid.UUID]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT id FROM chunks WHERE user_id = $1 AND kb_id = $2 AND id = ANY($3)`, userID, kbID, ids)
	if err != nil {
		return nil, fmt.Errorf("resolve book anchors: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// Material implements book.Store: the anchors that are the owner's chunks in
// the knowledge base, then the chunk before and after each, anchors first
// when the limit bites, returned in reading order. The neighbours are found
// only from anchors that resolved, so an anchor that is not the owner's
// brings nothing with it.
func (s *BookStore) Material(ctx context.Context, userID, kbID uuid.UUID, anchors []uuid.UUID, limit int) ([]book.Passage, error) {
	if len(anchors) == 0 {
		return []book.Passage{}, nil
	}
	rows, err := s.pool.Query(ctx, `
		WITH a AS (
		    SELECT c.id, c.document_id, c.ord, array_position($3::uuid[], c.id) AS pos
		      FROM chunks c
		     WHERE c.user_id = $1 AND c.kb_id = $2 AND c.id = ANY($3)
		)
		SELECT c.id, c.document_id, d.title, c.page_start, c.heading_path, c.text,
		       min(a.pos) AS pos, c.ord
		  FROM a
		  JOIN chunks c ON c.document_id = a.document_id AND c.user_id = $1 AND c.kb_id = $2
		               AND c.ord BETWEEN a.ord - 1 AND a.ord + 1
		  JOIN documents d ON d.id = c.document_id AND d.user_id = c.user_id
		 GROUP BY c.id, c.document_id, d.title, c.page_start, c.heading_path, c.text, c.ord
		 ORDER BY bool_and(c.id <> a.id), min(a.pos), c.ord
		 LIMIT $4`, userID, kbID, anchors, limit)
	if err != nil {
		return nil, fmt.Errorf("book material: %w", err)
	}
	defer rows.Close()
	type ranked struct {
		p        book.Passage
		pos, ord int
	}
	var got []ranked
	for rows.Next() {
		var r ranked
		if err := rows.Scan(&r.p.ChunkID, &r.p.DocumentID, &r.p.Title, &r.p.Page, &r.p.Heading, &r.p.Text, &r.pos, &r.ord); err != nil {
			return nil, err
		}
		got = append(got, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(got, func(i, j int) bool {
		if got[i].pos != got[j].pos {
			return got[i].pos < got[j].pos
		}
		return got[i].ord < got[j].ord
	})
	out := make([]book.Passage, 0, len(got))
	for _, r := range got {
		out = append(out, r.p)
	}
	return out, nil
}

// DocumentVersions implements book.Store.
func (s *BookStore) DocumentVersions(ctx context.Context, userID uuid.UUID, docIDs []uuid.UUID) (map[string]int, error) {
	return documentVersions(ctx, s.pool, userID, docIDs)
}

// documentVersions reads each of the owner's documents' current version; a
// document that is gone, or not theirs, is absent.
func documentVersions(ctx context.Context, pool *Pool, userID uuid.UUID, docIDs []uuid.UUID) (map[string]int, error) {
	out := map[string]int{}
	if len(docIDs) == 0 {
		return out, nil
	}
	rows, err := pool.Query(ctx, `SELECT id, version FROM documents WHERE user_id = $1 AND id = ANY($2)`, userID, docIDs)
	if err != nil {
		return nil, fmt.Errorf("document versions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id uuid.UUID
			v  int
		)
		if err := rows.Scan(&id, &v); err != nil {
			return nil, err
		}
		out[id.String()] = v
	}
	return out, rows.Err()
}

// CreateBook implements book.Store. The composite foreign key refuses a
// knowledge base the user does not own.
func (s *BookStore) CreateBook(ctx context.Context, b book.Book) (*book.Book, error) {
	proposal, _ := json.Marshal(b.Proposal)
	return scanBook(s.pool.QueryRow(ctx, `
		INSERT INTO books (user_id, kb_id, title, goal, length, status, proposal)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING `+bookColumns, b.UserID, b.KBID, b.Title, b.Goal, b.Length, b.Status, proposal))
}

// GetBook implements book.Store.
func (s *BookStore) GetBook(ctx context.Context, userID, id uuid.UUID) (*book.Book, error) {
	b, err := scanBook(s.pool.QueryRow(ctx, `SELECT `+bookColumns+` FROM books WHERE id = $1 AND user_id = $2`, id, userID))
	if err != nil {
		return nil, err
	}
	if b.Chapters, err = s.chapters(ctx, userID, id); err != nil {
		return nil, err
	}
	return b, nil
}

// ListBooks implements book.Store: newest first, with chapter progress but
// without the outline's passages, which only the editor needs.
func (s *BookStore) ListBooks(ctx context.Context, userID uuid.UUID, kbID *uuid.UUID) ([]book.Book, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+bookColumns+` FROM books
		 WHERE user_id = $1 AND ($2::uuid IS NULL OR kb_id = $2)
		 ORDER BY created_at DESC LIMIT 50`, userID, kbID)
	if err != nil {
		return nil, fmt.Errorf("books: %w", err)
	}
	out := []book.Book{}
	for rows.Next() {
		b, err := scanBook(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		b.Proposal.Outline = nil
		out = append(out, *b)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		if out[i].Chapters, err = s.chapters(ctx, userID, out[i].ID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// SaveProposal implements book.Store: only while the book is proposed.
func (s *BookStore) SaveProposal(ctx context.Context, userID, id uuid.UUID, p book.Proposal) error {
	raw, _ := json.Marshal(p)
	tag, err := s.pool.Exec(ctx, `
		UPDATE books SET proposal = $3, title = $4, updated_at = now()
		 WHERE id = $1 AND user_id = $2 AND status = 'proposed'`, id, userID, raw, p.Title)
	if err != nil {
		return fmt.Errorf("save book proposal: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return book.ErrNotEditable
	}
	return nil
}

// Confirm implements book.Store: the status change and the chapters in one
// transaction, so a book is never confirmed with half its chapters.
func (s *BookStore) Confirm(ctx context.Context, userID, id uuid.UUID, chapters []book.ProposedChapter) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("confirm book: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck
	tag, err := tx.Exec(ctx, `
		UPDATE books SET status = 'confirmed', updated_at = now()
		 WHERE id = $1 AND user_id = $2 AND status = 'proposed'`, id, userID)
	if err != nil {
		return false, fmt.Errorf("confirm book: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	for i, ch := range chapters {
		objectives, prereqs, anchors := jsonArray(ch.Objectives), jsonArray(ch.Prereqs), jsonArray(ch.Anchors)
		if _, err := tx.Exec(ctx, `
			INSERT INTO book_chapters (user_id, book_id, ord, title, objectives, prereqs, anchors)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			userID, id, i+1, ch.Title, objectives, prereqs, anchors); err != nil {
			return false, fmt.Errorf("create book chapter: %w", err)
		}
	}
	return true, tx.Commit(ctx)
}

// DeleteBook implements book.Store; chapters, blocks and flash cards go by
// cascade.
func (s *BookStore) DeleteBook(ctx context.Context, userID, id uuid.UUID) (*book.Book, error) {
	return scanBook(s.pool.QueryRow(ctx,
		`DELETE FROM books WHERE id = $1 AND user_id = $2 RETURNING `+bookColumns, id, userID))
}

// SetJob implements book.Store.
func (s *BookStore) SetJob(ctx context.Context, userID, id, jobID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `UPDATE books SET job_id = $3, updated_at = now() WHERE id = $1 AND user_id = $2`, id, userID, jobID)
	return err
}

// GetChapter implements book.Store: the chapter must be the owner's AND the
// named book's.
func (s *BookStore) GetChapter(ctx context.Context, userID, bookID, chapterID uuid.UUID) (*book.Chapter, error) {
	return scanChapter(s.pool.QueryRow(ctx, chapterSelect+
		` WHERE ch.id = $1 AND ch.book_id = $2 AND ch.user_id = $3`, chapterID, bookID, userID))
}

const blockColumns = `bb.id, bb.chapter_id, bb.ord, bb.type, bb.status, bb.title, bb.brief, bb.payload, bb.sources,
	bb.error, bb.version, bb.created_at`

func scanBlock(row pgx.Row) (*book.Block, error) {
	var (
		b       book.Block
		sources []byte
	)
	err := row.Scan(&b.ID, &b.ChapterID, &b.Ord, &b.Type, &b.Status, &b.Title, &b.Brief, &b.Payload, &sources,
		&b.Error, &b.Version, &b.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, book.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("book block: scan: %w", err)
	}
	b.Sources = []citations.Source{}
	_ = json.Unmarshal(sources, &b.Sources)
	return &b, nil
}

// Blocks implements book.Store.
func (s *BookStore) Blocks(ctx context.Context, userID, chapterID uuid.UUID) ([]book.Block, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+blockColumns+` FROM book_blocks bb
		 WHERE bb.chapter_id = $1 AND bb.user_id = $2 ORDER BY bb.ord`, chapterID, userID)
	if err != nil {
		return nil, fmt.Errorf("book blocks: %w", err)
	}
	defer rows.Close()
	out := []book.Block{}
	for rows.Next() {
		b, err := scanBlock(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

// GetBlock implements book.Store: the block must be the owner's AND in a
// chapter of the named book.
func (s *BookStore) GetBlock(ctx context.Context, userID, bookID, blockID uuid.UUID) (*book.Block, *book.Chapter, error) {
	b, err := scanBlock(s.pool.QueryRow(ctx, `SELECT `+blockColumns+` FROM book_blocks bb
		  JOIN book_chapters ch ON ch.id = bb.chapter_id AND ch.user_id = bb.user_id
		 WHERE bb.id = $1 AND ch.book_id = $2 AND bb.user_id = $3`, blockID, bookID, userID))
	if err != nil {
		return nil, nil, err
	}
	ch, err := s.GetChapter(ctx, userID, bookID, b.ChapterID)
	if err != nil {
		return nil, nil, err
	}
	return b, ch, nil
}

// StartCompiling implements book.Store. The book row is locked first, so two
// compile requests for one book serialise and the second sees the first's
// chapters compiling.
func (s *BookStore) StartCompiling(ctx context.Context, userID, bookID uuid.UUID, ids []uuid.UUID, refresh bool) ([]uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("start compiling: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	var busy bool
	err = tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM book_chapters WHERE book_id = b.id AND user_id = b.user_id AND status = 'compiling')
		  FROM books b WHERE b.id = $1 AND b.user_id = $2 AND b.status = 'confirmed'
		   FOR UPDATE OF b`, bookID, userID).Scan(&busy)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, book.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("start compiling: %w", err)
	}
	if busy {
		return nil, nil
	}

	// A refreshed chapter's blocks go back to pending, each keeping its
	// payload (and so its previous version on the page) until the new one is
	// written.
	if refresh && ids != nil {
		if _, err := tx.Exec(ctx, `
			UPDATE book_blocks bb SET status = 'pending', updated_at = now()
			  FROM book_chapters ch
			 WHERE bb.chapter_id = ch.id AND bb.user_id = ch.user_id
			   AND ch.book_id = $1 AND ch.user_id = $2 AND ch.id = ANY($3)
			   AND bb.type <> 'note' AND ch.status <> 'compiling'`, bookID, userID, ids); err != nil {
			return nil, fmt.Errorf("refresh chapter: %w", err)
		}
	}
	rows, err := tx.Query(ctx, `
		UPDATE book_chapters ch SET status = 'compiling', error = '', updated_at = now()
		 WHERE ch.book_id = $1 AND ch.user_id = $2 AND ch.status <> 'compiling'
		   AND (CASE WHEN $3::uuid[] IS NULL
		             THEN ch.status <> 'ready'
		               OR EXISTS (SELECT 1 FROM book_blocks o WHERE o.chapter_id = ch.id AND o.user_id = ch.user_id
		                            AND o.type <> 'note' AND o.status <> 'ready')
		             ELSE ch.id = ANY($3) END)
		RETURNING ch.id, ch.ord`, bookID, userID, ids)
	if err != nil {
		return nil, fmt.Errorf("start compiling: %w", err)
	}
	type started struct {
		id  uuid.UUID
		ord int
	}
	var got []started
	for rows.Next() {
		var st started
		if err := rows.Scan(&st.id, &st.ord); err != nil {
			rows.Close()
			return nil, err
		}
		got = append(got, st)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(got) > 0 {
		if _, err := tx.Exec(ctx, `
			UPDATE books SET paused_reason = '', consecutive_failures = 0, updated_at = now()
			 WHERE id = $1 AND user_id = $2`, bookID, userID); err != nil {
			return nil, fmt.Errorf("resume book: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("start compiling: %w", err)
	}
	sort.Slice(got, func(i, j int) bool { return got[i].ord < got[j].ord })
	out := make([]uuid.UUID, 0, len(got))
	for _, st := range got {
		out = append(out, st.id)
	}
	return out, nil
}

// SetAnchors implements book.Store.
func (s *BookStore) SetAnchors(ctx context.Context, userID, chapterID uuid.UUID, anchors []uuid.UUID) error {
	raw := jsonArray(anchors)
	_, err := s.pool.Exec(ctx,
		`UPDATE book_chapters SET anchors = $3, updated_at = now() WHERE id = $1 AND user_id = $2`, chapterID, userID, raw)
	return err
}

// SavePlan implements book.Store: the planned blocks, pending, after any
// note the learner already added.
func (s *BookStore) SavePlan(ctx context.Context, userID, chapterID uuid.UUID, blocks []book.PlannedBlock) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("save chapter plan: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck
	var next int
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(max(ord), 0) FROM book_blocks WHERE chapter_id = $1 AND user_id = $2`,
		chapterID, userID).Scan(&next); err != nil {
		return fmt.Errorf("save chapter plan: %w", err)
	}
	for i, b := range blocks {
		if _, err := tx.Exec(ctx, `
			INSERT INTO book_blocks (user_id, chapter_id, ord, type, title, brief)
			VALUES ($1, $2, $3, $4, $5, $6)`, userID, chapterID, next+i+1, b.Type, b.Title, b.Brief); err != nil {
			return fmt.Errorf("save planned block: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// SaveBlock implements book.Store: the new version replaces the old in one
// transaction — for a flash-card block, its cards too, keeping the
// learner's "Add to review" choice.
func (s *BookStore) SaveBlock(ctx context.Context, userID, blockID uuid.UUID, w book.BlockWrite) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("save book block: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck
	sources := jsonArray(w.Sources)
	var kind string
	err = tx.QueryRow(ctx, `
		UPDATE book_blocks SET status = 'ready', payload = $3, sources = $4, error = '',
		       version = version + 1, updated_at = $5
		 WHERE id = $1 AND user_id = $2
		RETURNING type`, blockID, userID, w.Payload, sources, w.Now).Scan(&kind)
	if errors.Is(err, pgx.ErrNoRows) {
		return book.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("save book block: %w", err)
	}
	if kind == book.TypeFlashCards {
		// Out of review stays out of review: the learner turned it off.
		var had, suspended int
		if err := tx.QueryRow(ctx, `
			SELECT count(*), count(*) FILTER (WHERE suspended) FROM vocab_cards
			 WHERE book_block_id = $1 AND user_id = $2`, blockID, userID).Scan(&had, &suspended); err != nil {
			return fmt.Errorf("save flash cards: %w", err)
		}
		if err := ReplaceFlashCards(ctx, tx, userID, blockID, w.Flash, w.NewCard, had > 0 && suspended == had, w.Now); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// FailBlock implements book.Store: the reason is recorded and the payload
// (the previous version, if any) is left as it was.
func (s *BookStore) FailBlock(ctx context.Context, userID, blockID uuid.UUID, reason string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE book_blocks SET status = 'error', error = left($3, 2000), updated_at = now()
		 WHERE id = $1 AND user_id = $2`, blockID, userID, reason)
	return err
}

// FinishChapter implements book.Store. versions nil leaves them as they were.
func (s *BookStore) FinishChapter(ctx context.Context, userID, chapterID uuid.UUID, status, reason string, versions map[string]int, now time.Time) error {
	var raw []byte
	if versions != nil {
		raw, _ = json.Marshal(versions)
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE book_chapters
		   SET status = $3, error = left($4, 2000), source_versions = COALESCE($5, source_versions),
		       compiled_at = CASE WHEN $3 = 'ready' THEN $6 ELSE compiled_at END, updated_at = now()
		 WHERE id = $1 AND user_id = $2`, chapterID, userID, status, reason, raw, now)
	return err
}

// RecordFailure implements book.Store.
func (s *BookStore) RecordFailure(ctx context.Context, userID, bookID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
		UPDATE books SET consecutive_failures = consecutive_failures + 1, updated_at = now()
		 WHERE id = $1 AND user_id = $2 RETURNING consecutive_failures`, bookID, userID).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, book.ErrNotFound
	}
	return n, err
}

// ResetFailures implements book.Store.
func (s *BookStore) ResetFailures(ctx context.Context, userID, bookID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE books SET consecutive_failures = 0
		 WHERE id = $1 AND user_id = $2 AND consecutive_failures <> 0`, bookID, userID)
	return err
}

// Pause implements book.Store.
func (s *BookStore) Pause(ctx context.Context, userID, bookID uuid.UUID, reason string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE books SET paused_reason = left($3, 2000), updated_at = now()
		 WHERE id = $1 AND user_id = $2`, bookID, userID, reason)
	return err
}

// AddNote implements book.Store: the note goes last in the chapter.
func (s *BookStore) AddNote(ctx context.Context, userID, bookID, chapterID uuid.UUID, markdown string) (*book.Block, error) {
	payload, _ := json.Marshal(book.MarkdownPayload{Markdown: markdown})
	return scanBlock(s.pool.QueryRow(ctx, `
		WITH ch AS (
		    SELECT id, user_id FROM book_chapters WHERE id = $1 AND book_id = $2 AND user_id = $3
		)
		INSERT INTO book_blocks (user_id, chapter_id, ord, type, status, payload, version)
		SELECT ch.user_id, ch.id,
		       COALESCE((SELECT max(ord) FROM book_blocks WHERE chapter_id = ch.id AND user_id = ch.user_id), 0) + 1,
		       'note', 'ready', $4, 1
		  FROM ch
		RETURNING id, chapter_id, ord, type, status, title, brief, payload, sources, error, version, created_at`,
		chapterID, bookID, userID, payload))
}

// FlashCards implements book.Store.
func (s *BookStore) FlashCards(ctx context.Context, userID, blockID uuid.UUID) ([]vocab.FlashCard, bool, error) {
	return FlashCardsOf(ctx, s.pool, userID, blockID)
}

// SetInReview implements book.Store: the block must be in the named book.
func (s *BookStore) SetInReview(ctx context.Context, userID, bookID, blockID uuid.UUID, on bool) error {
	if _, _, err := s.GetBlock(ctx, userID, bookID, blockID); err != nil {
		return err
	}
	_, err := SetFlashInReview(ctx, s.pool, userID, blockID, on)
	return err
}

// BookReapHandler settles the chapters of a compile job that gave up, in the
// same transaction as the job's final write: without it they would say
// "compiling" forever. A cancelled job, or one that paused its book, leaves
// them paused; anything else leaves them in error with the reason. Blocks
// already written stay written, so compiling again resumes.
func BookReapHandler() jobs.ReapHandler {
	return func(ctx context.Context, tx pgx.Tx, job jobs.ReapedJob) error {
		if job.Kind != book.JobKind || !job.Terminal {
			return nil
		}
		var p struct {
			BookID     uuid.UUID   `json:"book_id"`
			ChapterIDs []uuid.UUID `json:"chapter_ids"`
		}
		if err := json.Unmarshal(job.Payload, &p); err != nil {
			return nil
		}
		var reason string
		_ = tx.QueryRow(ctx, `SELECT last_error FROM jobs WHERE id = $1`, job.ID).Scan(&reason)
		if reason == "" {
			reason = "the chapter stopped and was retried as many times as allowed"
		}
		_, err := tx.Exec(ctx, `
			UPDATE book_chapters ch
			   SET status = CASE WHEN b.paused_reason <> '' OR $4 = 'cancelled' THEN 'paused' ELSE 'error' END,
			       error = left($4, 2000), updated_at = now()
			  FROM books b
			 WHERE b.id = ch.book_id AND b.user_id = ch.user_id
			   AND ch.book_id = $1 AND ch.user_id = $2 AND ch.id = ANY($3) AND ch.status = 'compiling'`,
			p.BookID, job.UserID, p.ChapterIDs, reason)
		return err
	}
}

// jsonArray marshals a slice for a jsonb array column: a nil slice is [],
// not null, which the columns' CHECKs refuse.
func jsonArray[T any](v []T) []byte {
	if v == nil {
		return []byte("[]")
	}
	raw, _ := json.Marshal(v)
	return raw
}
