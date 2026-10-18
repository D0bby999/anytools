package book

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/runtime"
)

// compile.go writes chapters. Compiling is a job even for one chapter: up to
// eleven calls on the learner's key is too long for a request, and a job is
// resumable. Its units are fixed per chapter — the plan, then one unit per
// possible block — so a retry resumes at the first unfinished call and
// never pays twice for a block already written (jobs.RunUnits). Each unit
// stores its own output before it returns.
//
// A block whose answer breaks its rules is marked `error` and the chapter
// goes on; a provider failure fails the unit, so the job's one retry tries
// that call again, and two provider failures in a row pause the book.

// unitsPerChapter is the plan call and one unit per possible block.
const unitsPerChapter = 1 + MaxBlocks

type jobPayload struct {
	BookID     uuid.UUID   `json:"book_id"`
	ChapterIDs []uuid.UUID `json:"chapter_ids"`
}

// CompileChapter queues one chapter: its first compile, a retry of what
// failed, or — for a written chapter — a refresh of every block, each keeping
// its previous version until the new one is ready. It clears a pause: asking
// again is how the learner resumes. Refused before the outline is confirmed.
func (s *Service) CompileChapter(ctx context.Context, userID, bookID, chapterID uuid.UUID) (*Book, error) {
	ch, err := s.store.GetChapter(ctx, userID, bookID, chapterID)
	if err != nil {
		return nil, ErrNotFound
	}
	if err := s.freshness(ctx, userID, ch); err != nil {
		return nil, err
	}
	return s.compile(ctx, userID, bookID, []uuid.UUID{chapterID}, Refreshes(*ch))
}

// CompileAll queues every chapter with something left to write, as one
// background job. A stale chapter is refreshed on its own page, not here.
func (s *Service) CompileAll(ctx context.Context, userID, bookID uuid.UUID) (*Book, error) {
	return s.compile(ctx, userID, bookID, nil, false)
}

func (s *Service) compile(ctx context.Context, userID, bookID uuid.UUID, ids []uuid.UUID, refresh bool) (*Book, error) {
	b, err := s.store.GetBook(ctx, userID, bookID)
	if err != nil {
		return nil, ErrNotFound
	}
	if b.Status != StatusConfirmed {
		return nil, ErrNotConfirmed
	}
	for _, ch := range b.Chapters {
		if ch.Status == ChapterCompiling {
			return nil, ErrBusy
		}
	}
	started, err := s.store.StartCompiling(ctx, userID, bookID, ids, refresh)
	if err != nil {
		return nil, err
	}
	if len(started) == 0 {
		if ids == nil {
			return nil, ErrNothingToCompile
		}
		return nil, ErrBusy
	}
	// Two attempts: the retry resumes at the call that failed.
	jobID, err := s.queue.Enqueue(ctx, userID, JobKind, jobPayload{BookID: bookID, ChapterIDs: started}, 2)
	if err != nil {
		for _, id := range started {
			_ = s.store.FinishChapter(ctx, userID, id, ChapterError, "could not start: try again", nil, s.now().UTC())
		}
		return nil, err
	}
	if err := s.store.SetJob(ctx, userID, bookID, jobID); err != nil {
		return nil, err
	}
	return s.Get(ctx, userID, bookID)
}

// Handle is the compile_book job.
func (s *Service) Handle(ctx context.Context, job *jobs.Job) error {
	var p jobPayload
	if err := json.Unmarshal(job.Payload, &p); err != nil {
		return jobs.Terminal(fmt.Errorf("book: unreadable payload: %w", err))
	}
	b, err := s.store.GetBook(ctx, job.UserID, p.BookID)
	if err != nil {
		// Deleted while queued: nothing left to write.
		return nil
	}
	if b.PausedReason != "" {
		return jobs.Terminal(ErrPaused)
	}
	return s.queue.RunUnits(ctx, job, len(p.ChapterIDs)*unitsPerChapter, func(ctx context.Context, i int) (int, error) {
		return s.unit(ctx, b, p.ChapterIDs[i/unitsPerChapter], i%unitsPerChapter)
	})
}

