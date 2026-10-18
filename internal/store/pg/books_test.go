package pg_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/capabilities/book"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
	"github.com/D0bby999/anytools/internal/vocab"
)

// books_test.go drives book.Service over the real stores, the real question
// bank and the real job queue, with a scripted model. No live model runs.

// bookModel answers each of the book's calls by the prompt it was sent.
type bookModel struct {
	mu    sync.Mutex
	calls []string
	users []string
	// replies override the default answer for a kind of call; fail, when it
	// returns an error, fails the call instead.
	replies map[string]string
	fail    func(kind string, n int) error
}

var quizChunkID = regexp.MustCompile(`id="chunk:([0-9a-f-]{36})"`)

func classify(system string) string {
	switch {
	case strings.Contains(system, "You propose the outline"):
		return "propose"
	case strings.Contains(system, "You plan one chapter"):
		return "plan"
	case strings.Contains(system, "You draw ONE diagram"):
		return "diagram"
	case strings.Contains(system, "writing questions from a plan"):
		return "quiz"
	}
	for _, kind := range []string{"text", "callout", "worked_example", "flash_cards", "summary"} {
		if strings.Contains(system, "This block is `"+kind+"`") {
			return kind
		}
	}
	return "unknown"
}

func (m *bookModel) Chat(_ context.Context, req runtime.ChatRequest) (*runtime.ChatResponse, error) {
	system, user := req.Messages[0].Content, req.Messages[len(req.Messages)-1].Content
	kind := classify(system)
	m.mu.Lock()
	m.calls = append(m.calls, kind)
	m.users = append(m.users, user)
	n := 0
	for _, c := range m.calls {
		if c == kind {
			n++
		}
	}
	fail, reply := m.fail, m.replies[kind]
	m.mu.Unlock()
	if fail != nil {
		if err := fail(kind, n); err != nil {
			return nil, err
		}
	}
	if reply == "" {
		reply = defaultReply(kind, user)
	}
	return &runtime.ChatResponse{Content: reply}, nil
}

func (m *bookModel) ChatStream(ctx context.Context, req runtime.ChatRequest, _ func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
	return m.Chat(ctx, req)
}
func (m *bookModel) DefaultModel() string { return "fake-1" }
func (m *bookModel) Name() string         { return "fake" }

func (m *bookModel) count(kind string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, c := range m.calls {
		if kind == "" || c == kind {
			n++
		}
	}
	return n
}

func (m *bookModel) sawText(s string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range m.users {
		if strings.Contains(u, s) {
			return true
		}
	}
	return false
}

func defaultReply(kind, user string) string {
	switch kind {
	case "propose":
		return `{"title":"Retrieval, from the ground up","audience":"Learners new to RAG","chapters":[
			{"title":"What retrieval is","objectives":["explain retrieval"],"prerequisites":[],"anchors":["C1","C2"]},
			{"title":"Indexing","objectives":["describe an index"],"prerequisites":[1],"anchors":["C3"]},
			{"title":"Ranking","objectives":["compare rankers"],"prerequisites":[1,2],"anchors":["C4"]},
			{"title":"Writing answers","objectives":["cite sources"],"prerequisites":[3],"anchors":["C5","C6"]}]}`
	case "plan":
		return `{"blocks":[
			{"type":"text","title":"The idea","brief":"Explain retrieval."},
			{"type":"diagram","title":"The flow","brief":"Draw the pipeline."},
			{"type":"quiz","title":"Check","brief":"Retrieval basics."},
			{"type":"worked_example","title":"An example","brief":"Walk a query through."},
			{"type":"flash_cards","title":"Terms","brief":"Key terms."},
			{"type":"summary","title":"Summary","brief":"Recap."}]}`
	case "text":
		return `{"markdown":"Retrieval finds the passages first. [[cite:chunk:C1]] The model then writes. [[cite:chunk:C99]]"}`
	case "callout":
		return `{"variant":"tip","title":"Tip","markdown":"Cite what you use. [[cite:chunk:C1]]"}`
	case "worked_example":
		return `{"problem":"Answer a question from notes.","steps":["Search the index. [[cite:chunk:C1]]","Write from the hits."],"answer":"A cited answer."}`
	case "flash_cards":
		return `{"cards":[{"front":"What is retrieval?","back":"Finding passages."},{"front":"What is a chunk?","back":"A piece of a document."},{"front":"What is cited?","back":"The passage used."}],"source_ids":["C1"]}`
	case "summary":
		return `{"markdown":"- Retrieval comes first. [[cite:chunk:C2]]"}`
	case "diagram":
		return `{"kind":"mermaid","source":"flowchart TD\n  A[Question] --> B[Retrieve]\n  B --> C[Answer]","caption":"The pipeline."}`
	case "quiz":
		ids := quizChunkID.FindAllStringSubmatch(user, 1)
		chunk := ""
		if len(ids) > 0 {
			chunk = ids[0][1]
		}
		return fmt.Sprintf(`{"questions":[{"prompt":"What happens first in retrieval-augmented generation?","type":"mcq",
			"options":[{"label":"A","body":"Retrieval"},{"label":"B","body":"Writing"},{"label":"C","body":"Ranking"},{"label":"D","body":"Nothing"}],
			"answer":"A","explanation":"Retrieval comes first. [[cite:chunk:%s]]","difficulty":"easy","chunk_ids":["%s"]}],"note":""}`, chunk, chunk)
	}
	return `{}`
}

