package pg_test

import (
	"context"
	"errors"
	"math/rand/v2"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
	"github.com/D0bby999/anytools/internal/vocab"
)

// vocab_test.go drives vocab.Service over the real VocabStore. The page text
// is page 2 of the recorded Gemini parse of the RAG paper — what the server
// actually stores for a PDF — and selections are written as pdf.js hands them
// over.

const ragSelection = "Crucially, by using pre-trained access mechanisms, the ability to access knowl- edge is present without additional training."

type vocabFixture struct {
	pool      *pgxpool.Pool
	store     *pg.VocabStore
	svc       *vocab.Service
	pages     *fakePages
	now       time.Time
	alice     uuid.UUID
	bob       uuid.UUID
	aliceKB   uuid.UUID
	aliceDoc  uuid.UUID
	bobDoc    uuid.UUID
	workspace uuid.UUID
}

// fakePages is the reading workspace's page loader: one workspace of Alice's
// that resolves to her document and to the recorded page text.
type fakePages struct {
	owner     uuid.UUID
	workspace uuid.UUID
	document  uuid.UUID
	text      string
	calls     int
}

func (f *fakePages) WorkspacePage(_ context.Context, userID, workspaceID uuid.UUID, _ int) (uuid.UUID, string, error) {
	f.calls++
	if userID != f.owner || workspaceID != f.workspace {
		return uuid.Nil, "", vocab.ErrNotFound
	}
	return f.document, f.text, nil
}

func recordedPage(t *testing.T, file string, n int) string {
	t.Helper()
	raw, err := os.ReadFile("../../rag/parse/testdata/recorded/" + file)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range knowledge.SplitPages(string(raw)) {
		if p.Number == n {
			return p.Markdown
		}
	}
	t.Fatalf("no page %d", n)
	return ""
}

func seedVocabDocument(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (kb, doc uuid.UUID) {
	t.Helper()
	store := pg.NewKnowledgeStore(pool)
	k, err := store.CreateKB(ctx, userID, "Vocabulary test")
	if err != nil {
		t.Fatal(err)
	}
	d, err := store.CreateDocument(ctx, knowledge.Document{
		UserID: userID, KBID: k.ID, SourceKind: "upload", Title: "RAG.pdf", MIME: "application/pdf",
		Bytes: 1, SHA256: strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""), PageCount: 19,
	})
	if err != nil {
		t.Fatal(err)
	}
	return k.ID, d.ID
}

func newVocabFixture(t *testing.T) (context.Context, *vocabFixture) {
	t.Helper()
	pool := testutil.TestDB(t)
	ctx := context.Background()
	f := &vocabFixture{
		pool: pool, store: pg.NewVocabStore(pool),
		alice: testutil.NewUser(t, pool), bob: testutil.NewUser(t, pool),
		now: time.Date(2026, time.September, 27, 2, 0, 0, 0, time.UTC),
	}
	f.aliceKB, f.aliceDoc = seedVocabDocument(t, ctx, pool, f.alice)
	_, f.bobDoc = seedVocabDocument(t, ctx, pool, f.bob)
	f.workspace = uuid.New()
	f.pages = &fakePages{owner: f.alice, workspace: f.workspace, document: f.aliceDoc,
		text: recordedPage(t, "rag.gemini.md", 2)}
	f.svc = vocab.NewService(vocab.Config{
		Store: f.store, Pages: f.pages, Zones: pg.NewUserStore(pool),
		Scheduler: vocab.NewScheduler(rand.New(rand.NewPCG(1, 2))),
		Now:       func() time.Time { return f.now },
	})
	return ctx, f
}

func (f *vocabFixture) save(t *testing.T, ctx context.Context, term, selection string) (*vocab.Note, bool) {
	t.Helper()
	n, created, err := f.svc.Save(ctx, f.alice, vocab.SaveInput{
		WorkspaceID: f.workspace, Page: 2, Selection: selection, Term: term, Meaning: "the meaning of " + term,
	})
	if err != nil {
		t.Fatalf("Save(%q): %v", term, err)
	}
	return n, created
}

