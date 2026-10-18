package exam_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/exam"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/runtime"
)

// extractReply lists one question per requested page: page 1's is an mcq
// with a single option (invalid), page 2's is an "essay" (an unknown type),
// every other page's a short answer.
func extractReply(user string) (string, error) {
	a, b := pagesOf(user)
	var qs []map[string]any
	for p := a; p <= b; p++ {
		q := map[string]any{"number": p, "type": "short", "stem_md": fmt.Sprintf("Explain the reserve requirement in part %d.", p),
			"points": "2 points", "difficulty": "hard", "source_page": p, "topic": "reserves"}
		switch p {
		case 1:
			q["type"], q["options"] = "multiple_choice", []map[string]string{{"label": "A", "text_md": "only one"}}
		case 2:
			q["type"], q["difficulty"] = "essay", "impossible"
		}
		qs = append(qs, q)
	}
	raw, _ := json.Marshal(map[string]any{"questions": qs})
	return string(raw), nil
}

func TestA40PagePaperIsExtractedInBatchesThatCoverEveryPage(t *testing.T) {
	h := newHarness(t)
	h.model.reply = func(kind, user string) (string, error) { return extractReply(user) }

	tmpl, err := h.svc.Upload(h.ctx, h.user, "midterm-2024.pdf", examPDF(40, questionPage))
	if err != nil {
		t.Fatal(err)
	}
	if tmpl.PageCount != 40 || tmpl.Kind != exam.KindPDF || tmpl.Title != "midterm-2024" {
		t.Fatalf("template = %+v", tmpl)
	}
	if err := h.run(t, *tmpl.JobID, h.svc.HandleExtract); err != nil {
		t.Fatal(err)
	}

	got, err := h.svc.Template(h.ctx, h.user, tmpl.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != exam.TemplateReview || len(got.Items) != 40 {
		t.Fatalf("status %s with %d items (error %q), want review with 40", got.Status, len(got.Items), got.Error)
	}
	if got.ParsedBy != "local:text layer" {
		t.Fatalf("parsed_by = %q", got.ParsedBy)
	}
	// One call per 8 pages, and every page reached a model inside its batch.
	calls := h.model.of(callExtract)
	if len(calls) != 5 {
		t.Fatalf("%d extraction calls, want 5", len(calls))
	}
	seen := map[int]bool{}
	for _, c := range calls {
		a, b := pagesOf(c.user)
		if b-a+1 > exam.BatchPages {
			t.Fatalf("a batch of %d pages", b-a+1)
		}
		for p := a; p <= b; p++ {
			if !strings.Contains(c.user, parse.Marker(p)) || !strings.Contains(c.user, fmt.Sprintf("Question %d.", p)) {
				t.Fatalf("page %d's text is missing from its batch", p)
			}
			seen[p] = true
		}
		if !strings.Contains(c.user, `trust="untrusted"`) {
			t.Fatal("the paper reached the model outside the untrusted envelope")
		}
	}
	if len(seen) != 40 {
		t.Fatalf("batches covered %d of 40 pages", len(seen))
	}
	for i, it := range got.Items {
		if it.Number != fmt.Sprint(i+1) || it.SourcePage != i+1 || it.Points != 2 {
			t.Fatalf("item %d = %+v", i, it)
		}
	}
	if len(got.Warnings) != 0 {
		t.Fatalf("contiguous numbering was warned about: %v", got.Warnings)
	}

	mcq, essay := got.Items[0], got.Items[1]
	if mcq.Type != quiz.TypeMCQ || len(mcq.Issues) == 0 || !strings.Contains(mcq.Issues[0], "two options") {
		t.Fatalf("the one-option mcq was not flagged: %+v", mcq)
	}
	if essay.Type != quiz.TypeWritten || essay.Difficulty != quiz.DifficultyMedium {
		t.Fatalf("an unknown type and difficulty became %s / %s, want written / medium", essay.Type, essay.Difficulty)
	}
	// The job's checkpoint: the read and five batches, five calls billed (the
	// text layer is read for free).
	if p := h.svc.TemplateProgress(h.ctx, got); p == nil || p.Done != 6 || p.Billed != 5 {
		t.Fatalf("progress = %+v", p)
	}

	// Not ready until the flagged question is fixed or deleted.
	ready := true
	if _, err := h.svc.SaveReview(h.ctx, h.user, tmpl.ID, exam.Review{Ready: &ready}); !errors.Is(err, exam.ErrBadRequest) {
		t.Fatalf("marking a template with a flagged question ready: %v", err)
	}
	items := got.Items
	items[0].Options = append(items[0].Options, exam.Option{TextMD: "a second option"})
	items[0].Issues = nil
	limit := 90
	saved, err := h.svc.SaveReview(h.ctx, h.user, tmpl.ID, exam.Review{Items: items, Ready: &ready, TimeLimitMinutes: &limit})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Status != exam.TemplateReady || *saved.TimeLimitMinutes != 90 || saved.TotalPoints != 80 {
		t.Fatalf("after review: %s, limit %v, total %v", saved.Status, saved.TimeLimitMinutes, saved.TotalPoints)
	}
}

func TestAResumedExtractionDoesNotReadOrExtractTwice(t *testing.T) {
	h := newHarness(t)
	failOnce := true
	h.model.reply = func(kind, user string) (string, error) {
		if a, _ := pagesOf(user); a == 9 && failOnce {
			failOnce = false
			return "", errors.New("provider timed out")
		}
		return extractReply(user)
	}
	tmpl, err := h.svc.Upload(h.ctx, h.user, "final.pdf", examPDF(20, questionPage))
	if err != nil {
		t.Fatal(err)
	}
	if err := h.run(t, *tmpl.JobID, h.svc.HandleExtract); err == nil {
		t.Fatal("the first attempt should stop at the second batch")
	}
	if err := h.run(t, *tmpl.JobID, h.svc.HandleExtract); err != nil {
		t.Fatal(err)
	}
	perBatch := map[int]int{}
	for _, c := range h.model.of(callExtract) {
		a, _ := pagesOf(c.user)
		perBatch[a]++
	}
	if perBatch[1] != 1 || perBatch[9] != 2 || perBatch[17] != 1 {
		t.Fatalf("calls per batch = %v; the first batch must not be re-billed", perBatch)
	}
	got, _ := h.svc.Template(h.ctx, h.user, tmpl.ID)
	if len(got.Items) != 20 {
		t.Fatalf("%d items after the resume, want 20", len(got.Items))
	}
}

func TestMoreThan100QuestionsIsRefused(t *testing.T) {
	h := newHarness(t)
	h.model.reply = func(string, string) (string, error) {
		var qs []map[string]any
		for i := 1; i <= exam.MaxItems+1; i++ {
			qs = append(qs, map[string]any{"number": i, "type": "tf", "stem_md": "s", "source_page": 1})
		}
		raw, _ := json.Marshal(map[string]any{"questions": qs})
		return string(raw), nil
	}
	tmpl, err := h.svc.Upload(h.ctx, h.user, "quiz.txt", []byte("1. True or false: banks hold reserves.\n"))
	if err != nil {
		t.Fatal(err)
	}
	if err := h.run(t, *tmpl.JobID, h.svc.HandleExtract); err != nil {
		t.Fatal(err)
	}
	got, _ := h.svc.Template(h.ctx, h.user, tmpl.ID)
	if got.Status != exam.TemplateFailed || !strings.Contains(got.Error, "at most 100") {
		t.Fatalf("101 questions: %s %q", got.Status, got.Error)
	}
}

func TestAWordPaperIsReadLocallyAndHasNoPagesToShow(t *testing.T) {
	h := newHarness(t)
	h.model.reply = func(_, user string) (string, error) {
		if !strings.Contains(user, "Câu 1. Ngân hàng") {
			return "", errors.New("the document's text did not reach the model")
		}
		return `{"questions":[{"number":"Câu 1","type":"calculation","stem_md":"Ngân hàng giữ dự trữ.","points":null,"source_page":1}]}`, nil
	}
	tmpl, err := h.svc.Upload(h.ctx, h.user, "de-thi.docx", examDOCX("Câu 1. Ngân hàng giữ dự trữ bắt buộc bao nhiêu?"))
	if err != nil {
		t.Fatal(err)
	}
	if tmpl.Kind != exam.KindDOCX || tmpl.PageCount != 1 {
		t.Fatalf("template = %+v", tmpl)
	}
	if err := h.run(t, *tmpl.JobID, h.svc.HandleExtract); err != nil {
		t.Fatal(err)
	}
	got, _ := h.svc.Template(h.ctx, h.user, tmpl.ID)
	if got.Status != exam.TemplateReview || got.ParsedBy != "local:docx" || got.Items[0].Type != quiz.TypeWritten || got.Items[0].Points != 1 {
		t.Fatalf("docx template = %+v", got)
	}
}

func TestAScannedPaperNeedsAParseModel(t *testing.T) {
	h := newHarness(t)
	thin := examPDF(2, func(int) string { return "p" })
	if _, err := h.svc.Upload(h.ctx, h.user, "scan.pdf", thin); !errors.Is(err, exam.ErrNeedsParseModel) {
		t.Fatalf("a scanned paper with no parse route: %v", err)
	}
	if _, err := h.svc.Upload(h.ctx, h.user, "long.pdf", examPDF(41, questionPage)); !errors.Is(err, exam.ErrBadRequest) {
		t.Fatalf("a 41-page paper: %v", err)
	}
	if _, err := h.svc.Upload(h.ctx, h.user, "x.exe", []byte("MZ")); !errors.Is(err, exam.ErrUnsupported) {
		t.Fatalf("an executable: %v", err)
	}
}

func TestValidateItemsFlagsWhatCannotBeUsed(t *testing.T) {
	fig := 9
	items, warnings := exam.ValidateItems([]exam.Item{
		{Number: "1", Type: "fill_in_blank", StemMD: "The ratio is ...... and ____.", SourcePage: 1},
		{Number: "2", Type: "coding", StemMD: "Write a function.", SourcePage: 2, FigurePage: &fig},
		{Number: "4", Type: "tf", StemMD: "Banks hold reserves.", SourcePage: 5},
	}, 3)
	if items[0].Type != quiz.TypeCloze || len(items[0].Issues) != 1 || !strings.Contains(items[0].Issues[0], "exactly one blank") {
		t.Fatalf("two blanks: %+v", items[0])
	}
	if items[1].Type != quiz.TypeWritten || items[1].FigurePage != nil || len(items[1].Issues) != 1 {
		t.Fatalf("figure off the paper: %+v", items[1])
	}
	if len(items[2].Issues) != 1 || !strings.Contains(items[2].Issues[0], "page 5") {
		t.Fatalf("a source page past the end: %+v", items[2])
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "question 3 is missing") {
		t.Fatalf("warnings = %v", warnings)
	}
}

type noModels struct{}

func (noModels) ChatFor(context.Context, uuid.UUID, string) (runtime.ChatProvider, error) {
	return nil, runtime.ErrNoProvider
}

func TestWithoutAQuizzesRouteNothingIsUploadedOrQueued(t *testing.T) {
	h := newHarness(t)
	svc := exam.NewService(exam.Deps{Store: h.store, Authz: ownsKB{h.user, h.kb}, Parsers: noParsers{},
		Models: noModels{}, Retriever: passages{h.chunks}, Queue: h.queue, Files: h.files})
	if _, err := svc.Upload(h.ctx, h.user, "midterm.pdf", examPDF(2, questionPage)); !errors.Is(err, runtime.ErrNoProvider) {
		t.Fatalf("an upload with no Quizzes route: %v", err)
	}
	if list, _ := h.store.ListTemplates(h.ctx, h.user); len(list) != 0 {
		t.Fatalf("%d templates stored for a refused upload", len(list))
	}
}