type bookResolver struct{ model *bookModel }

func (r bookResolver) ChatFor(context.Context, uuid.UUID, string) (runtime.ChatProvider, error) {
	return r.model, nil
}

type bookAuthz struct{ *authz.Authorizer }

// claimedQueue is the real queue, except that a job is inserted already
// claimed by this test: no worker of another package's test sharing the
// database can take it, and the test runs its attempts itself.
type claimedQueue struct {
	*jobs.Queue
	pool   *pgxpool.Pool
	worker string
}

func (q claimedQueue) Enqueue(ctx context.Context, userID uuid.UUID, kind string, payload any, maxAttempts int) (uuid.UUID, error) {
	raw, _ := json.Marshal(payload)
	var id uuid.UUID
	err := q.pool.QueryRow(ctx, `
		INSERT INTO jobs (user_id, kind, payload, max_attempts, status, locked_by, lease_expires_at, attempts)
		VALUES ($1, $2, $3, $4, 'running', $5, now() + interval '1 hour', 1) RETURNING id`,
		userID, kind, raw, maxAttempts, q.worker).Scan(&id)
	return id, err
}

type bookFixture struct {
	pool   *pgxpool.Pool
	store  *pg.BookStore
	svc    *book.Service
	model  *bookModel
	queue  claimedQueue
	vocab  *vocab.Service
	user   uuid.UUID
	kb     uuid.UUID
	doc    uuid.UUID
	chunks []uuid.UUID
}

// seedBookKB gives a user a knowledge base with one document of n chunks.
func seedBookKB(t *testing.T, pool *pgxpool.Pool, user uuid.UUID, n int, text string) (kb, doc uuid.UUID, chunks []uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	ks := pg.NewKnowledgeStore(pool)
	k, err := ks.CreateKB(ctx, user, "Retrieval notes")
	if err != nil {
		t.Fatal(err)
	}
	d, err := ks.CreateDocument(ctx, knowledge.Document{
		UserID: user, KBID: k.ID, SourceKind: "upload", Title: "Notes.pdf", MIME: "application/pdf",
		Bytes: 1, SHA256: strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""), Status: "ready",
	})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < n; i++ {
		var id uuid.UUID
		if err := pool.QueryRow(ctx, `
			INSERT INTO chunks (user_id, kb_id, document_id, ord, page_start, page_end, text, dims)
			VALUES ($1, $2, $3, $4, $5, $5, $6, 1536) RETURNING id`,
			user, k.ID, d.ID, i, i+1, fmt.Sprintf("%s (passage %d)", text, i+1)).Scan(&id); err != nil {
			t.Fatal(err)
		}
		chunks = append(chunks, id)
	}
	return k.ID, d.ID, chunks
}

func newBookFixture(t *testing.T) (context.Context, *bookFixture) {
	t.Helper()
	pool := testutil.TestDB(t)
	f := &bookFixture{pool: pool, store: pg.NewBookStore(pool), model: &bookModel{replies: map[string]string{}},
		user: testutil.NewUser(t, pool)}
	f.kb, f.doc, f.chunks = seedBookKB(t, pool, f.user, 8, "Retrieval-augmented generation finds passages")
	q := jobs.NewQueue(pool, time.Minute)
	q.OnGaveUp(pg.BookReapHandler())
	f.queue = claimedQueue{Queue: q, pool: pool, worker: "books-test-" + uuid.NewString()[:8]}
	f.vocab = vocab.NewService(vocab.Config{Store: pg.NewVocabStore(pool), Zones: pg.NewUserStore(pool)})
	f.svc = book.NewService(book.Deps{
		Store:  f.store,
		Models: bookResolver{f.model},
		Quiz: quiz.NewService(quiz.Config{Store: pg.NewQuestionStore(pool), Providers: bookResolver{f.model},
			Authz: bookAuthz{authz.New(pg.NewKnowledgeStore(pool))}}),
		Cards: f.vocab,
		Queue: f.queue,
	})
	return context.Background(), f
}

// confirmed proposes and confirms a book, returning it.
func (f *bookFixture) confirmed(t *testing.T, ctx context.Context) *book.Book {
	t.Helper()
	b, err := f.svc.Create(ctx, f.user, book.CreateRequest{KBID: f.kb, Chapters: 4})
	if err != nil {
		t.Fatal(err)
	}
	if b, err = f.svc.Confirm(ctx, f.user, b.ID); err != nil {
		t.Fatal(err)
	}
	return b
}

