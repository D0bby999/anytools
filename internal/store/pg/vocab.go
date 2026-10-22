package pg

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/vocab"
)

// VocabStore is the pgx implementation of vocabulary notes, cards and reviews.
//
// Every statement names user_id. The ids inside `contexts` (document and
// chunk) have no foreign key, so they are resolved with the owner's user_id
// when a context is saved AND again whenever it is read back: a document
// deleted since, or a chunk replaced by a re-index, reads back without its id
// rather than as a link to nothing — or to someone else's row.
type VocabStore struct{ pool *Pool }

// NewVocabStore builds a VocabStore over the shared pool.
func NewVocabStore(pool *Pool) *VocabStore { return &VocabStore{pool: pool} }

// vocabQuerier is the part of a pool or a transaction these helpers use.
type vocabQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

const noteSelect = `
	SELECT n.id, n.user_id, n.term, n.lang, n.reading, n.pos, n.meaning, n.contexts,
	       n.source_document_id, n.source_page, d.title, n.created_at, n.updated_at,
	       n.decision, n.record, n.task_impact, n.decided_at, n.scenario, n.confusable, n.production,
	       n.listening, n.writing, n.origin,
	       COALESCE((
	         SELECT jsonb_agg(jsonb_build_object(
	                  'id', c.id, 'kind', c.kind, 'due_at', c.due_at, 'reps', c.reps,
	                  'lapses', c.lapses, 'suspended', c.suspended)
	                ORDER BY c.kind = 'production', c.kind = 'cloze', c.kind)
	           FROM vocab_cards c WHERE c.note_id = n.id AND c.user_id = n.user_id
	       ), '[]'::jsonb)
	  FROM vocab_notes n
	  LEFT JOIN documents d ON d.id = n.source_document_id AND d.user_id = n.user_id`

