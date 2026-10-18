package exam_test

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/capabilities/exam"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/jobs"
	examprompts "github.com/D0bby999/anytools/internal/prompts/exam"
	quizprompts "github.com/D0bby999/anytools/internal/prompts/quiz"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// harness_test.go — the exam service over the real store, queue and blob
// store, with a scripted model. No provider is reachable from these tests;
// every model reply is written here.

// Call kinds, recognised by the system prompt the service sends.
const (
	callExtract  = "extract"
	callGenerate = "generate"
	callRepair   = "repair"
	callRubric   = "rubric"
	callJudge    = "judge"
)

type call struct {
	kind, user string
}

// scriptModel answers every call through reply, and records it.
type scriptModel struct {
	mu    sync.Mutex
	calls []call
	reply func(kind, user string) (string, error)
}

func kindOf(system string) string {
	switch system {
	case examprompts.Extract:
		return callExtract
	case examprompts.Generate:
		return callGenerate
	case examprompts.Generate + "\n\n" + examprompts.Repair:
		return callRepair
	case quizprompts.Rubric:
		return callRubric
	case quizprompts.Judge:
		return callJudge
	}
	return "unknown"
}

func (m *scriptModel) Chat(_ context.Context, req runtime.ChatRequest) (*runtime.ChatResponse, error) {
	kind := kindOf(req.Messages[0].Content)
	user := req.Messages[1].Content
	m.mu.Lock()
	m.calls = append(m.calls, call{kind, user})
	m.mu.Unlock()
	out, err := m.reply(kind, user)
	if err != nil {
		return nil, err
	}
	return &runtime.ChatResponse{Content: out}, nil
}

func (m *scriptModel) ChatStream(ctx context.Context, req runtime.ChatRequest, _ func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
	return m.Chat(ctx, req)
}
func (m *scriptModel) DefaultModel() string { return "scripted-model" }
func (m *scriptModel) Name() string         { return "scripted" }

func (m *scriptModel) count(kind string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, c := range m.calls {
		if c.kind == kind {
			n++
		}
	}
	return n
}

func (m *scriptModel) of(kind string) []call {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []call
	for _, c := range m.calls {
		if c.kind == kind {
			out = append(out, c)
		}
	}
	return out
}

type resolver struct{ m *scriptModel }

func (r resolver) ChatFor(context.Context, uuid.UUID, string) (runtime.ChatProvider, error) {
	return r.m, nil
}

// noParsers is a learner with no `parse` route.
type noParsers struct{}

func (noParsers) ParserChain(context.Context, uuid.UUID) ([]parse.PageParser, error) { return nil, nil }

// passages is the knowledge base: two fixed passages for any topic, none for
// a topic containing "nothing".
type passages struct{ chunks []quiz.Chunk }

func (p passages) Search(_ context.Context, _ uuid.UUID, _ []uuid.UUID, query string, _ int) ([]quiz.Chunk, error) {
	if strings.Contains(query, "nothing") {
		return nil, nil
	}
	return p.chunks, nil
}

type ownsKB struct{ user, kb uuid.UUID }

func (o ownsKB) OwnsKB(_ context.Context, user, kb uuid.UUID) error {
	if user != o.user || kb != o.kb {
		return quiz.ErrNoAccess
	}
	return nil
}

type harness struct {
	ctx      context.Context
	pool     *pgxpool.Pool
	user, kb uuid.UUID
	store    *pg.ExamStore
	quiz     *pg.QuestionStore
	queue    *jobs.Queue
	files    *blob.Local
	model    *scriptModel
	svc      *exam.Service
	chunks   []quiz.Chunk
	clock    time.Time
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	ctx := context.Background()
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)
	kb, err := pg.NewKnowledgeStore(pool).CreateKB(ctx, user, "Exam source")
	if err != nil {
		t.Fatal(err)
	}
	files, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := &harness{
		ctx: ctx, pool: pool, user: user, kb: kb.ID,
		store: pg.NewExamStore(pool), quiz: pg.NewQuestionStore(pool),
		queue: jobs.NewQueue(pool, time.Minute), files: files,
		model: &scriptModel{reply: func(string, string) (string, error) { return "{}", nil }},
		chunks: []quiz.Chunk{
			{ID: uuid.New(), DocumentID: uuid.New(), DocumentTitle: "Money and banking", Page: 3, Text: "Banks hold reserves."},
			{ID: uuid.New(), DocumentID: uuid.New(), DocumentTitle: "Money and banking", Page: 4, Text: "The reserve ratio is set by the central bank."},
		},
		clock: time.Now().UTC(),
	}
	h.queue.OnGaveUp(pg.ExamReapHandler())
	models := resolver{h.model}
	h.svc = exam.NewService(exam.Deps{
		Store: h.store, Authz: ownsKB{user, kb.ID}, Parsers: noParsers{}, Models: models,
		Retriever: passages{h.chunks},
		Marker: quiz.NewService(quiz.Config{Store: h.quiz, Providers: models, Authz: ownsKB{user, kb.ID},
			Now: func() time.Time { return h.clock }}),
		Queue: h.queue, Files: files, Now: func() time.Time { return h.clock },
	})
	return h
}