// unit is one call of one chapter: step 0 plans it, step k writes block k.
// The chapter is finished on its last step.
func (s *Service) unit(ctx context.Context, b *Book, chapterID uuid.UUID, step int) (int, error) {
	ch, err := s.store.GetChapter(ctx, b.UserID, b.ID, chapterID)
	if err != nil || ch.Status != ChapterCompiling {
		return 0, nil
	}
	all, err := s.store.Blocks(ctx, b.UserID, ch.ID)
	if err != nil {
		return 0, err
	}
	model := modelBlocks(all)
	last := step == unitsPerChapter-1

	if step == 0 {
		if len(model) > 0 {
			return 0, nil
		}
		m, err := s.materialFor(ctx, b, ch)
		if err != nil {
			return 0, s.stopChapter(ctx, b, ch, err)
		}
		provider, err := s.models.ChatFor(ctx, b.UserID, "chat")
		if err != nil {
			return 0, s.failed(ctx, b, err)
		}
		planned, billed, err := s.plan(ctx, provider, b, ch, m.passages)
		switch {
		case isInvalid(err):
			if rerr := s.store.ResetFailures(ctx, b.UserID, b.ID); rerr != nil {
				return billed, rerr
			}
			return billed, s.store.FinishChapter(ctx, b.UserID, ch.ID, ChapterError,
				"the chapter plan broke a rule: "+ruleOf(err), nil, s.now().UTC())
		case err != nil:
			return billed, s.failed(ctx, b, err)
		}
		if err := s.store.ResetFailures(ctx, b.UserID, b.ID); err != nil {
			return billed, err
		}
		return billed, s.store.SavePlan(ctx, b.UserID, ch.ID, planned)
	}

	k := step - 1
	if k >= len(model) || model[k].Status == BlockReady {
		if last {
			return 0, s.finish(ctx, b, ch)
		}
		return 0, nil
	}
	m, err := s.materialFor(ctx, b, ch)
	if err != nil {
		return 0, s.stopChapter(ctx, b, ch, err)
	}
	blk := model[k]
	w, billed, err := s.write(ctx, b, ch, &blk, model[:k], m)
	switch {
	case err == nil:
		if err := s.store.ResetFailures(ctx, b.UserID, b.ID); err != nil {
			return billed, err
		}
		if err := s.store.SaveBlock(ctx, b.UserID, blk.ID, s.toWrite(blk, w)); err != nil {
			return billed, err
		}
	case isInvalid(err):
		// The provider answered; the answer was unusable. The block says why,
		// the learner can retry it, and the chapter goes on.
		if err := s.store.ResetFailures(ctx, b.UserID, b.ID); err != nil {
			return billed, err
		}
		if err := s.store.FailBlock(ctx, b.UserID, blk.ID, ruleOf(err)); err != nil {
			return billed, err
		}
	case errors.Is(err, ErrNotFound):
		return billed, jobs.Terminal(err)
	default:
		if providerFailure(err) {
			_ = s.store.FailBlock(ctx, b.UserID, blk.ID, "the model could not be reached: "+err.Error())
		}
		return billed, s.failed(ctx, b, err)
	}
	if last {
		return billed, s.finish(ctx, b, ch)
	}
	return billed, nil
}

// stopChapter ends a chapter that cannot be written — too little material —
// without failing the job, so the other chapters go on.
func (s *Service) stopChapter(ctx context.Context, b *Book, ch *Chapter, err error) error {
	if errors.Is(err, ErrThinMaterial) {
		return s.store.FinishChapter(ctx, b.UserID, ch.ID, ChapterError,
			"not enough material for this chapter", nil, s.now().UTC())
	}
	return err
}

// finish marks a chapter written and records the version of every document
// it was written from, for the "sources changed" notice.
func (s *Service) finish(ctx context.Context, b *Book, ch *Chapter) error {
	m, err := s.materialFor(ctx, b, ch)
	if err != nil && !errors.Is(err, ErrThinMaterial) {
		return err
	}
	var docs []uuid.UUID
	seen := map[uuid.UUID]bool{}
	for _, p := range m.passages {
		if !seen[p.DocumentID] {
			seen[p.DocumentID] = true
			docs = append(docs, p.DocumentID)
		}
	}
	versions, err := s.store.DocumentVersions(ctx, b.UserID, docs)
	if err != nil {
		return err
	}
	return s.store.FinishChapter(ctx, b.UserID, ch.ID, ChapterReady, "", versions, s.now().UTC())
}

// failed decides what a failed call means for the book. A provider failure
// counts towards the pause; the second in a row pauses the book and ends the
// job. Anything else (a database error, a lost lease) is the job's to retry.
func (s *Service) failed(ctx context.Context, b *Book, err error) error {
	if !providerFailure(err) {
		return err
	}
	n, rerr := s.store.RecordFailure(ctx, b.UserID, b.ID)
	if rerr != nil {
		return errors.Join(err, rerr)
	}
	if n >= MaxConsecutiveFailures {
		reason := "Paused after two provider failures in a row. Check the route in Settings, then compile again."
		if perr := s.store.Pause(ctx, b.UserID, b.ID, reason); perr != nil {
			return errors.Join(err, perr)
		}
		return jobs.Terminal(fmt.Errorf("%w: %w", ErrPaused, err))
	}
	return terminalIfFinal(err)
}