// attempt runs one attempt of the book's current job, as the worker would.
func (f *bookFixture) attempt(t *testing.T, ctx context.Context, bookID uuid.UUID) (*jobs.Job, error) {
	t.Helper()
	b, err := f.store.GetBook(ctx, f.user, bookID)
	if err != nil || b.JobID == nil {
		t.Fatalf("no job on the book: %v", err)
	}
	job, err := f.queue.Get(ctx, *b.JobID)
	if err != nil {
		t.Fatal(err)
	}
	job.WorkerID = f.queue.worker
	return job, f.svc.Handle(ctx, job)
}

func TestABookIsConfirmedBeforeAnythingIsWritten(t *testing.T) {
	ctx, f := newBookFixture(t)
	b, err := f.svc.Create(ctx, f.user, book.CreateRequest{KBID: f.kb, Goal: "build a RAG app", Chapters: 4})
	if err != nil {
		t.Fatal(err)
	}
	if b.Status != book.StatusProposed || len(b.Proposal.Chapters) != 4 || len(b.Chapters) != 0 {
		t.Fatalf("proposal = %+v", b)
	}
	if got := b.Proposal.Chapters[0].Anchors; len(got) != 2 || got[0] != f.chunks[0] {
		t.Fatalf("anchors were not mapped to the outline's chunks: %v", got)
	}
	if f.model.count("") != 1 {
		t.Fatalf("%d calls for a proposal", f.model.count(""))
	}

	// Nothing compiles before confirmation: not the book, and there are no
	// chapters to name.
	if _, err := f.svc.CompileAll(ctx, f.user, b.ID); !errors.Is(err, book.ErrNotConfirmed) {
		t.Fatalf("compile before confirm: %v", err)
	}
	var jobsFor int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE user_id = $1`, f.user).Scan(&jobsFor)
	if jobsFor != 0 || f.model.count("") != 1 {
		t.Fatalf("a compile ran before confirmation: %d jobs, %d calls", jobsFor, f.model.count(""))
	}

	// The learner edits: reorders, renames, cuts a chapter.
	chs := b.Proposal.Chapters
	edit := book.EditRequest{Title: "My RAG book", Chapters: []book.ProposedChapter{
		{Title: "Indexing first", Objectives: chs[1].Objectives, Anchors: chs[1].Anchors},
		{Title: chs[0].Title, Objectives: chs[0].Objectives, Prereqs: []int{1}, Anchors: chs[0].Anchors},
		{Title: chs[3].Title, Objectives: chs[3].Objectives, Prereqs: []int{1, 2}, Anchors: chs[3].Anchors},
	}}
	b, err = f.svc.UpdateProposal(ctx, f.user, b.ID, edit)
	if err != nil {
		t.Fatal(err)
	}
	if b.Title != "My RAG book" || len(b.Proposal.Chapters) != 3 || b.Proposal.Chapters[0].Title != "Indexing first" {
		t.Fatalf("edit = %+v", b.Proposal)
	}

	// A prerequisite pointing forward is refused.
	forward := edit
	forward.Chapters = append([]book.ProposedChapter{}, edit.Chapters...)
	forward.Chapters[0].Prereqs = []int{2}
	if _, err := f.svc.UpdateProposal(ctx, f.user, b.ID, forward); !errors.Is(err, book.ErrBadRequest) {
		t.Fatalf("forward prerequisite: %v", err)
	}
	// Another user's chunk answers as a missing one.
	other := testutil.NewUser(t, f.pool)
	_, _, theirs := seedBookKB(t, f.pool, other, 1, "Someone else's secret passage")
	for _, anchor := range []uuid.UUID{theirs[0], uuid.New()} {
		foreign := edit
		foreign.Chapters = append([]book.ProposedChapter{}, edit.Chapters...)
		foreign.Chapters[0].Anchors = []uuid.UUID{anchor}
		if _, err := f.svc.UpdateProposal(ctx, f.user, b.ID, foreign); !errors.Is(err, book.ErrNotFound) {
			t.Fatalf("an anchor that is not the learner's: %v", err)
		}
	}

	// Confirming creates the chapters and compiles none of them.
	b, err = f.svc.Confirm(ctx, f.user, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if b.Status != book.StatusConfirmed || len(b.Chapters) != 3 || b.Chapters[1].Prereqs[0] != 1 {
		t.Fatalf("confirmed = %+v", b)
	}
	for _, ch := range b.Chapters {
		if ch.Status != book.ChapterPending || ch.Blocks != 0 || ch.EstimatedCalls != 1+book.MaxBlocks {
			t.Fatalf("chapter after confirm = %+v", ch)
		}
	}
	if f.model.count("") != 1 {
		t.Fatalf("confirming called the model: %d calls", f.model.count(""))
	}
	if _, err := f.svc.UpdateProposal(ctx, f.user, b.ID, edit); !errors.Is(err, book.ErrNotEditable) {
		t.Fatalf("edit after confirm: %v", err)
	}
}

// A proposal whose anchors name a passage it was not given is refused, even
// after the one repair.
func TestAProposalAnchoredOutsideTheOutlineIsRefused(t *testing.T) {
	ctx, f := newBookFixture(t)
	f.model.replies["propose"] = `{"title":"T","audience":"","chapters":[
		{"title":"a","objectives":["o"],"prerequisites":[],"anchors":["C1"]},
		{"title":"b","objectives":["o"],"prerequisites":[],"anchors":["C1"]},
		{"title":"c","objectives":["o"],"prerequisites":[],"anchors":["C1"]},
		{"title":"d","objectives":["o"],"prerequisites":[],"anchors":["C404"]}]}`
	if _, err := f.svc.Create(ctx, f.user, book.CreateRequest{KBID: f.kb, Chapters: 4}); !errors.Is(err, book.ErrInvalidOutput) {
		t.Fatalf("err = %v", err)
	}
	if n := f.model.count("propose"); n != 2 {
		t.Fatalf("%d proposal calls, want one and one repair", n)
	}
	var n int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM books WHERE user_id = $1`, f.user).Scan(&n)
	if n != 0 {
		t.Fatal("a refused proposal was stored")
	}
}