// run claims one specific job (not "the next job of a kind": other packages
// share this database) and runs handler on it, settling the job as a worker
// would. A failed job is made runnable again at once.
func (h *harness) run(t *testing.T, jobID uuid.UUID, handler jobs.Handler) error {
	t.Helper()
	worker := "exam-test-" + uuid.NewString()[:8]
	tag, err := h.pool.Exec(h.ctx, `
		UPDATE jobs SET status = 'running', locked_by = $2, lease_expires_at = now() + interval '5 minutes',
		       attempts = attempts + 1, updated_at = now()
		 WHERE id = $1 AND status = 'queued'`, jobID, worker)
	if err != nil || tag.RowsAffected() != 1 {
		t.Fatalf("claim %s: %v (%d rows)", jobID, err, tag.RowsAffected())
	}
	job, err := h.queue.Get(h.ctx, jobID)
	if err != nil {
		t.Fatal(err)
	}
	job.WorkerID = worker
	herr := handler(h.ctx, job)
	if herr == nil {
		if err := h.queue.Complete(h.ctx, jobID, worker); err != nil {
			t.Fatal(err)
		}
		return nil
	}
	var term *jobs.TerminalError
	if _, err := h.queue.Fail(h.ctx, jobID, worker, herr, errors.As(herr, &term)); err != nil {
		t.Fatal(err)
	}
	_, _ = h.pool.Exec(h.ctx, `UPDATE jobs SET run_after = now() WHERE id = $1`, jobID)
	return herr
}

func (h *harness) jobStatus(t *testing.T, jobID uuid.UUID) string {
	t.Helper()
	job, err := h.queue.Get(h.ctx, jobID)
	if err != nil {
		t.Fatal(err)
	}
	return job.Status
}

// ── fixtures ──────────────────────────────────────────────────────────────

// examPDF builds a text-layer PDF of n pages, page p carrying pageText(p).
// Generated rather than committed as a binary, so the fixture's text can be
// read in the test that asserts on it (as parse's probe PDF is).
func examPDF(n int, pageText func(p int) string) []byte {
	var objects []string
	add := func(body string) int { objects = append(objects, body); return len(objects) }
	add("<< /Type /Catalog /Pages 2 0 R >>")
	add("") // the page tree, written once the pages exist
	font := add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	var kids []string
	for p := 1; p <= n; p++ {
		var content strings.Builder
		content.WriteString("BT /F1 9 Tf 20 800 Td 11 TL")
		for _, line := range wrapLines(pageText(p), 90) {
			fmt.Fprintf(&content, " (%s) '", pdfEscape(line))
		}
		content.WriteString(" ET")
		stream := add(fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", content.Len(), content.String()))
		page := add(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents %d 0 R "+
			"/Resources << /Font << /F1 %d 0 R >> >> >>", stream, font))
		kids = append(kids, fmt.Sprintf("%d 0 R", page))
	}
	objects[1] = fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), n)

	var buf bytes.Buffer
	buf.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objects)+1)
	for i, body := range objects {
		offsets[i+1] = buf.Len()
		fmt.Fprintf(&buf, "%d 0 obj\n%s\nendobj\n", i+1, body)
	}
	xref := buf.Len()
	fmt.Fprintf(&buf, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for i := 1; i <= len(objects); i++ {
		fmt.Fprintf(&buf, "%010d 00000 n \n", offsets[i])
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	return buf.Bytes()
}

func wrapLines(s string, width int) []string {
	var out []string
	for len(s) > width {
		out = append(out, s[:width])
		s = s[width:]
	}
	return append(out, s)
}

func pdfEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `(`, `\(`, `)`, `\)`).Replace(s)
}

// questionPage is a page of a printed exam: the question, then enough of a
// passage that the page reads as text rather than as a scan.
func questionPage(p int) string {
	return fmt.Sprintf("Question %d. Explain the reserve requirement in part %d. ", p, p) +
		strings.Repeat("Commercial banks keep a fraction of deposits as reserves at the central bank. ", 7)
}

// examDOCX builds a minimal Word document holding paragraphs.
func examDOCX(paragraphs ...string) []byte {
	var body strings.Builder
	for _, p := range paragraphs {
		fmt.Fprintf(&body, "<w:p><w:r><w:t>%s</w:t></w:r></w:p>", p)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range map[string]string{
		"[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
			`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
		"word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
			body.String() + `</w:body></w:document>`,
	} {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(content))
	}
	_ = zw.Close()
	return buf.Bytes()
}

// requestedPages reads "pages A to B" from an extraction request.
var requestedPages = regexp.MustCompile(`starts on pages (\d+) to (\d+)`)

func pagesOf(user string) (int, int) {
	m := requestedPages.FindStringSubmatch(user)
	if m == nil {
		return 0, 0
	}
	var a, b int
	fmt.Sscan(m[1], &a)
	fmt.Sscan(m[2], &b)
	return a, b
}