// SaveNote implements vocab.Store.
//
// Insert-or-merge in one transaction. The insert is ON CONFLICT DO NOTHING on
// the (user_id, lang, lower(term)) index, so two saves of one word racing
// each other end with one note; the loser then locks the winner's row and
// adds its context to it, which is what a second save means.
func (s *VocabStore) SaveNote(ctx context.Context, w vocab.NoteWrite) (*vocab.Note, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("save vocab note: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	c, err := resolveNewContext(ctx, tx, w.UserID, w.Term, w.Context)
	if err != nil {
		return nil, false, err
	}
	first, _ := json.Marshal([]vocab.Context{c})
	if w.Decision == "" {
		// The column's default: a note from a caller that predates decisions.
		w.Decision = vocab.DecisionLearn
	}

	var id uuid.UUID
	// A note saved from a page names its document; one from chat names none.
	var doc *uuid.UUID
	if w.DocumentID != uuid.Nil {
		doc = &w.DocumentID
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO vocab_notes (user_id, term, lang, reading, pos, meaning, contexts,
		                         source_document_id, source_page, decision, record, task_impact,
		                         origin, decided_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $14)
		ON CONFLICT (user_id, lang, lower(term)) DO NOTHING
		RETURNING id`,
		w.UserID, w.Term, w.Lang, w.Reading, w.POS, w.Meaning, first,
		doc, w.Page, w.Decision, recordJSON(w.Record), w.TaskImpact, w.Origin, w.Now).Scan(&id)
	created := err == nil
	switch {
	case created:
		// Only a word to learn is reviewed (up's vocabulary chapter §3).
		kinds := w.Kinds
		if kinds == nil {
			kinds = vocab.CardKinds()
		}
		if vocab.HasCards(w.Decision) {
			if err := upsertCards(ctx, tx, w.UserID, id, kinds, w.NewCard, w.Now); err != nil {
				return nil, false, err
			}
		}
	case errors.Is(err, pgx.ErrNoRows):
		// A second save never changes the decision: that is a PATCH.
		if id, err = mergeContext(ctx, tx, w, c); err != nil {
			return nil, false, err
		}
	default:
		return nil, false, fmt.Errorf("insert vocab note: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, false, fmt.Errorf("save vocab note: %w", err)
	}
	n, err := s.GetNote(ctx, w.UserID, id)
	return n, created, err
}

// upsertCards gives a note these cards, in one statement each: a new card
// starts at newCard's schedule, and one the note already has (suspended when
// the learner moved away from "learn") is resumed with its schedule kept.
func upsertCards(ctx context.Context, tx pgx.Tx, userID, noteID uuid.UUID, kinds []string, newCard learning.Card, now time.Time) error {
	card, _ := json.Marshal(newCard)
	for _, kind := range kinds {
		if _, err := tx.Exec(ctx, `
			INSERT INTO vocab_cards (user_id, note_id, kind, fsrs_card, due_at, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $6)
			ON CONFLICT (note_id, kind) DO UPDATE SET suspended = false, updated_at = EXCLUDED.updated_at`,
			userID, noteID, kind, card, newCard.Due, now); err != nil {
			return fmt.Errorf("create vocab card: %w", err)
		}
	}
	return nil
}

func recordJSON(r map[string]string) []byte {
	if r == nil {
		r = map[string]string{}
	}
	raw, _ := json.Marshal(r)
	return raw
}

// mergeContext adds a context to the user's existing note for the term: newest
// first, a sentence already there not repeated, at most vocab.MaxContexts.
// The meaning and the other fields are the learner's and are left alone.
func mergeContext(ctx context.Context, tx pgx.Tx, w vocab.NoteWrite, c vocab.Context) (uuid.UUID, error) {
	var (
		id  uuid.UUID
		raw []byte
	)
	err := tx.QueryRow(ctx, `
		SELECT id, contexts FROM vocab_notes
		 WHERE user_id = $1 AND lang = $2 AND lower(term) = lower($3)
		 FOR UPDATE`, w.UserID, w.Lang, w.Term).Scan(&id, &raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("find vocab note: %w", err)
	}
	var existing []vocab.Context
	_ = json.Unmarshal(raw, &existing)

	merged := []vocab.Context{c}
	for _, e := range existing {
		if e.Sentence != c.Sentence && len(merged) < vocab.MaxContexts {
			merged = append(merged, e)
		}
	}
	out, _ := json.Marshal(merged)
	if _, err := tx.Exec(ctx,
		`UPDATE vocab_notes SET contexts = $3, updated_at = $4 WHERE id = $1 AND user_id = $2`,
		id, w.UserID, out, w.Now); err != nil {
		return uuid.Nil, fmt.Errorf("add vocab context: %w", err)
	}
	return id, nil
}

// resolveNewContext is the save-side resolution of a context's ids: the
// document must be the user's (else ErrNotFound, exactly as a missing one),
// and the chunk is looked up by the user's document and page, preferring a
// chunk whose text contains the term.
func resolveNewContext(ctx context.Context, q vocabQuerier, userID uuid.UUID, term string, c vocab.Context) (vocab.Context, error) {
	c.DocumentTitle, c.ChunkID = "", nil
	if c.DocumentID == nil {
		return c, nil
	}
	var owned bool
	if err := q.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM documents WHERE id = $1 AND user_id = $2)`,
		*c.DocumentID, userID).Scan(&owned); err != nil {
		return c, fmt.Errorf("resolve vocab source: %w", err)
	}
	if !owned {
		return c, vocab.ErrNotFound
	}
	if c.Page > 0 {
		var chunk uuid.UUID
		err := q.QueryRow(ctx, `
			SELECT id FROM chunks
			 WHERE user_id = $1 AND document_id = $2 AND page_start <= $3 AND page_end >= $3
			 ORDER BY strpos(lower(text), lower($4)) = 0, ord
			 LIMIT 1`, userID, *c.DocumentID, c.Page, term).Scan(&chunk)
		switch {
		case err == nil:
			c.ChunkID = &chunk
		case !errors.Is(err, pgx.ErrNoRows):
			return c, fmt.Errorf("resolve vocab chunk: %w", err)
		}
	}
	return c, nil
}

// resolveContexts is the read-side resolution: every document and chunk id in
// the notes' contexts is looked up with the owner's user_id, and one that no
// longer resolves is dropped from the context (the sentence stays).
func resolveContexts(ctx context.Context, q vocabQuerier, userID uuid.UUID, lists ...*[]vocab.Context) error {
	var docIDs, chunkIDs []uuid.UUID
	for _, l := range lists {
		for _, c := range *l {
			if c.DocumentID != nil {
				docIDs = append(docIDs, *c.DocumentID)
			}
			if c.ChunkID != nil {
				chunkIDs = append(chunkIDs, *c.ChunkID)
			}
		}
	}
	if len(docIDs) == 0 {
		return nil
	}
	titles := map[uuid.UUID]string{}
	rows, err := q.Query(ctx,
		`SELECT id, title FROM documents WHERE user_id = $1 AND id = ANY($2)`, userID, docIDs)
	if err != nil {
		return fmt.Errorf("resolve vocab contexts: %w", err)
	}
	for rows.Next() {
		var id uuid.UUID
		var title string
		if err := rows.Scan(&id, &title); err != nil {
			rows.Close()
			return err
		}
		titles[id] = title
	}
	rows.Close()
	chunks := map[uuid.UUID]bool{}
	if len(chunkIDs) > 0 {
		rows, err := q.Query(ctx,
			`SELECT id FROM chunks WHERE user_id = $1 AND id = ANY($2)`, userID, chunkIDs)
		if err != nil {
			return fmt.Errorf("resolve vocab chunks: %w", err)
		}
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			chunks[id] = true
		}
		rows.Close()
	}
	for _, l := range lists {
		for i := range *l {
			c := &(*l)[i]
			title, ok := "", false
			if c.DocumentID != nil {
				title, ok = titles[*c.DocumentID]
			}
			if !ok {
				c.DocumentID, c.ChunkID, c.DocumentTitle, c.Page = nil, nil, "", 0
				continue
			}
			c.DocumentTitle = title
			if c.ChunkID != nil && !chunks[*c.ChunkID] {
				c.ChunkID = nil
			}
		}
	}
	return nil
}

