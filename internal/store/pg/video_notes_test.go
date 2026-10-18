package pg_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/capabilities/videonotes"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

func TestVideoNotesAreOnePerLanguageAndOnlyOnTheOwnersVideo(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	kbs := pg.NewKnowledgeStore(pool)
	alice, bob := makeUser(t, pool, "alice"), makeUser(t, pool, "bob")
	kb, err := kbs.CreateKB(ctx, alice, "KB")
	if err != nil {
		t.Fatal(err)
	}
	doc := seedDocument(t, kbs, alice, kb.ID, "video")
	store := pg.NewVideoNotesStore(pool)
	at := 12.0
	notes := func(lang, summary string) videonotes.Notes {
		return videonotes.Notes{DocumentID: doc.ID, Language: lang, TranscriptSHA256: strings.Repeat("a", 64),
			Model: "m", CreatedAt: time.Now().UTC(), Sections: []videonotes.Section{{Start: 0, End: 30, Title: "t",
				Summary: summary, Points: []videonotes.Point{{Text: "p", At: &at}}}}}
	}

	if _, err := store.Save(ctx, alice, notes("vi", "first")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Save(ctx, alice, notes("vi", "second")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Save(ctx, alice, notes("en", "english")); err != nil {
		t.Fatal(err)
	}
	list, err := store.List(ctx, alice, doc.ID)
	if err != nil || len(list) != 2 {
		t.Fatalf("list = %+v %v", list, err)
	}
	for _, n := range list {
		if n.Language == "vi" && (n.Sections[0].Summary != "second" || *n.Sections[0].Points[0].At != 12) {
			t.Errorf("regenerating did not replace: %+v", n.Sections)
		}
	}

	// Bob can neither read Alice's notes nor write notes onto her video.
	if got, _ := store.List(ctx, bob, doc.ID); len(got) != 0 {
		t.Errorf("bob read alice's notes: %+v", got)
	}
	if _, err := store.Save(ctx, bob, notes("fr", "x")); err == nil || !strings.Contains(err.Error(), "video_notes_document_owner") {
		t.Errorf("bob wrote notes on alice's video: %v", err)
	}
}