// terminalIfFinal marks what a retry cannot fix: no route, or a provider
// refusal (a 4xx other than 429).
func terminalIfFinal(err error) error {
	if errors.Is(err, runtime.ErrNoProvider) {
		return jobs.Terminal(err)
	}
	var he *providers.HTTPError
	if errors.As(err, &he) && he.Status >= 400 && he.Status < 500 && he.Status != 429 {
		return jobs.Terminal(err)
	}
	return err
}

// Regenerate rewrites one block now, in the request. The previous version
// stays in place until the new one has passed its rules; a new answer that
// breaks them leaves the old block as it was and says why.
func (s *Service) Regenerate(ctx context.Context, userID, bookID, blockID uuid.UUID) (*Block, error) {
	b, err := s.store.GetBook(ctx, userID, bookID)
	if err != nil {
		return nil, ErrNotFound
	}
	blk, ch, err := s.store.GetBlock(ctx, userID, bookID, blockID)
	if err != nil {
		return nil, ErrNotFound
	}
	if b.Status != StatusConfirmed {
		return nil, ErrNotConfirmed
	}
	if blk.Type == TypeNote {
		return nil, fmt.Errorf("%w: a note is yours; edit it instead", ErrBadRequest)
	}
	if ch.Status == ChapterCompiling {
		return nil, ErrBusy
	}
	m, err := s.materialFor(ctx, b, ch)
	if err != nil {
		return nil, err
	}
	all, err := s.store.Blocks(ctx, userID, ch.ID)
	if err != nil {
		return nil, err
	}
	var before []Block
	for _, o := range modelBlocks(all) {
		if o.Ord < blk.Ord {
			before = append(before, o)
		}
	}
	w, _, err := s.write(ctx, b, ch, blk, before, m)
	if err != nil {
		if isInvalid(err) && blk.Version == 0 {
			_ = s.store.FailBlock(ctx, userID, blk.ID, ruleOf(err))
		}
		return nil, err
	}
	if err := s.store.SaveBlock(ctx, userID, blk.ID, s.toWrite(*blk, w)); err != nil {
		return nil, err
	}
	out, _, err := s.store.GetBlock(ctx, userID, bookID, blockID)
	if err != nil {
		return nil, err
	}
	if err := s.fill(ctx, userID, out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Service) toWrite(blk Block, w *written) BlockWrite {
	raw, _ := json.Marshal(w.payload)
	out := BlockWrite{Payload: raw, Sources: w.sources, Now: s.now().UTC()}
	if blk.Type == TypeFlashCards {
		out.Flash = w.flash
		out.NewCard = s.cards.NewCard()
	}
	return out
}

// materialFor reads a chapter's passages. Its anchors are resolved with the
// owner's user_id and the book's kb_id on every use (a jsonb id has no
// foreign key): one that no longer resolves — deleted, re-indexed, or never
// the learner's — is never read, and is dropped from the chapter.
func (s *Service) materialFor(ctx context.Context, b *Book, ch *Chapter) (material, error) {
	passages, err := s.store.Material(ctx, b.UserID, b.KBID, ch.Anchors, MaterialSize)
	if err != nil {
		return material{}, err
	}
	have := map[uuid.UUID]bool{}
	for _, p := range passages {
		have[p.ChunkID] = true
	}
	kept := make([]uuid.UUID, 0, len(ch.Anchors))
	for _, a := range ch.Anchors {
		if have[a] {
			kept = append(kept, a)
		}
	}
	if len(kept) != len(ch.Anchors) {
		if err := s.store.SetAnchors(ctx, b.UserID, ch.ID, kept); err != nil {
			return material{}, err
		}
		ch.Anchors = kept
	}
	if len(passages) < MinMaterial {
		return material{}, ErrThinMaterial
	}
	return newMaterial(passages), nil
}

// modelBlocks are a chapter's planned blocks, the learner's notes aside, in
// order.
func modelBlocks(all []Block) []Block {
	out := make([]Block, 0, len(all))
	for _, b := range all {
		if b.Type != TypeNote {
			out = append(out, b)
		}
	}
	return out
}
