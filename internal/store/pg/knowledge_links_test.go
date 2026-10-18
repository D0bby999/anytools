package pg_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

func seedVideo(t *testing.T, store *pg.KnowledgeStore, user, kb uuid.UUID, id, status string) *knowledge.Document {
	t.Helper()
	doc, err := store.CreateLinkDocument(context.Background(), knowledge.Document{
		UserID: user, KBID: kb, SourceKind: knowledge.SourceYouTube, MediaID: id,
		SourceURL: "https://www.youtube.com/watch?v=" + id, Title: "v", MIME: "text/vtt",
		SHA256: blob.Digest([]byte(id)),
		Status: status,
	})
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

// needs_transcript is a resting state: the parse pipeline's status writes
// cannot move it, and the transcribe_video backstop moves only a video that
// is still `parsing`.
func TestNeedsTranscriptRestsAndTheTranscriptionBackstopIsNarrow(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	store := pg.NewKnowledgeStore(pool)
	user := makeUser(t, pool, "video")
	kb, err := store.CreateKB(ctx, user, "videos")
	if err != nil {
		t.Fatal(err)
	}

	waiting := seedVideo(t, store, user, kb.ID, "aaaaaaaaaaa", knowledge.StatusNeedsTranscript)
	if err := store.SetDocumentStatus(ctx, user, waiting.ID, knowledge.StatusParsing, ""); !errors.Is(err, knowledge.ErrDocumentFinal) {
		t.Fatalf("a stray parse moved a needs_transcript video: %v", err)
	}

	transcribing := seedVideo(t, store, user, kb.ID, "bbbbbbbbbbb", knowledge.StatusNeedsTranscript)
	if err := store.BeginTranscription(ctx, user, transcribing.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.BeginTranscription(ctx, user, transcribing.ID); !errors.Is(err, knowledge.ErrDocumentFinal) {
		t.Fatalf("a second transcription started: %v", err)
	}

	reap := func(doc uuid.UUID, terminal bool) {
		t.Helper()
		payload, _ := json.Marshal(knowledge.TranscribeJobPayload{DocumentID: doc})
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx) //nolint:errcheck
		if err := pg.KnowledgeReapHandler()(ctx, tx, jobs.ReapedJob{
			ID: uuid.New(), UserID: user, Kind: jobs.KindTranscribeVideo, Payload: payload, Terminal: terminal,
		}); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	status := func(id uuid.UUID) (string, string) {
		d, err := store.GetDocument(ctx, user, id)
		if err != nil {
			t.Fatal(err)
		}
		return d.Status, d.Error
	}

	reap(transcribing.ID, false)
	if st, _ := status(transcribing.ID); st != knowledge.StatusParsing {
		t.Fatalf("a job going back on the queue moved the video to %s", st)
	}
	reap(transcribing.ID, true)
	if st, msg := status(transcribing.ID); st != knowledge.StatusNeedsTranscript || msg == "" {
		t.Fatalf("a transcription that gave up left the video %s %q", st, msg)
	}
	// Settled by the learner meanwhile (a subtitle upload queued it): the
	// backstop does not touch it.
	if _, err := pool.Exec(ctx, `UPDATE documents SET status = 'queued', error = '' WHERE id = $1`, transcribing.ID); err != nil {
		t.Fatal(err)
	}
	reap(transcribing.ID, true)
	if st, _ := status(transcribing.ID); st != knowledge.StatusQueued {
		t.Fatalf("the backstop overwrote a learner's transcript: %s", st)
	}

	// Another user's video is never moved, whatever the payload says.
	other := makeUser(t, pool, "other")
	okb, _ := store.CreateKB(ctx, other, "theirs")
	theirs := seedVideo(t, store, other, okb.ID, "ccccccccccc", knowledge.StatusNeedsTranscript)
	if err := store.BeginTranscription(ctx, user, theirs.ID); err == nil {
		t.Fatal("began another user's transcription")
	}
	if err := store.MarkNeedsTranscript(ctx, user, theirs.ID, "x"); err != nil {
		t.Fatal(err)
	}
	if d, _ := store.GetDocument(ctx, other, theirs.ID); d.Error != "" {
		t.Fatalf("another user's video was written: %q", d.Error)
	}
}
