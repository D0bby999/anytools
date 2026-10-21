package pg_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/vocab"
)

// vocab_listen_test.go is the listening card (the private design notes, phase 1) over the real VocabStore: it is asked for on a word saved
// from a line of a video, plays that line's current timing, keeps its
// schedule when turned off and on, and reads back as a cloze once the video
// is gone.

func TestVocabTheListeningCardPlaysTheLineTheWordWasSavedFrom(t *testing.T) {
	ctx, f := newVocabFixture(t)
	n := f.decide(t, ctx, "access mechanisms", vocab.DecisionLearn, learnRecord, "how a model reaches what it knows")

	// The document is a PDF: there is no line to play.
	if n.Clip != nil {
		t.Fatalf("a PDF's word has a clip: %+v", n.Clip)
	}
	if _, err := f.svc.Update(ctx, f.alice, n.ID, vocab.NotePatch{Listening: ptr(true)}); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("listening on a word from a PDF: %v", err)
	}

	// The same document as a YouTube video whose page 2 is [12, 17] s.
	if _, err := f.pool.Exec(ctx, `
		UPDATE documents SET source_kind = 'youtube', source_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
		       media_id = 'dQw4w9WgXcQ', timeline = '[[0, 4], [12, 17]]'
		 WHERE id = $1`, f.aliceDoc); err != nil {
		t.Fatal(err)
	}
	got, err := f.svc.Get(ctx, f.alice, n.ID)
	if err != nil {
		t.Fatal(err)
	}
	if c := got.Clip; c == nil || c.VideoID != "dQw4w9WgXcQ" || c.Page != 2 || c.Start != 12 || c.End != 17 || c.DocumentID != f.aliceDoc {
		t.Fatalf("clip = %+v", got.Clip)
	}
	if _, err := f.svc.Update(ctx, f.bob, n.ID, vocab.NotePatch{Listening: ptr(true)}); !errors.Is(err, vocab.ErrNotFound) {
		t.Fatalf("Bob turning on Alice's listening card: %v", err)
	}
	on, err := f.svc.Update(ctx, f.alice, n.ID, vocab.NotePatch{Listening: ptr(true)})
	if err != nil {
		t.Fatal(err)
	}
	listen, ok := activeCards(on)[vocab.KindListen]
	if !on.Listening || !ok || len(on.Cards) != 3 {
		t.Fatalf("after opting in: listening %v, cards %+v", on.Listening, on.Cards)
	}

	due := f.dueOfKind(t, ctx, vocab.KindListen)
	if due == nil || due.Clip == nil || due.Clip.Start != 12 || due.Clip.End != 17 || due.Cloze == "" || due.Cloze == due.Context {
		t.Fatalf("the due listening card: %+v", due)
	}
	res, err := f.svc.Review(ctx, f.alice, listen.ID, vocab.ReviewInput{Rating: "good", Answer: "Access mechanisms", RequestID: uuid.New()})
	if err != nil {
		t.Fatal(err)
	}
	if res.Matched == nil || !*res.Matched {
		t.Fatalf("a typed listening answer: %+v", res)
	}

	// Re-timed: the card plays the new timing, nothing stored again.
	if _, err := f.pool.Exec(ctx, `UPDATE documents SET timeline = '[[0, 3], [20, 26]]' WHERE id = $1`, f.aliceDoc); err != nil {
		t.Fatal(err)
	}
	if got, _ := f.svc.Get(ctx, f.alice, n.ID); got.Clip == nil || got.Clip.Start != 20 {
		t.Fatalf("after re-timing: %+v", got.Clip)
	}

	// Off suspends it; on again resumes the same card with its review kept.
	off, err := f.svc.Update(ctx, f.alice, n.ID, vocab.NotePatch{Listening: ptr(false)})
	if err != nil {
		t.Fatal(err)
	}
	if _, active := activeCards(off)[vocab.KindListen]; active || off.Listening {
		t.Fatalf("listening off: %+v", off.Cards)
	}
	again, err := f.svc.Update(ctx, f.alice, n.ID, vocab.NotePatch{Listening: ptr(true)})
	if err != nil {
		t.Fatal(err)
	}
	if c := activeCards(again)[vocab.KindListen]; c.ID != listen.ID || c.Reps != 1 {
		t.Fatalf("listening on again: %+v, want the same card with its review kept", c)
	}

	// The video deleted: the card stays, shown as a cloze, and an unrelated
	// edit is not refused for it.
	if _, err := f.pool.Exec(ctx, `DELETE FROM documents WHERE id = $1`, f.aliceDoc); err != nil {
		t.Fatal(err)
	}
	// Reviewed above, so due again only in days; bring it back to today.
	if _, err := f.pool.Exec(ctx, `UPDATE vocab_cards SET due_at = $2 WHERE id = $1`, listen.ID, f.now.AddDate(0, 0, -1)); err != nil {
		t.Fatal(err)
	}
	due = f.dueOfKind(t, ctx, vocab.KindListen)
	if due == nil || due.Clip != nil || due.Cloze == "" {
		t.Fatalf("a listening card whose video is gone: %+v", due)
	}
	if _, err := f.svc.Update(ctx, f.alice, n.ID, vocab.NotePatch{Meaning: ptr("a changed meaning")}); err != nil {
		t.Fatalf("an edit after the video went: %v", err)
	}
}

// dueOfKind is Alice's first due card of that kind, or nil.
func (f *vocabFixture) dueOfKind(t *testing.T, ctx context.Context, kind string) *vocab.DueCard {
	t.Helper()
	cards, _, err := f.svc.Due(ctx, f.alice, vocab.SessionSize)
	if err != nil {
		t.Fatal(err)
	}
	for i := range cards {
		if cards[i].Kind == kind {
			return &cards[i]
		}
	}
	return nil
}