func TestCompilingAChapterWritesItsBlocksCardsAndQuestions(t *testing.T) {
	ctx, f := newBookFixture(t)
	b := f.confirmed(t, ctx)
	ch := b.Chapters[0]
	if _, err := f.svc.CompileChapter(ctx, f.user, b.ID, ch.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.CompileChapter(ctx, f.user, b.ID, b.Chapters[1].ID); !errors.Is(err, book.ErrBusy) {
		t.Fatalf("a second compile while one runs: %v", err)
	}
	if _, err := f.attempt(t, ctx, b.ID); err != nil {
		t.Fatal(err)
	}

	view, err := f.svc.Chapter(ctx, f.user, b.ID, ch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Chapter.Status != book.ChapterReady || view.Chapter.Ready != 6 || view.Chapter.Stale {
		t.Fatalf("chapter = %+v", view.Chapter)
	}
	// One plan and one call per block, the quiz's on the quiz route.
	if f.model.count("plan") != 1 || f.model.count("") != 1+1+6 || f.model.count("quiz") != 1 {
		t.Fatalf("calls = %v", f.model.calls)
	}
	byType := map[string]book.Block{}
	for _, blk := range view.Blocks {
		if blk.Status != book.BlockReady || blk.Version != 1 {
			t.Fatalf("block %s = %s v%d (%s)", blk.Type, blk.Status, blk.Version, blk.Error)
		}
		byType[blk.Type] = blk
	}
	// The invented citation is gone; the real one names the chunk.
	var text book.MarkdownPayload
	_ = json.Unmarshal(byType[book.TypeText].Payload, &text)
	if strings.Contains(text.Markdown, "C99") || !strings.Contains(text.Markdown, "[[cite:chunk:"+f.chunks[0].String()+"]]") {
		t.Fatalf("text = %q", text.Markdown)
	}
	// The quiz wrote real questions into the bank, under the book's kb_id.
	quizBlock := byType[book.TypeQuiz]
	if len(quizBlock.Questions) != 1 || quizBlock.Questions[0]["kb_id"] != f.kb || quizBlock.Questions[0]["revealed"] != false {
		t.Fatalf("quiz = %+v", quizBlock.Questions)
	}
	var inBank int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM questions WHERE user_id = $1 AND kb_id = $2`, f.user, f.kb).Scan(&inBank)
	if inBank != 1 {
		t.Fatalf("%d questions in the bank", inBank)
	}
	// The flash cards are flash rows of the card table, in the Book cards
	// queue and never in Vocabulary.
	flash := byType[book.TypeFlashCards]
	if len(flash.Cards) != 3 || flash.InReview == nil || !*flash.InReview {
		t.Fatalf("flash = %+v", flash)
	}
	var rows int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM vocab_cards WHERE user_id = $1 AND kind = 'flash'
		AND note_id IS NULL AND book_block_id = $2 AND front <> '' AND back <> ''`, f.user, flash.ID).Scan(&rows)
	if rows != 3 {
		t.Fatalf("%d flash rows", rows)
	}
	if words, n, _ := f.vocab.Due(ctx, f.user, 50); len(words) != 0 || n != 0 {
		t.Fatalf("flash cards in the Vocabulary queue: %d", n)
	}
	cards, n, err := f.vocab.DueDeck(ctx, f.user, vocab.DeckBook, 50)
	if err != nil || n != 3 || cards[0].Front == "" || cards[0].Book == nil || cards[0].Book.BookID != b.ID {
		t.Fatalf("book deck = %+v (%d, %v)", cards, n, err)
	}
	// Reviewed by the vocabulary's own path, with no sibling to bury.
	res, err := f.vocab.Review(ctx, f.user, cards[0].ID, vocab.ReviewInput{Rating: "good", RequestID: uuid.New()})
	if err != nil || res.Reps != 1 || res.Buried != 0 {
		t.Fatalf("review = %+v, %v", res, err)
	}
	// "Add to review" off takes them out of the queue.
	if err := f.svc.SetInReview(ctx, f.user, b.ID, flash.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, n, _ := f.vocab.DueDeck(ctx, f.user, vocab.DeckBook, 50); n != 0 {
		t.Fatalf("%d cards still due after taking them out of review", n)
	}

	// Export resolves every citation.
	md, name, err := f.svc.Export(ctx, f.user, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(md, "[[cite") || !strings.Contains(md, "(Notes.pdf, p. 1)") || !strings.HasSuffix(name, ".md") ||
		!strings.Contains(md, "```mermaid") || !strings.Contains(md, "What is retrieval?") {
		t.Fatalf("export:\n%s", md)
	}
	if strings.Contains(md, "Answers:") {
		t.Fatal("the export gave away an unanswered question's answer")
	}

	// Deleting the book deletes its cards; the questions stay in the bank.
	if err := f.svc.Delete(ctx, f.user, b.ID); err != nil {
		t.Fatal(err)
	}
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM vocab_cards WHERE user_id = $1 AND kind = 'flash'`, f.user).Scan(&rows)
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM questions WHERE user_id = $1`, f.user).Scan(&inBank)
	if rows != 0 || inBank != 1 {
		t.Fatalf("after delete: %d flash cards, %d questions", rows, inBank)
	}
}

// A block whose answer breaks its rules is an error block with the reason;
// the chapter goes on and the block can be retried.
func TestABrokenBlockIsAnErrorNotAnEmptySuccess(t *testing.T) {
	ctx, f := newBookFixture(t)
	f.model.replies["worked_example"] = `{"problem":"p","steps":["only one"],"answer":"a"}`
	b := f.confirmed(t, ctx)
	if _, err := f.svc.CompileChapter(ctx, f.user, b.ID, b.Chapters[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.attempt(t, ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	view, _ := f.svc.Chapter(ctx, f.user, b.ID, b.Chapters[0].ID)
	for _, blk := range view.Blocks {
		if blk.Type == book.TypeWorkedExample {
			if blk.Status != book.BlockError || !strings.Contains(blk.Error, "steps") || blk.Version != 0 {
				t.Fatalf("broken block = %+v", blk)
			}
		} else if blk.Status != book.BlockReady {
			t.Fatalf("%s = %s", blk.Type, blk.Status)
		}
	}
	if view.Chapter.Status != book.ChapterReady || view.Chapter.EstimatedCalls != 1 {
		t.Fatalf("chapter = %+v", view.Chapter)
	}
}

func TestCompileResumesAtTheFirstUnfinishedBlock(t *testing.T) {
	ctx, f := newBookFixture(t)
	// The third block's first call fails with a 503.
	blockCalls := 0
	f.model.fail = func(kind string, _ int) error {
		if kind == "propose" || kind == "plan" {
			return nil
		}
		blockCalls++
		if blockCalls == 3 {
			return &providers.HTTPError{Status: 503, Body: "busy"}
		}
		return nil
	}
	b := f.confirmed(t, ctx)
	if _, err := f.svc.CompileChapter(ctx, f.user, b.ID, b.Chapters[0].ID); err != nil {
		t.Fatal(err)
	}
	job, err := f.attempt(t, ctx, b.ID)
	var term *jobs.TerminalError
	if err == nil || errors.As(err, &term) {
		t.Fatalf("first attempt: %v, want a retryable failure", err)
	}
	job, _ = f.queue.Get(ctx, job.ID)
	if p := jobs.ProgressOf(job); p.Done != 3 || p.Billed != 4 {
		t.Fatalf("checkpoint = %+v, want the plan and two blocks done, four calls billed", p)
	}

	if _, err := f.attempt(t, ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	// The plan and the first two blocks were never asked for again.
	if f.model.count("plan") != 1 || f.model.count("text") != 1 || f.model.count("diagram") != 1 || f.model.count("quiz") != 2 {
		t.Fatalf("calls = %v", f.model.calls)
	}
	view, _ := f.svc.Chapter(ctx, f.user, b.ID, b.Chapters[0].ID)
	if view.Chapter.Status != book.ChapterReady || view.Chapter.Ready != 6 {
		t.Fatalf("chapter = %+v", view.Chapter)
	}
	var failures int
	_ = f.pool.QueryRow(ctx, `SELECT consecutive_failures FROM books WHERE id = $1`, b.ID).Scan(&failures)
	if failures != 0 {
		t.Fatalf("a success did not reset the failure run: %d", failures)
	}
}

func TestTwoProviderFailuresInARowPauseTheBook(t *testing.T) {
	ctx, f := newBookFixture(t)
	f.model.fail = func(kind string, _ int) error {
		if kind == "text" {
			return &providers.HTTPError{Status: 502, Body: "bad gateway"}
		}
		return nil
	}
	b := f.confirmed(t, ctx)
	if _, err := f.svc.CompileAll(ctx, f.user, b.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.attempt(t, ctx, b.ID); err == nil {
		t.Fatal("the first failure did not fail the attempt")
	}
	job, err := f.attempt(t, ctx, b.ID)
	if !errors.Is(err, book.ErrPaused) {
		t.Fatalf("second failure: %v, want the book paused", err)
	}
	var term *jobs.TerminalError
	if !errors.As(err, &term) {
		t.Fatal("a pause must end the job, not retry it")
	}
	if _, err := f.queue.Fail(ctx, job.ID, f.queue.worker, err, true); err != nil {
		t.Fatal(err)
	}

	got, _ := f.svc.Get(ctx, f.user, b.ID)
	if got.PausedReason == "" || got.Compiling {
		t.Fatalf("book = %+v", got)
	}
	for _, ch := range got.Chapters {
		if ch.Status != book.ChapterPaused {
			t.Fatalf("chapter %d = %s, want paused", ch.Ord, ch.Status)
		}
	}
	// Only the first chapter was reached; nothing after the pause was billed.
	if f.model.count("text") != 2 || f.model.count("plan") != 1 {
		t.Fatalf("calls = %v", f.model.calls)
	}
	// Asking again resumes.
	f.model.fail = nil
	if _, err := f.svc.CompileChapter(ctx, f.user, b.ID, got.Chapters[0].ID); err != nil {
		t.Fatal(err)
	}
	if got, _ = f.svc.Get(ctx, f.user, b.ID); got.PausedReason != "" {
		t.Fatal("compiling again did not clear the pause")
	}
}

// Phase 0's rule for ids in jsonb: an anchor is resolved with the owner's
// user_id when it is saved (TestABookIsConfirmedBeforeAnythingIsWritten) AND
// when it is used. An anchor that reached the row anyway — written by hand
// here — is never read, and is dropped from the chapter.
func TestAnchorsAreResolvedOnSaveAndOnCompile(t *testing.T) {
	ctx, f := newBookFixture(t)
	other := testutil.NewUser(t, f.pool)
	_, _, theirs := seedBookKB(t, f.pool, other, 4, "ALICE-PRIVATE passage")
	b := f.confirmed(t, ctx)

	// A chapter anchored on nothing but another user's chunks.
	onlyTheirs, _ := json.Marshal(theirs)
	if _, err := f.pool.Exec(ctx, `UPDATE book_chapters SET anchors = $2 WHERE id = $1`, b.Chapters[0].ID, onlyTheirs); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.CompileChapter(ctx, f.user, b.ID, b.Chapters[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.attempt(t, ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	ch, _ := f.store.GetChapter(ctx, f.user, b.ID, b.Chapters[0].ID)
	if ch.Status != book.ChapterError || ch.Error != "not enough material for this chapter" || len(ch.Anchors) != 0 {
		t.Fatalf("chapter = %+v", ch)
	}
	if f.model.count("plan") != 0 || f.model.sawText("ALICE-PRIVATE") {
		t.Fatal("another user's passage reached the model")
	}

	// Mixed with the learner's own: theirs are dropped, the rest is written.
	mixed, _ := json.Marshal(append([]uuid.UUID{f.chunks[2]}, theirs...))
	if _, err := f.pool.Exec(ctx, `UPDATE book_chapters SET anchors = $2 WHERE id = $1`, b.Chapters[1].ID, mixed); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.CompileChapter(ctx, f.user, b.ID, b.Chapters[1].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.attempt(t, ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	ch, _ = f.store.GetChapter(ctx, f.user, b.ID, b.Chapters[1].ID)
	if ch.Status != book.ChapterReady || len(ch.Anchors) != 1 || ch.Anchors[0] != f.chunks[2] {
		t.Fatalf("chapter = %+v", ch)
	}
	if f.model.sawText("ALICE-PRIVATE") {
		t.Fatal("another user's passage reached the model")
	}
}

func TestRegenerateKeepsThePreviousVersionUntilTheNewOneIsReady(t *testing.T) {
	ctx, f := newBookFixture(t)
	b := f.confirmed(t, ctx)
	if _, err := f.svc.CompileChapter(ctx, f.user, b.ID, b.Chapters[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.attempt(t, ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	view, _ := f.svc.Chapter(ctx, f.user, b.ID, b.Chapters[0].ID)
	var text, flash book.Block
	for _, blk := range view.Blocks {
		switch blk.Type {
		case book.TypeText:
			text = blk
		case book.TypeFlashCards:
			flash = blk
		}
	}

	// A new answer that breaks the rules leaves the old block as it was.
	f.model.replies["text"] = `{"markdown":"No citation at all."}`
	if _, err := f.svc.Regenerate(ctx, f.user, b.ID, text.ID); !errors.Is(err, book.ErrInvalidOutput) {
		t.Fatalf("err = %v", err)
	}
	kept, _, _ := f.store.GetBlock(ctx, f.user, b.ID, text.ID)
	if kept.Status != book.BlockReady || kept.Version != 1 || string(kept.Payload) != string(text.Payload) {
		t.Fatalf("the old version was not kept: %+v", kept)
	}
	// A provider failure too.
	f.model.fail = func(kind string, _ int) error {
		if kind == "text" {
			return errors.New("connection reset")
		}
		return nil
	}
	if _, err := f.svc.Regenerate(ctx, f.user, b.ID, text.ID); !errors.Is(err, runtime.ErrProvider) {
		t.Fatalf("err = %v", err)
	}
	f.model.fail = nil
	// A good one replaces it.
	f.model.replies["text"] = `{"markdown":"A better explanation. [[cite:chunk:C2]]"}`
	got, err := f.svc.Regenerate(ctx, f.user, b.ID, text.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Version != 2 || !strings.Contains(string(got.Payload), "A better explanation") {
		t.Fatalf("regenerated = %+v", got)
	}

	// Regenerated flash cards replace the old ones and keep "out of review".
	if err := f.svc.SetInReview(ctx, f.user, b.ID, flash.ID, false); err != nil {
		t.Fatal(err)
	}
	f.model.replies["flash_cards"] = `{"cards":[{"front":"New 1","back":"b"},{"front":"New 2","back":"b"},{"front":"New 3","back":"b"},{"front":"New 4","back":"b"}],"source_ids":["C2"]}`
	got, err = f.svc.Regenerate(ctx, f.user, b.ID, flash.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Cards) != 4 || got.Cards[0].Front != "New 1" || got.InReview == nil || *got.InReview {
		t.Fatalf("regenerated cards = %+v in review %v", got.Cards, got.InReview)
	}
}

func TestAChapterIsStaleWhenASourceDocumentChanges(t *testing.T) {
	ctx, f := newBookFixture(t)
	b := f.confirmed(t, ctx)
	if _, err := f.svc.CompileChapter(ctx, f.user, b.ID, b.Chapters[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.attempt(t, ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if view, _ := f.svc.Chapter(ctx, f.user, b.ID, b.Chapters[0].ID); view.Chapter.Stale {
		t.Fatal("a fresh chapter is stale")
	}
	if _, err := f.pool.Exec(ctx, `UPDATE documents SET version = version + 1 WHERE id = $1`, f.doc); err != nil {
		t.Fatal(err)
	}
	view, _ := f.svc.Chapter(ctx, f.user, b.ID, b.Chapters[0].ID)
	got, _ := f.svc.Get(ctx, f.user, b.ID)
	if !view.Chapter.Stale || !got.Chapters[0].Stale || got.Chapters[1].Stale {
		t.Fatalf("stale: chapter view %v, book %v / %v", view.Chapter.Stale, got.Chapters[0].Stale, got.Chapters[1].Stale)
	}
	// "Write every chapter" writes the three unwritten chapters and does not
	// refresh this one, so it does not count it.
	if got.EstimatedCalls != 3*(1+book.MaxBlocks) {
		t.Fatalf("the book's cost = %d, want the three unwritten chapters' %d", got.EstimatedCalls, 3*(1+book.MaxBlocks))
	}
	// A stale chapter is refreshed whole — even with a block in error, which
	// on its own would be the only block rewritten — and says so in its cost.
	if _, err := f.pool.Exec(ctx, `UPDATE book_blocks SET status = 'error' WHERE chapter_id = $1 AND ord = 2`, b.Chapters[0].ID); err != nil {
		t.Fatal(err)
	}
	if view, _ = f.svc.Chapter(ctx, f.user, b.ID, b.Chapters[0].ID); view.Chapter.EstimatedCalls != 6 {
		t.Fatalf("a stale chapter's refresh costs %d calls, want all 6 blocks", view.Chapter.EstimatedCalls)
	}
	// Refreshing rewrites every block, each keeping its previous version on
	// the page until the new one is ready.
	if _, err := f.svc.CompileChapter(ctx, f.user, b.ID, b.Chapters[0].ID); err != nil {
		t.Fatal(err)
	}
	during, _ := f.svc.Chapter(ctx, f.user, b.ID, b.Chapters[0].ID)
	for _, blk := range during.Blocks {
		if blk.Status != book.BlockPending || blk.Version != 1 {
			t.Fatalf("during refresh: %s %s v%d", blk.Type, blk.Status, blk.Version)
		}
	}
	if _, err := f.attempt(t, ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	view, _ = f.svc.Chapter(ctx, f.user, b.ID, b.Chapters[0].ID)
	if view.Chapter.Stale || view.Blocks[0].Version != 2 || f.model.count("plan") != 1 {
		t.Fatalf("after refresh: stale %v, v%d, %d plans", view.Chapter.Stale, view.Blocks[0].Version, f.model.count("plan"))
	}
}

// Deleting the knowledge base deletes its books, and with them their cards.
func TestDeletingTheKnowledgeBaseDeletesItsBooks(t *testing.T) {
	ctx, f := newBookFixture(t)
	b := f.confirmed(t, ctx)
	if _, err := f.svc.CompileChapter(ctx, f.user, b.ID, b.Chapters[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.attempt(t, ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1`, f.kb); err != nil {
		t.Fatal(err)
	}
	var books, cards int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM books WHERE user_id = $1`, f.user).Scan(&books)
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM vocab_cards WHERE user_id = $1`, f.user).Scan(&cards)
	if books != 0 || cards != 0 {
		t.Fatalf("after deleting the knowledge base: %d books, %d cards", books, cards)
	}
}

// The table refuses a flash card with a note, and a note's card without one.
func TestTheCardTableHoldsTheFlashContract(t *testing.T) {
	ctx, f := newBookFixture(t)
	b := f.confirmed(t, ctx)
	if _, err := f.svc.CompileChapter(ctx, f.user, b.ID, b.Chapters[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.attempt(t, ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO vocab_cards (user_id, kind, due_at) VALUES ($1, 'recognition', now())`, f.user); err == nil {
		t.Fatal("a note's card with no note was accepted")
	}
	var block uuid.UUID
	_ = f.pool.QueryRow(ctx, `SELECT book_block_id FROM vocab_cards WHERE user_id = $1 AND kind = 'flash' LIMIT 1`, f.user).Scan(&block)
	if _, err := f.pool.Exec(ctx, `INSERT INTO vocab_cards (user_id, kind, due_at, book_block_id) VALUES ($1, 'flash', now(), $2)`,
		f.user, block); err == nil {
		t.Fatal("a flash card with no faces was accepted")
	}
	// Another user's block cannot own this user's card.
	other := testutil.NewUser(t, f.pool)
	if _, err := f.pool.Exec(ctx, `INSERT INTO vocab_cards (user_id, kind, due_at, front, back, book_block_id)
		VALUES ($1, 'flash', now(), 'f', 'b', $2)`, other, block); err == nil {
		t.Fatal("a flash card on another user's block was accepted")
	}
}

// Cancel stops a compile after the call in flight; the chapter is left
// paused with what was written, and compiling again resumes it.
func TestCancelStopsACompileAfterTheCallInFlight(t *testing.T) {
	ctx, f := newBookFixture(t)
	b := f.confirmed(t, ctx)
	if _, err := f.svc.CompileChapter(ctx, f.user, b.ID, b.Chapters[0].ID); err != nil {
		t.Fatal(err)
	}
	// The learner presses Cancel while the plan call is out.
	f.model.fail = func(kind string, _ int) error {
		if kind == "plan" {
			if err := f.svc.Cancel(ctx, f.user, b.ID); err != nil {
				t.Errorf("cancel: %v", err)
			}
		}
		return nil
	}
	job, err := f.attempt(t, ctx, b.ID)
	if !errors.Is(err, jobs.ErrCancelled) {
		t.Fatalf("err = %v, want cancelled", err)
	}
	if _, err := f.queue.Fail(ctx, job.ID, f.queue.worker, err, true); err != nil {
		t.Fatal(err)
	}
	if n := f.model.count("") - f.model.count("propose"); n != 1 {
		t.Fatalf("%d calls after the plan; cancel must stop after the call in flight", n-1)
	}
	got, _ := f.svc.Get(ctx, f.user, b.ID)
	ch := got.Chapters[0]
	if ch.Status != book.ChapterPaused || ch.Blocks != 6 || ch.Ready != 0 || got.Compiling {
		t.Fatalf("after cancel: %+v", ch)
	}
	// Another user's cancel finds nothing.
	if err := f.svc.Cancel(ctx, testutil.NewUser(t, f.pool), b.ID); !errors.Is(err, book.ErrNotFound) {
		t.Fatalf("another user's cancel: %v", err)
	}
	// Compiling again resumes at the first block; the plan is not paid twice.
	f.model.fail = nil
	if _, err := f.svc.CompileChapter(ctx, f.user, b.ID, ch.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.attempt(t, ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ = f.svc.Get(ctx, f.user, b.ID); got.Chapters[0].Status != book.ChapterReady || f.model.count("plan") != 1 {
		t.Fatalf("after resuming: %+v, %d plans", got.Chapters[0], f.model.count("plan"))
	}
}