func scanVocabNote(row pgx.Row) (*vocab.Note, error) {
	var (
		n        vocab.Note
		contexts []byte
		cards    []byte
		record   []byte
		docID    *uuid.UUID
		page     *int
		title    *string
	)
	err := row.Scan(&n.ID, &n.UserID, &n.Term, &n.Lang, &n.Reading, &n.POS, &n.Meaning, &contexts,
		&docID, &page, &title, &n.CreatedAt, &n.UpdatedAt,
		&n.Decision, &record, &n.TaskImpact, &n.DecidedAt, &n.Scenario, &n.Confusable, &n.Production,
		&n.Listening, &n.Writing, &n.Origin, &cards)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, vocab.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan vocab note: %w", err)
	}
	n.Contexts = []vocab.Context{}
	if err := json.Unmarshal(contexts, &n.Contexts); err != nil {
		return nil, fmt.Errorf("decode vocab contexts: %w", err)
	}
	n.Record = map[string]string{}
	if err := json.Unmarshal(record, &n.Record); err != nil {
		return nil, fmt.Errorf("decode vocab record: %w", err)
	}
	n.Cards = []vocab.CardSummary{}
	if err := json.Unmarshal(cards, &n.Cards); err != nil {
		return nil, fmt.Errorf("decode vocab cards: %w", err)
	}
	// The join is on (id, user_id), so a title only comes back for a document
	// that exists and is the owner's.
	if docID != nil && title != nil {
		n.Source = &vocab.Source{DocumentID: *docID, Title: *title}
		if page != nil {
			n.Source.Page = *page
		}
	}
	n.Suspended = len(n.Cards) > 0
	for _, c := range n.Cards {
		n.Suspended = n.Suspended && c.Suspended
	}
	return &n, nil
}

// GetNote implements vocab.Store.
func (s *VocabStore) GetNote(ctx context.Context, userID, id uuid.UUID) (*vocab.Note, error) {
	n, err := scanVocabNote(s.pool.QueryRow(ctx, noteSelect+` WHERE n.id = $1 AND n.user_id = $2`, id, userID))
	if err != nil {
		return nil, err
	}
	if err := resolveContexts(ctx, s.pool, userID, &n.Contexts); err != nil {
		return nil, err
	}
	docs, err := timedDocs(ctx, s.pool, userID, n.Contexts)
	if err != nil {
		return nil, err
	}
	n.Clip = vocab.ClipOf(n.Contexts, docs)
	return n, nil
}

// timedDocs reads, with the owner's user_id, the YouTube videos and uploaded
// recordings these contexts name, with their timelines: what vocab.ClipOf
// needs to find a line to play.
func timedDocs(ctx context.Context, q vocabQuerier, userID uuid.UUID, contexts ...[]vocab.Context) (map[uuid.UUID]vocab.TimedDoc, error) {
	var ids []uuid.UUID
	for _, l := range contexts {
		for _, c := range l {
			if c.DocumentID != nil && c.Page > 0 {
				ids = append(ids, *c.DocumentID)
			}
		}
	}
	out := map[uuid.UUID]vocab.TimedDoc{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `
		SELECT id, media_id, timeline FROM documents
		 WHERE user_id = $1 AND id = ANY($2) AND source_kind IN ('youtube', 'media')
		   AND timeline IS NOT NULL`, userID, ids)
	if err != nil {
		return nil, fmt.Errorf("read timed documents: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id  uuid.UUID
			d   vocab.TimedDoc
			raw []byte
		)
		if err := rows.Scan(&id, &d.VideoID, &raw); err != nil {
			return nil, err
		}
		if json.Unmarshal(raw, &d.Timeline) == nil && len(d.Timeline) > 0 {
			out[id] = d
		}
	}
	return out, rows.Err()
}

// ListNotes implements vocab.Store. q matches the term or the meaning; LIKE's
// wildcards in it are escaped, so "50%" searches for "50%".
func (s *VocabStore) ListNotes(ctx context.Context, userID uuid.UUID, f vocab.Filter) ([]vocab.Note, error) {
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 200
	}
	like := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(f.Q) + "%"
	terms := make([]string, 0, len(f.Terms))
	for _, t := range f.Terms {
		terms = append(terms, strings.ToLower(t))
	}
	rows, err := s.pool.Query(ctx, noteSelect+`
		 WHERE n.user_id = $1
		   AND ($2 = '' OR n.term ILIKE $3 OR n.meaning ILIKE $3)
		   AND ($4 = '' OR n.lang = $4)
		   AND ($6 = '' OR n.decision = $6)
		   AND (cardinality($7::text[]) = 0 OR lower(n.term) = ANY($7))
		 ORDER BY n.updated_at DESC, n.id
		 LIMIT $5 OFFSET $8`, userID, f.Q, like, f.Lang, f.Limit, f.Decision, terms, max(0, f.Offset))
	if err != nil {
		return nil, fmt.Errorf("list vocab notes: %w", err)
	}
	out := []vocab.Note{}
	for rows.Next() {
		n, err := scanVocabNote(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, *n)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	lists := make([]*[]vocab.Context, len(out))
	for i := range out {
		lists[i] = &out[i].Contexts
	}
	if err := resolveContexts(ctx, s.pool, userID, lists...); err != nil {
		return nil, err
	}
	all := make([][]vocab.Context, len(out))
	for i := range out {
		all[i] = out[i].Contexts
	}
	docs, err := timedDocs(ctx, s.pool, userID, all...)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Clip = vocab.ClipOf(out[i].Contexts, docs)
	}
	return out, nil
}