func TestVocabSaveCreatesANoteWithTwoCards(t *testing.T) {
	ctx, f := newVocabFixture(t)
	n, created := f.save(t, ctx, "pre-trained", ragSelection)
	if !created {
		t.Fatal("first save did not create a note")
	}
	if n.Lang != "en" {
		t.Errorf("lang %q, want en (detected from the page)", n.Lang)
	}
	if len(n.Cards) != 2 || n.Cards[0].Kind != vocab.KindRecognition || n.Cards[1].Kind != vocab.KindCloze {
		t.Fatalf("cards = %+v, want recognition then cloze", n.Cards)
	}
	if len(n.Contexts) != 1 || !strings.Contains(n.Contexts[0].Sentence, "pre-trained access mechanisms") {
		t.Fatalf("contexts = %+v", n.Contexts)
	}
	if n.Source == nil || n.Source.DocumentID != f.aliceDoc || n.Source.Page != 2 || n.Source.Title != "RAG.pdf" {
		t.Fatalf("source = %+v", n.Source)
	}
	if c := n.Contexts[0]; c.DocumentID == nil || *c.DocumentID != f.aliceDoc || c.DocumentTitle != "RAG.pdf" {
		t.Fatalf("context not linked back to its document: %+v", c)
	}
}

func TestVocabSavingTwiceAddsAContextNotADuplicate(t *testing.T) {
	ctx, f := newVocabFixture(t)
	first, _ := f.save(t, ctx, "knowledge", ragSelection)
	// The same word, a different sentence on the same page, different case.
	other := "memory layers [30]. In contrast, we explore a setting where both parametric and non-parametric memory components are pre-trained and pre-loaded with extensive knowledge."
	second, created := f.save(t, ctx, "Knowledge", other)
	if created || second.ID != first.ID {
		t.Fatalf("second save created a new note (%v, %s vs %s)", created, second.ID, first.ID)
	}
	if len(second.Contexts) != 2 || !strings.Contains(second.Contexts[0].Sentence, "extensive knowledge") {
		t.Fatalf("contexts after the second save = %+v", second.Contexts)
	}
	if second.Meaning != first.Meaning || second.Term != "knowledge" {
		t.Errorf("a second save changed the learner's fields: %q/%q", second.Term, second.Meaning)
	}
	// The same sentence again is not repeated.
	third, _ := f.save(t, ctx, "knowledge", other)
	if len(third.Contexts) != 2 {
		t.Fatalf("the same sentence saved again made %d contexts", len(third.Contexts))
	}
	var notes, cards int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM vocab_notes WHERE user_id = $1`, f.alice).Scan(&notes)
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM vocab_cards WHERE user_id = $1`, f.alice).Scan(&cards)
	if notes != 1 || cards != 2 {
		t.Fatalf("%d notes and %d cards after three saves, want 1 and 2", notes, cards)
	}
}

func TestVocabSaveRefusesATermNotInTheSelection(t *testing.T) {
	ctx, f := newVocabFixture(t)
	_, _, err := f.svc.Save(ctx, f.alice, vocab.SaveInput{
		WorkspaceID: f.workspace, Page: 2, Selection: ragSelection, Term: "transformer", Meaning: "m",
	})
	if !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("a term not in the selection: %v, want ErrInvalid", err)
	}
	// Inside a word is not "in the selection" either.
	_, _, err = f.svc.Save(ctx, f.alice, vocab.SaveInput{
		WorkspaceID: f.workspace, Page: 2, Selection: ragSelection, Term: "rained", Meaning: "m",
	})
	if !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("a fragment of a word: %v, want ErrInvalid", err)
	}
}

// The check the model cannot talk its way past: the selection must be on the
// page the server stored. A selection the client invents, and a term that is
// genuinely in it, are refused.
func TestVocabSaveRefusesASelectionNotOnThePage(t *testing.T) {
	ctx, f := newVocabFixture(t)
	invented := "Serendipity is the occurrence of events by chance in a happy way."
	_, _, err := f.svc.Save(ctx, f.alice, vocab.SaveInput{
		WorkspaceID: f.workspace, Page: 2, Selection: invented, Term: "serendipity", Meaning: "luck",
	})
	if !errors.Is(err, vocab.ErrInvalid) || !strings.Contains(err.Error(), "not on this page") {
		t.Fatalf("a selection not on the page: %v, want the not-on-this-page refusal", err)
	}
	var n int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM vocab_notes WHERE user_id = $1`, f.alice).Scan(&n)
	if n != 0 {
		t.Fatal("a refused save wrote a note")
	}
}

func TestVocabSaveRefusesAnotherUsersWorkspace(t *testing.T) {
	ctx, f := newVocabFixture(t)
	_, _, err := f.svc.Save(ctx, f.bob, vocab.SaveInput{
		WorkspaceID: f.workspace, Page: 2, Selection: ragSelection, Term: "knowledge", Meaning: "m",
	})
	if !errors.Is(err, vocab.ErrNotFound) {
		t.Fatalf("Bob saving from Alice's workspace: %v, want ErrNotFound", err)
	}
}

// A context's document id is resolved with the owner's user_id on save: a
// loader that handed back another user's document is refused as not found.
func TestVocabContextDocumentIsResolvedOnSave(t *testing.T) {
	ctx, f := newVocabFixture(t)
	f.pages.document = f.bobDoc
	_, _, err := f.svc.Save(ctx, f.alice, vocab.SaveInput{
		WorkspaceID: f.workspace, Page: 2, Selection: ragSelection, Term: "knowledge", Meaning: "m",
	})
	if !errors.Is(err, vocab.ErrNotFound) {
		t.Fatalf("a context naming Bob's document: %v, want ErrNotFound", err)
	}
}

// ...and on use: a context whose document id is someone else's (written
// straight into the jsonb, as a bug or a restored backup might) reads back
// with the id dropped and nothing of Bob's in it.
func TestVocabContextDocumentIsResolvedOnUse(t *testing.T) {
	ctx, f := newVocabFixture(t)
	n, _ := f.save(t, ctx, "knowledge", ragSelection)
	if _, err := f.pool.Exec(ctx, `
		UPDATE vocab_notes SET contexts = jsonb_build_array(jsonb_build_object(
		    'sentence', 'planted', 'document_id', $2::text, 'page', 3, 'added_at', now())) || contexts
		 WHERE id = $1`, n.ID, f.bobDoc); err != nil {
		t.Fatal(err)
	}
	got, err := f.svc.Get(ctx, f.alice, n.ID)
	if err != nil {
		t.Fatal(err)
	}
	if c := got.Contexts[0]; c.Sentence != "planted" || c.DocumentID != nil || c.DocumentTitle != "" || c.Page != 0 {
		t.Fatalf("a foreign document id survived the read: %+v", c)
	}
	if c := got.Contexts[1]; c.DocumentID == nil || *c.DocumentID != f.aliceDoc {
		t.Fatalf("Alice's own context lost its document: %+v", c)
	}
	list, err := f.svc.List(ctx, f.alice, vocab.Filter{})
	if err != nil || len(list) != 1 || list[0].Contexts[0].DocumentID != nil {
		t.Fatalf("List kept the foreign id: %v %+v", err, list)
	}
}

func TestVocabNotesAreInvisibleToAnotherUser(t *testing.T) {
	ctx, f := newVocabFixture(t)
	n, _ := f.save(t, ctx, "knowledge", ragSelection)
	meaning := "stolen"
	if _, err := f.svc.Get(ctx, f.bob, n.ID); !errors.Is(err, vocab.ErrNotFound) {
		t.Errorf("Get: %v", err)
	}
	if _, err := f.svc.Update(ctx, f.bob, n.ID, vocab.NotePatch{Meaning: &meaning}); !errors.Is(err, vocab.ErrNotFound) {
		t.Errorf("Update: %v", err)
	}
	if err := f.svc.Delete(ctx, f.bob, n.ID); !errors.Is(err, vocab.ErrNotFound) {
		t.Errorf("Delete: %v", err)
	}
	if _, err := f.svc.Review(ctx, f.bob, n.Cards[0].ID, vocab.ReviewInput{Rating: "good", RequestID: uuid.New()}); !errors.Is(err, vocab.ErrNotFound) {
		t.Errorf("Review: %v", err)
	}
	if list, _ := f.svc.List(ctx, f.bob, vocab.Filter{}); len(list) != 0 {
		t.Errorf("Bob's list has %d notes", len(list))
	}
	if cards, total, _ := f.svc.Due(ctx, f.bob, 50); len(cards) != 0 || total != 0 {
		t.Errorf("Bob has %d due", total)
	}
	got, _ := f.svc.Get(ctx, f.alice, n.ID)
	if got.Meaning == meaning {
		t.Error("Bob's update landed")
	}
}

func TestVocabReviewIsIdempotentByRequestID(t *testing.T) {
	ctx, f := newVocabFixture(t)
	n, _ := f.save(t, ctx, "knowledge", ragSelection)
	card := n.Cards[0].ID
	req := uuid.New()

	first, err := f.svc.Review(ctx, f.alice, card, vocab.ReviewInput{Rating: "good", RequestID: req})
	if err != nil || first.Replayed {
		t.Fatalf("first review: %+v %v", first, err)
	}
	f.now = f.now.Add(time.Hour)
	again, err := f.svc.Review(ctx, f.alice, card, vocab.ReviewInput{Rating: "again", RequestID: req})
	if err != nil {
		t.Fatal(err)
	}
	if !again.Replayed || again.Rating != "good" || !again.DueAt.Equal(first.DueAt) || again.Reps != first.Reps {
		t.Fatalf("a replayed request rescheduled the card: first %+v, replay %+v", first, again)
	}
	var reviews int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM vocab_reviews WHERE card_id = $1`, card).Scan(&reviews)
	if reviews != 1 {
		t.Fatalf("%d review rows for one request id", reviews)
	}
	// The same request id on another card is a client bug, refused.
	if _, err := f.svc.Review(ctx, f.alice, n.Cards[1].ID, vocab.ReviewInput{Rating: "good", RequestID: req}); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("a request id reused for another card: %v", err)
	}
}