// UpdateNote implements vocab.Store, in one transaction under the note's row
// lock: the patch's Check sees the note as the patch would leave it, then the
// fields are written and the cards follow the decision.
//
//   - Moving to learn creates the recognition and cloze cards, or resumes
//     the ones the note already has (ON CONFLICT (note_id, kind) DO UPDATE),
//     and the production card too when the learner had asked for it. So
//     learn → skip → learn ends with the same cards, never an error.
//   - Moving away from learn suspends every card of the note; none is
//     deleted, and the schedules are kept.
func (s *VocabStore) UpdateNote(ctx context.Context, userID, id uuid.UUID, p vocab.NotePatch) (*vocab.Note, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("update vocab note: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	var (
		cur     vocab.NoteState
		rawRec  []byte
		rawCtxs []byte
	)
	err = tx.QueryRow(ctx, `
		SELECT decision, record, meaning, scenario, production, listening, writing, term, lang, contexts FROM vocab_notes
		 WHERE id = $1 AND user_id = $2 FOR UPDATE`, id, userID).
		Scan(&cur.Decision, &rawRec, &cur.Meaning, &cur.Scenario, &cur.Production, &cur.Listening, &cur.Writing,
			&cur.Term, &cur.Lang, &rawCtxs)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, vocab.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lock vocab note: %w", err)
	}
	_ = json.Unmarshal(rawRec, &cur.Record)
	if p.Listening != nil && *p.Listening {
		var ctxs []vocab.Context
		_ = json.Unmarshal(rawCtxs, &ctxs)
		docs, err := timedDocs(ctx, tx, userID, ctxs)
		if err != nil {
			return nil, err
		}
		cur.HasClip = vocab.ClipOf(ctxs, docs) != nil
	}

	next := cur
	if p.Decision != nil {
		next.Decision = *p.Decision
	}
	if p.Record != nil {
		next.Record = p.Record
	}
	if p.Meaning != nil {
		next.Meaning = *p.Meaning
	}
	if p.Scenario != nil {
		next.Scenario = *p.Scenario
	}
	if p.Production != nil {
		next.Production = *p.Production
	}
	if p.Listening != nil {
		next.Listening = *p.Listening
	}
	if p.Writing != nil {
		next.Writing = *p.Writing
	}
	if p.Lang != nil {
		next.Lang = *p.Lang
	}
	if p.Check != nil {
		if err := p.Check(next); err != nil {
			return nil, err
		}
	}
	var record []byte
	if p.Record != nil {
		record = recordJSON(p.Record)
	}

	if _, err = tx.Exec(ctx, `
		UPDATE vocab_notes
		   SET meaning = COALESCE($3, meaning), reading = COALESCE($4, reading),
		       pos = COALESCE($5, pos), lang = COALESCE($6, lang),
		       decided_at = CASE WHEN $7::text IS NOT NULL AND $7 <> decision THEN now() ELSE decided_at END,
		       decision = COALESCE($7, decision), record = COALESCE($8, record),
		       task_impact = COALESCE($9, task_impact), scenario = COALESCE($10, scenario),
		       confusable = COALESCE($11, confusable), production = COALESCE($12, production),
		       listening = COALESCE($13, listening), writing = COALESCE($14, writing), updated_at = now()
		 WHERE id = $1 AND user_id = $2`,
		id, userID, p.Meaning, p.Reading, p.POS, p.Lang,
		p.Decision, record, p.TaskImpact, p.Scenario, p.Confusable, p.Production, p.Listening, p.Writing); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, fmt.Errorf("%w: you already have this word in that language", vocab.ErrInvalid)
		}
		return nil, fmt.Errorf("update vocab note: %w", err)
	}

	if err := applyCardState(ctx, tx, userID, id, cur, next, p); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("update vocab note: %w", err)
	}
	return s.GetNote(ctx, userID, id)
}