func TestVocabReviewingOneCardBuriesItsSiblingUntilTheLearnersTomorrow(t *testing.T) {
	ctx, f := newVocabFixture(t)
	// 20:00 UTC on the 27th is 03:00 on the 28th in Hanoi: "tomorrow" there
	// starts at 00:00 on the 29th, 17:00 UTC on the 28th. In UTC it would be
	// 00:00 on the 28th — the difference is the learner's zone.
	if _, err := pg.NewUserStore(f.pool).SetTimezone(ctx, f.alice, "Asia/Ho_Chi_Minh", false); err != nil {
		t.Fatal(err)
	}
	f.now = time.Date(2026, time.September, 27, 20, 0, 0, 0, time.UTC)
	n, _ := f.save(t, ctx, "knowledge", ragSelection)

	res, err := f.svc.Review(ctx, f.alice, n.Cards[0].ID, vocab.ReviewInput{Rating: "good", RequestID: uuid.New()})
	if err != nil {
		t.Fatal(err)
	}
	if res.Buried != 1 {
		t.Fatalf("buried %d siblings, want 1", res.Buried)
	}
	got, _ := f.svc.Get(ctx, f.alice, n.ID)
	want := time.Date(2026, time.September, 28, 17, 0, 0, 0, time.UTC)
	if cloze := got.Cards[1]; !cloze.DueAt.Equal(want) || cloze.Reps != 0 {
		t.Fatalf("the cloze sibling is due %v (reps %d), want %v with no review", cloze.DueAt, cloze.Reps, want)
	}
	// Nothing of that note is due for the rest of the learner's today.
	cards, _, _ := f.svc.Due(ctx, f.alice, 50)
	for _, c := range cards {
		if c.NoteID != nil && *c.NoteID == n.ID && c.Kind == vocab.KindCloze {
			t.Fatal("the buried cloze card is still in today's session")
		}
	}
	// A sibling not due today is left where it is.
	res2, err := f.svc.Review(ctx, f.alice, n.Cards[0].ID, vocab.ReviewInput{Rating: "good", RequestID: uuid.New()})
	if err != nil || res2.Buried != 0 {
		t.Fatalf("a sibling already due tomorrow was buried again: %+v %v", res2, err)
	}
}

func TestVocabDueIsOldestFirstAndCapped(t *testing.T) {
	ctx, f := newVocabFixture(t)
	words := strings.Fields("Crucially using pre-trained access mechanisms ability knowledge present without additional training")
	for _, w := range words {
		f.now = f.now.Add(time.Minute)
		f.save(t, ctx, w, ragSelection)
	}
	f.now = f.now.Add(time.Hour)
	cards, total, err := f.svc.Due(ctx, f.alice, 50)
	if err != nil {
		t.Fatal(err)
	}
	if total != 2*len(words) || len(cards) != total {
		t.Fatalf("%d cards, total %d, want %d", len(cards), total, 2*len(words))
	}
	for i := 1; i < len(cards); i++ {
		if cards[i].DueAt.Before(cards[i-1].DueAt) {
			t.Fatalf("card %d is due before card %d", i, i-1)
		}
	}
	if cards[0].Term != "crucially" && cards[0].Term != "Crucially" {
		t.Fatalf("the oldest card is %q, want the first word saved", cards[0].Term)
	}
	// The cap: at most vocab.SessionSize, total still counts everything.
	for g := 0; g < 60; g++ {
		var id uuid.UUID
		if err := f.pool.QueryRow(ctx,
			`INSERT INTO vocab_notes (user_id, term, lang, meaning) VALUES ($1, $2, 'en', 'm') RETURNING id`,
			f.alice, "w"+uuid.NewString()[:8]).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(ctx,
			`INSERT INTO vocab_cards (user_id, note_id, kind, due_at) VALUES ($1, $2, 'cloze', $3)`,
			f.alice, id, f.now.Add(-time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	cards, total, err = f.svc.Due(ctx, f.alice, 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(cards) != vocab.SessionSize || total != 2*len(words)+60 {
		t.Fatalf("session of %d (total %d), want %d of %d", len(cards), total, vocab.SessionSize, 2*len(words)+60)
	}
	if _, count, _ := f.svc.Due(ctx, f.alice, 0); count != total {
		t.Fatalf("the count-only form says %d", count)
	}
}

func TestVocabClozeReviewRecordsAnAccentInsensitiveMatch(t *testing.T) {
	ctx, f := newVocabFixture(t)
	f.pages.text = "Học máy là một lĩnh vực của trí tuệ nhân tạo, nghiên cứu các thuật toán."
	n, _, err := f.svc.Save(ctx, f.alice, vocab.SaveInput{WorkspaceID: f.workspace, Page: 1,
		Selection: "Học máy là một lĩnh vực của trí tuệ nhân tạo", Term: "trí tuệ", Meaning: "intelligence"})
	if err != nil {
		t.Fatal(err)
	}
	if n.Lang != "vi" {
		t.Errorf("detected %q, want vi", n.Lang)
	}
	due, _, _ := f.svc.Due(ctx, f.alice, 50)
	var cloze *vocab.DueCard
	for i := range due {
		if due[i].Kind == vocab.KindCloze {
			cloze = &due[i]
		}
	}
	if cloze == nil || cloze.Cloze != "Học máy là một lĩnh vực của _____ nhân tạo" {
		t.Fatalf("cloze card = %+v", cloze)
	}
	res, err := f.svc.Review(ctx, f.alice, cloze.ID, vocab.ReviewInput{Rating: "good", Answer: "tri tue", RequestID: uuid.New()})
	if err != nil || res.Matched == nil || !*res.Matched {
		t.Fatalf("an unaccented answer did not match: %+v %v", res, err)
	}
	if vocab.SuggestedRating("tri tue", "trí tuệ") != learning.RatingGood || vocab.SuggestedRating("tri", "trí tuệ") != learning.RatingAgain {
		t.Fatal("suggested ratings are wrong")
	}
}

func TestVocabUpdateSuspendAndDelete(t *testing.T) {
	ctx, f := newVocabFixture(t)
	n, _ := f.save(t, ctx, "knowledge", ragSelection)
	meaning, suspended := "facts and skills", true
	got, err := f.svc.Update(ctx, f.alice, n.ID, vocab.NotePatch{Meaning: &meaning, Suspended: &suspended})
	if err != nil || got.Meaning != meaning || !got.Suspended {
		t.Fatalf("update: %+v %v", got, err)
	}
	if _, total, _ := f.svc.Due(ctx, f.alice, 50); total != 0 {
		t.Fatalf("%d suspended cards are due", total)
	}
	list, _ := f.svc.List(ctx, f.alice, vocab.Filter{Q: "skills"})
	if len(list) != 1 {
		t.Fatalf("search by meaning found %d", len(list))
	}
	if list, _ := f.svc.List(ctx, f.alice, vocab.Filter{Q: "%"}); len(list) != 0 {
		t.Fatal("a % in the search matched everything")
	}
	if list, _ := f.svc.List(ctx, f.alice, vocab.Filter{Lang: "vi"}); len(list) != 0 {
		t.Fatal("the language filter is ignored")
	}
	bad := "english"
	if _, err := f.svc.Update(ctx, f.alice, n.ID, vocab.NotePatch{Lang: &bad}); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("a bad language: %v", err)
	}
	if err := f.svc.Delete(ctx, f.alice, n.ID); err != nil {
		t.Fatal(err)
	}
	var cards int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM vocab_cards WHERE note_id = $1`, n.ID).Scan(&cards)
	if cards != 0 {
		t.Fatal("deleting a note left its cards")
	}
}

// Red team SF-11: the composite FK to documents is ON DELETE SET NULL
// (source_document_id). Deleting the source document, then its knowledge
// base, then the account must each succeed while a note exists, and the note
// must survive the first two without its source.
func TestVocabNoteOutlivesItsSourceDocumentAndKnowledgeBase(t *testing.T) {
	ctx, f := newVocabFixture(t)
	n, _ := f.save(t, ctx, "knowledge", ragSelection)
	kbs := pg.NewKnowledgeStore(f.pool)

	if err := kbs.DeleteDocument(ctx, f.alice, f.aliceKB, f.aliceDoc); err != nil {
		t.Fatalf("deleting the source document failed while a note exists: %v", err)
	}
	got, err := f.svc.Get(ctx, f.alice, n.ID)
	if err != nil {
		t.Fatalf("the note did not survive its document: %v", err)
	}
	var src *uuid.UUID
	_ = f.pool.QueryRow(ctx, `SELECT source_document_id FROM vocab_notes WHERE id = $1`, n.ID).Scan(&src)
	if src != nil || got.Source != nil || got.Contexts[0].DocumentID != nil {
		t.Fatalf("the deleted document is still linked: %v %+v %+v", src, got.Source, got.Contexts[0])
	}

	// A second document in the same knowledge base, a second note from it,
	// then the whole knowledge base.
	d2, err := kbs.CreateDocument(ctx, knowledge.Document{UserID: f.alice, KBID: f.aliceKB, SourceKind: "upload",
		Title: "b.pdf", MIME: "application/pdf", Bytes: 1, SHA256: strings.Repeat("c", 64)})
	if err != nil {
		t.Fatal(err)
	}
	f.pages.document = d2.ID
	n2, _ := f.save(t, ctx, "training", ragSelection)
	if err := kbs.DeleteKB(ctx, f.alice, f.aliceKB); err != nil {
		t.Fatalf("deleting the knowledge base failed while a note exists: %v", err)
	}
	if got, err := f.svc.Get(ctx, f.alice, n2.ID); err != nil || got.Source != nil {
		t.Fatalf("the note did not survive its knowledge base: %+v %v", got, err)
	}

	// And the account, with a document-linked note in place.
	_, d3 := seedVocabDocument(t, ctx, f.pool, f.alice)
	f.pages.document = d3
	f.save(t, ctx, "additional", ragSelection)
	if _, err := f.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, f.alice); err != nil {
		t.Fatalf("deleting the account failed while a note exists: %v", err)
	}
	var left int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM vocab_notes WHERE user_id = $1`, f.alice).Scan(&left)
	if left != 0 {
		t.Fatalf("%d notes outlived the account", left)
	}
}

// The store refuses another user's card on its own, not only because the
// service read the card first: Review locks the card with user_id.
func TestVocabStoreReviewRefusesAnotherUsersCard(t *testing.T) {
	ctx, f := newVocabFixture(t)
	n, _ := f.save(t, ctx, "knowledge", ragSelection)
	_, err := f.store.Review(ctx, vocab.ReviewWrite{
		UserID: f.bob, CardID: n.Cards[0].ID, RequestID: uuid.New(), Rating: "good",
		Now: f.now, BuryUntil: f.now.Add(24 * time.Hour),
		Schedule: func(c learning.Card) (learning.Card, error) { return c, nil },
	})
	if !errors.Is(err, vocab.ErrNotFound) {
		t.Fatalf("Bob reviewing Alice's card in the store: %v, want ErrNotFound", err)
	}
	var reviews int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM vocab_reviews WHERE card_id = $1`, n.Cards[0].ID).Scan(&reviews)
	if reviews != 0 {
		t.Fatal("a refused review was recorded")
	}
}