// applyCardState makes the note's cards follow a patch: its decision, the
// production, listening and writing cards' switches, and the learner's suspend or
// resume.
func applyCardState(ctx context.Context, tx pgx.Tx, userID, id uuid.UUID, cur, next vocab.NoteState, p vocab.NotePatch) error {
	suspend := func(kind string) error {
		_, err := tx.Exec(ctx, `
			UPDATE vocab_cards SET suspended = true, updated_at = now()
			 WHERE note_id = $1 AND user_id = $2 AND ($3 = '' OR kind = $3)`, id, userID, kind)
		if err != nil {
			return fmt.Errorf("suspend vocab cards: %w", err)
		}
		return nil
	}
	// The cards a word being learned has in review: the two every note gets,
	// and production, listening and writing when the learner asked for them.
	active := func() []string {
		kinds := vocab.CardKinds()
		if next.Production {
			kinds = append(kinds, vocab.KindProduction)
		}
		if next.Listening {
			kinds = append(kinds, vocab.KindListen)
		}
		if next.Writing {
			kinds = append(kinds, vocab.KindWrite)
		}
		return kinds
	}
	learnNow, wasLearning := vocab.HasCards(next.Decision), vocab.HasCards(cur.Decision)
	suspendAll := p.Suspended != nil && *p.Suspended
	if !learnNow || suspendAll {
		if wasLearning || suspendAll {
			return suspend("")
		}
		return nil
	}
	if !wasLearning || p.Suspended != nil {
		if err := upsertCards(ctx, tx, userID, id, active(), p.NewCard, p.Now); err != nil {
			return err
		}
	}
	for kind, on := range map[string]*bool{vocab.KindProduction: p.Production, vocab.KindListen: p.Listening, vocab.KindWrite: p.Writing} {
		var err error
		switch {
		case on == nil:
		case *on:
			err = upsertCards(ctx, tx, userID, id, []string{kind}, p.NewCard, p.Now)
		default:
			err = suspend(kind)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// ImportNotes implements vocab.ImportStore: a deck's batch, in one
// transaction under the user's row lock, so two batches cannot pace into the
// same days. Each word is inserted ON CONFLICT DO NOTHING (a word already in
// the vocabulary, in that language, is a duplicate and left as it is), and a
// created one's cards start on its day: PerDay words a day, from FirstDay or
// from the last day earlier imports still fill.
func (s *VocabStore) ImportNotes(ctx context.Context, b vocab.ImportBatch) (*vocab.ImportResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("import vocab: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck
	if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, b.UserID); err != nil {
		return nil, fmt.Errorf("lock user for import: %w", err)
	}

	// Where the earlier imports' unseen words end: the last day one first
	// comes up, and how many come up that day.
	day, used := b.FirstDay, 0
	var (
		last  *time.Time
		count int
	)
	if err := tx.QueryRow(ctx, `
		WITH pending AS (
		  SELECT c.due_at FROM vocab_cards c
		    JOIN vocab_notes n ON n.id = c.note_id AND n.user_id = c.user_id
		   WHERE c.user_id = $1 AND n.origin NOT IN ('', 'chat') AND c.kind = 'recognition' AND c.reps = 0 AND NOT c.suspended)
		SELECT max(due_at), count(*) FILTER (WHERE due_at = (SELECT max(due_at) FROM pending)) FROM pending`,
		b.UserID).Scan(&last, &count); err != nil {
		return nil, fmt.Errorf("read import pace: %w", err)
	}
	if last != nil {
		if d := learning.LocalDay(*last, b.Zone); !d.Before(b.FirstDay) {
			day, used = d, count
		}
	}

	res := &vocab.ImportResult{}
	for _, n := range b.Notes {
		contexts := []vocab.Context{}
		kinds := []string{vocab.KindRecognition}
		if n.Context != nil {
			contexts = append(contexts, *n.Context)
			kinds = append(kinds, vocab.KindCloze)
		}
		raw, _ := json.Marshal(contexts)
		var id uuid.UUID
		err := tx.QueryRow(ctx, `
			INSERT INTO vocab_notes (user_id, term, lang, meaning, contexts, decision, record, origin,
			                         decided_at, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, 'learn', '{}', $7, $6, $6, $6)
			ON CONFLICT (user_id, lang, lower(term)) DO NOTHING
			RETURNING id`, b.UserID, n.Term, b.Lang, n.Meaning, raw, b.Now, cmp.Or(b.Origin, vocab.OriginAnki)).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			res.Duplicates++
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("import vocab note: %w", err)
		}
		if used >= b.PerDay {
			day, used = vocab.AddDays(day, 1), 0
		}
		used++
		card := b.NewCard
		card.Due = learning.StartOf(day, b.Zone).UTC()
		if err := upsertCards(ctx, tx, b.UserID, id, kinds, card, b.Now); err != nil {
			return nil, err
		}
		if res.Created == 0 {
			res.FirstDay = day.String()
		}
		res.Created++
		res.LastDay = day.String()
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("import vocab: %w", err)
	}
	return res, nil
}

// CountLearnSince implements vocab.Store.
func (s *VocabStore) CountLearnSince(ctx context.Context, userID uuid.UUID, since time.Time) (int, error) {
	var n int
	if err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM vocab_notes
		 WHERE user_id = $1 AND decision = 'learn' AND decided_at >= $2
		   AND origin = ''`, userID, since).Scan(&n); err != nil {
		return 0, fmt.Errorf("count learn decisions: %w", err)
	}
	return n, nil
}

// DeleteNote implements vocab.Store; cards and reviews go by cascade.
func (s *VocabStore) DeleteNote(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM vocab_notes WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("delete vocab note: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return vocab.ErrNotFound
	}
	return nil
}

// dueSelect reads a card with what it shows. A note's cards join their note;
// a flash card has none and joins its book's block instead. Both joins name
// user_id, so a card never reads back a row of anyone else's.
const dueSelect = `
	SELECT c.id, c.note_id, c.kind, c.due_at, c.reps, c.fsrs_card,
	       COALESCE(n.term, ''), COALESCE(n.lang, ''), COALESCE(n.reading, ''), COALESCE(n.pos, ''),
	       COALESCE(n.meaning, ''), COALESCE(n.contexts, '[]'::jsonb),
	       n.source_document_id, n.source_page, d.title,
	       COALESCE(c.front, ''), COALESCE(c.back, ''), bk.id, bk.title, ch.id,
	       COALESCE(n.scenario, ''), COALESCE(n.confusable, ''), cd.id, cd.name, c.image
	  FROM vocab_cards c
	  LEFT JOIN vocab_notes n ON n.id = c.note_id AND n.user_id = c.user_id
	  LEFT JOIN documents d ON d.id = n.source_document_id AND d.user_id = n.user_id
	  LEFT JOIN book_blocks bb ON bb.id = c.book_block_id AND bb.user_id = c.user_id
	  LEFT JOIN book_chapters ch ON ch.id = bb.chapter_id AND ch.user_id = bb.user_id
	  LEFT JOIN books bk ON bk.id = ch.book_id AND bk.user_id = ch.user_id
	  LEFT JOIN card_decks cd ON cd.id = c.deck_id AND cd.user_id = c.user_id`

// deckFilter is the WHERE clause that keeps each queue to its own cards.
// langFilter narrows due cards to the words of language $3; ” is every
// language. It reads the note by id, so it holds without dueSelect's join.
const langFilter = ` AND ($3 = '' OR EXISTS (
	SELECT 1 FROM vocab_notes ln WHERE ln.id = c.note_id AND ln.user_id = c.user_id AND ln.lang = $3))`

func deckFilter(deck string) string {
	switch deck {
	case vocab.DeckBook:
		return ` AND c.kind = 'flash'`
	case vocab.DeckCards:
		return ` AND c.kind = 'card'`
	}
	return ` AND c.kind NOT IN ('flash', 'card')`
}

// scanVocabDue reads one card, and its note's contexts for a listening card
// to find its line in (attachClips).
func scanVocabDue(row pgx.Row) (*vocab.DueCard, []vocab.Context, error) {
	var (
		c         vocab.DueCard
		fsrsRaw   []byte
		contexts  []byte
		docID     *uuid.UUID
		page      *int
		title     *string
		bookID    *uuid.UUID
		bookTitle *string
		chapterID *uuid.UUID
		scenario  string
		confuse   string
		deckID    *uuid.UUID
		deckName  *string
		image     []byte
	)
	err := row.Scan(&c.ID, &c.NoteID, &c.Kind, &c.DueAt, &c.Reps, &fsrsRaw,
		&c.Term, &c.Lang, &c.Reading, &c.POS, &c.Meaning, &contexts, &docID, &page, &title,
		&c.Front, &c.Back, &bookID, &bookTitle, &chapterID, &scenario, &confuse, &deckID, &deckName, &image)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, vocab.ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("scan vocab card: %w", err)
	}
	if err := json.Unmarshal(fsrsRaw, &c.FSRS); err != nil {
		return nil, nil, fmt.Errorf("decode fsrs card: %w", err)
	}
	c.DueAt = c.DueAt.UTC()
	if len(image) > 0 {
		c.Image = &vocab.CardImage{}
		if err := json.Unmarshal(image, c.Image); err != nil {
			return nil, nil, fmt.Errorf("decode card image: %w", err)
		}
	}
	var ctxs []vocab.Context
	_ = json.Unmarshal(contexts, &ctxs)
	if len(ctxs) > 0 {
		c.Context = ctxs[0].Sentence
	}
	// A listening card whose line is gone is shown as a cloze; a writing
	// card shows the sentence with the word blanked, not given away.
	if c.Kind == vocab.KindCloze || c.Kind == vocab.KindListen || c.Kind == vocab.KindWrite {
		c.Cloze = vocab.Cloze(c.Term, c.Context)
	}
	if c.Kind == vocab.KindProduction {
		c.Scenario, c.Confusable = scenario, confuse
	}
	if docID != nil && title != nil {
		c.Source = &vocab.Source{DocumentID: *docID, Title: *title}
		if page != nil {
			c.Source.Page = *page
		}
	}
	if bookID != nil && bookTitle != nil && chapterID != nil {
		c.Book = &vocab.BookRef{BookID: *bookID, Title: *bookTitle, ChapterID: *chapterID}
	}
	if deckID != nil && deckName != nil {
		c.Deck = &vocab.DeckRef{ID: *deckID, Name: *deckName}
	}
	return &c, ctxs, nil
}

// attachClips gives each listening card the line it plays, and that line's
// sentence as its context and cloze. The contexts' documents are read with
// the owner's user_id, so a deleted or foreign one gives no clip.
func attachClips(ctx context.Context, q vocabQuerier, userID uuid.UUID, cards []vocab.DueCard, contexts [][]vocab.Context) error {
	var listen [][]vocab.Context
	for i := range cards {
		if cards[i].Kind == vocab.KindListen {
			listen = append(listen, contexts[i])
		}
	}
	if len(listen) == 0 {
		return nil
	}
	docs, err := timedDocs(ctx, q, userID, listen...)
	if err != nil {
		return err
	}
	for i := range cards {
		c := &cards[i]
		if c.Kind != vocab.KindListen {
			continue
		}
		if c.Clip = vocab.ClipOf(contexts[i], docs); c.Clip != nil {
			c.Context, c.Cloze = c.Clip.Sentence, vocab.Cloze(c.Term, c.Clip.Sentence)
		}
	}
	return nil
}

// DueCards implements vocab.Store.
func (s *VocabStore) DueCards(ctx context.Context, userID uuid.UUID, deck, lang string, before time.Time, limit int) ([]vocab.DueCard, int, error) {
	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM vocab_cards c WHERE c.user_id = $1 AND NOT c.suspended AND c.due_at < $2`+deckFilter(deck)+langFilter,
		userID, before, lang).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count due vocab cards: %w", err)
	}
	out := []vocab.DueCard{}
	if limit <= 0 || total == 0 {
		return out, total, nil
	}
	rows, err := s.pool.Query(ctx, dueSelect+`
		 WHERE c.user_id = $1 AND NOT c.suspended AND c.due_at < $2`+deckFilter(deck)+langFilter+`
		 ORDER BY c.due_at, c.created_at, c.id
		 LIMIT $4`, userID, before, lang, limit)
	if err != nil {
		return nil, 0, fmt.Errorf("due vocab cards: %w", err)
	}
	var contexts [][]vocab.Context
	for rows.Next() {
		c, ctxs, err := scanVocabDue(rows)
		if err != nil {
			rows.Close()
			return nil, 0, err
		}
		out = append(out, *c)
		contexts = append(contexts, ctxs)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	if err := attachClips(ctx, s.pool, userID, out, contexts); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

// GetCard implements vocab.Store.
func (s *VocabStore) GetCard(ctx context.Context, userID, cardID uuid.UUID) (*vocab.DueCard, error) {
	c, _, err := scanVocabDue(s.pool.QueryRow(ctx, dueSelect+` WHERE c.id = $1 AND c.user_id = $2`, cardID, userID))
	return c, err
}

// Review implements vocab.Store: record the review, reschedule the card and
// bury its siblings, in one transaction.
//
// Idempotency is the review row. The card is locked first, so two copies of
// one request serialise on it; the second's INSERT then meets the
// (user_id, request_id) constraint, returns no row, and the transaction is
// abandoned before anything is scheduled twice.
func (s *VocabStore) Review(ctx context.Context, w vocab.ReviewWrite) (*vocab.ReviewResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("vocab review: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	var (
		// nil for a flash card: it has no note, so no siblings to bury.
		noteID  *uuid.UUID
		fsrsRaw []byte
	)
	err = tx.QueryRow(ctx,
		`SELECT note_id, fsrs_card FROM vocab_cards WHERE id = $1 AND user_id = $2 FOR UPDATE`,
		w.CardID, w.UserID).Scan(&noteID, &fsrsRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, vocab.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lock vocab card: %w", err)
	}

	var reviewID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO vocab_reviews (user_id, card_id, request_id, rating, answer, matched, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (user_id, request_id) DO NOTHING
		RETURNING id`,
		w.UserID, w.CardID, w.RequestID, w.Rating, w.Answer, w.Matched, w.Now).Scan(&reviewID)
	if errors.Is(err, pgx.ErrNoRows) {
		_ = tx.Rollback(ctx)
		return s.replayed(ctx, w)
	}
	if err != nil {
		return nil, fmt.Errorf("record vocab review: %w", err)
	}

	var card learning.Card
	if err := json.Unmarshal(fsrsRaw, &card); err != nil {
		return nil, fmt.Errorf("decode fsrs card: %w", err)
	}
	next, err := w.Schedule(card)
	if err != nil {
		return nil, err
	}
	// Postgres keeps microseconds. Rounded here, the answer is the value the
	// row holds, so a replay of this request (read back from the row) answers
	// the same due_at. Linux clocks carry nanoseconds; macOS's do not.
	next.Due = next.Due.UTC().Round(time.Microsecond)
	nextRaw, _ := json.Marshal(next)
	res := &vocab.ReviewResult{
		CardID: w.CardID, Rating: w.Rating, Matched: w.Matched,
		DueAt: next.Due, Reps: int(next.Reps), Lapses: int(next.Lapses),
	}
	if _, err := tx.Exec(ctx, `
		UPDATE vocab_cards
		   SET fsrs_card = $3, due_at = $4, reps = $5, lapses = $6,
		       last_reviewed_at = $7, updated_at = $7
		 WHERE id = $1 AND user_id = $2`,
		w.CardID, w.UserID, nextRaw, next.Due, res.Reps, res.Lapses, w.Now); err != nil {
		return nil, fmt.Errorf("reschedule vocab card: %w", err)
	}

	// Siblings due today move to the start of tomorrow, so one answer does not
	// give the other away (the cloze shows the term the recognition card just
	// asked about). Only due_at moves: burying hides a card for a day, it is
	// not a review, so the FSRS state is left as it was.
	if noteID != nil {
		tag, err := tx.Exec(ctx, `
			UPDATE vocab_cards SET due_at = $4, updated_at = $5
			 WHERE note_id = $1 AND user_id = $2 AND id <> $3
			   AND NOT suspended AND due_at < $4`,
			*noteID, w.UserID, w.CardID, w.BuryUntil, w.Now)
		if err != nil {
			return nil, fmt.Errorf("bury vocab siblings: %w", err)
		}
		res.Buried = int(tag.RowsAffected())
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("vocab review: %w", err)
	}
	return res, nil
}

// replayed answers a request id that was already applied: the first review's
// rating and the card as it is now. A request id reused for a DIFFERENT card
// is a client bug, refused rather than silently answered for the wrong card.
func (s *VocabStore) replayed(ctx context.Context, w vocab.ReviewWrite) (*vocab.ReviewResult, error) {
	res := &vocab.ReviewResult{Replayed: true}
	var matched *bool
	err := s.pool.QueryRow(ctx, `
		SELECT r.card_id, r.rating, r.matched, c.due_at, c.reps, c.lapses
		  FROM vocab_reviews r
		  JOIN vocab_cards c ON c.id = r.card_id AND c.user_id = r.user_id
		 WHERE r.user_id = $1 AND r.request_id = $2`, w.UserID, w.RequestID).
		Scan(&res.CardID, &res.Rating, &matched, &res.DueAt, &res.Reps, &res.Lapses)
	if err != nil {
		return nil, fmt.Errorf("replay vocab review: %w", err)
	}
	if res.CardID != w.CardID {
		return nil, fmt.Errorf("%w: that request_id was already used for another card", vocab.ErrInvalid)
	}
	res.Matched = matched
	// pgx reads timestamptz in the server's local zone; the first answer was
	// UTC, and a replay must be the same answer.
	res.DueAt = res.DueAt.UTC()
	return res, nil
}

// ReplaceFlashCards makes a book block's flash cards exactly `cards`, inside
// the caller's transaction: the block's old cards (and their reviews) go, the
// new ones start at newCard's schedule, and they are suspended when the
// learner has taken the block out of review. The composite foreign key on
// (book_block_id, user_id) refuses a block that is not the user's.
func ReplaceFlashCards(
	ctx context.Context, tx pgx.Tx, userID, blockID uuid.UUID, cards []vocab.FlashCard,
	newCard learning.Card, suspended bool, now time.Time,
) error {
	if _, err := tx.Exec(ctx,
		`DELETE FROM vocab_cards WHERE book_block_id = $1 AND user_id = $2`, blockID, userID); err != nil {
		return fmt.Errorf("replace flash cards: %w", err)
	}
	raw, _ := json.Marshal(newCard)
	for i, c := range cards {
		// created_at a microsecond apart keeps the cards in the order written.
		at := now.Add(time.Duration(i) * time.Microsecond)
		if _, err := tx.Exec(ctx, `
			INSERT INTO vocab_cards (user_id, kind, front, back, book_block_id, fsrs_card, due_at,
			                         suspended, created_at, updated_at)
			VALUES ($1, 'flash', $2, $3, $4, $5, $6, $7, $8, $8)`,
			userID, c.Front, c.Back, blockID, raw, newCard.Due, suspended, at); err != nil {
			return fmt.Errorf("create flash card: %w", err)
		}
	}
	return nil
}

// FlashCardsOf reads a block's flash cards, owner-scoped, in the order they
// were written, and whether they are in review (not suspended).
func FlashCardsOf(ctx context.Context, q vocabQuerier, userID, blockID uuid.UUID) ([]vocab.FlashCard, bool, error) {
	rows, err := q.Query(ctx, `
		SELECT front, back, suspended FROM vocab_cards
		 WHERE book_block_id = $1 AND user_id = $2 AND kind = 'flash'
		 ORDER BY created_at, id`, blockID, userID)
	if err != nil {
		return nil, false, fmt.Errorf("flash cards: %w", err)
	}
	defer rows.Close()
	out := []vocab.FlashCard{}
	inReview := false
	for rows.Next() {
		var (
			c         vocab.FlashCard
			suspended bool
		)
		if err := rows.Scan(&c.Front, &c.Back, &suspended); err != nil {
			return nil, false, err
		}
		inReview = inReview || !suspended
		out = append(out, c)
	}
	return out, inReview, rows.Err()
}

// SetFlashInReview puts a block's flash cards in or out of the Book cards
// queue. Suspending keeps their schedule; putting them back resumes it.
func SetFlashInReview(ctx context.Context, q interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}, userID, blockID uuid.UUID, on bool) (int, error) {
	tag, err := q.Exec(ctx, `
		UPDATE vocab_cards SET suspended = $3, updated_at = now()
		 WHERE book_block_id = $1 AND user_id = $2 AND kind = 'flash'`, blockID, userID, !on)
	if err != nil {
		return 0, fmt.Errorf("flash cards in review: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// AddSentence implements vocab.SentenceStore: c becomes the note's newest
// context (a sentence already there is not repeated; at most
// vocab.MaxContexts), and a note being learned gets its cloze card.
func (s *VocabStore) AddSentence(ctx context.Context, userID, noteID uuid.UUID, c vocab.Context, newCard learning.Card, now time.Time) (*vocab.Note, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin add sentence: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	var (
		raw      []byte
		decision string
	)
	err = tx.QueryRow(ctx, `SELECT contexts, decision FROM vocab_notes WHERE id = $1 AND user_id = $2 FOR UPDATE`, noteID, userID).Scan(&raw, &decision)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, vocab.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find vocab note: %w", err)
	}
	var existing []vocab.Context
	_ = json.Unmarshal(raw, &existing)
	merged := []vocab.Context{c}
	for _, e := range existing {
		if e.Sentence != c.Sentence && len(merged) < vocab.MaxContexts {
			merged = append(merged, e)
		}
	}
	out, _ := json.Marshal(merged)
	if _, err := tx.Exec(ctx, `UPDATE vocab_notes SET contexts = $3, updated_at = $4 WHERE id = $1 AND user_id = $2`, noteID, userID, out, now); err != nil {
		return nil, fmt.Errorf("add vocab sentence: %w", err)
	}
	// A cloze card if the note has none; one it has, suspended or not, is left as it is.
	if vocab.HasCards(decision) {
		card, _ := json.Marshal(newCard)
		if _, err := tx.Exec(ctx, `
			INSERT INTO vocab_cards (user_id, note_id, kind, fsrs_card, due_at, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $6)
			ON CONFLICT (note_id, kind) DO NOTHING`,
			userID, noteID, vocab.KindCloze, card, newCard.Due, now); err != nil {
			return nil, fmt.Errorf("create vocab cloze card: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("add vocab sentence: %w", err)
	}
	return s.GetNote(ctx, userID, noteID)
}
