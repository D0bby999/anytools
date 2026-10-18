package exam_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/exam"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/jobs"
)

var (
	briefType  = regexp.MustCompile(`Type: (\w+) \(fixed\)`)
	briefMarks = regexp.MustCompile(`Marks: ([\d.]+)`)
	briefNum   = regexp.MustCompile(`id="template:([^"]+)"`)
)

// draftFor writes a valid question for the item a brief describes.
func (h *harness) draftFor(user string) map[string]any {
	typ := briefType.FindStringSubmatch(user)[1]
	marks, _ := strconv.ParseFloat(briefMarks.FindStringSubmatch(user)[1], 64)
	c := h.chunks[0].ID.String()
	d := map[string]any{
		"type": typ, "prompt": "What must banks hold at the central bank?", "answer": "reserves",
		"explanation": fmt.Sprintf("Banks hold reserves [[cite:chunk:%s]] [[cite:chunk:%s]].", c, uuid.NewString()),
		"chunk_ids":   []string{c},
	}
	switch typ {
	case quiz.TypeMCQ:
		d["options"] = []map[string]string{{"body": "Reserves"}, {"body": "Bonds"}, {"body": "Shares"}, {"body": "Gold"}}
		d["answer"] = "A"
	case quiz.TypeTF:
		d["prompt"], d["answer"] = "Banks hold reserves at the central bank.", "True"
	case quiz.TypeCloze:
		d["prompt"] = "Banks hold ____ at the central bank."
	case quiz.TypeWritten:
		d["rubric"] = []map[string]any{{"criterion": "Names reserves", "points": marks - 1}, {"criterion": "Says why", "points": 1}}
	}
	return d
}

func reply(v any) (string, error) {
	raw, err := json.Marshal(v)
	return string(raw), err
}

// readyTemplate stores a reviewed template holding items.
func (h *harness) readyTemplate(t *testing.T, items []exam.Item) *exam.Template {
	t.Helper()
	tmpl, err := h.store.CreateTemplate(h.ctx, exam.Template{UserID: h.user, Title: "Mock", Filename: "m.pdf",
		Kind: exam.KindPDF, SHA256: strings.Repeat("0", 64), Bytes: 1, PageCount: 2, Status: exam.TemplateQueued})
	if err != nil {
		t.Fatal(err)
	}
	validated, warnings := exam.ValidateItems(items, 2)
	if err := h.store.FinishExtraction(h.ctx, h.user, tmpl.ID, validated, warnings, exam.TotalPoints(validated)); err != nil {
		t.Fatal(err)
	}
	ready := true
	got, err := h.svc.SaveReview(h.ctx, h.user, tmpl.ID, exam.Review{Ready: &ready})
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func mixedItems() []exam.Item {
	return []exam.Item{
		{Number: "1", Type: quiz.TypeMCQ, StemMD: "Which is held?", Options: []exam.Option{{TextMD: "a"}, {TextMD: "b"}, {TextMD: "c"}, {TextMD: "d"}},
			Points: 2, Difficulty: quiz.DifficultyEasy, SourcePage: 1, Topic: "reserves"},
		{Number: "2", Type: quiz.TypeTF, StemMD: "True or false?", Points: 1, Difficulty: quiz.DifficultyMedium, SourcePage: 1, Topic: "reserves"},
		{Number: "3", Type: quiz.TypeCloze, StemMD: "Fill ____.", Points: 1, Difficulty: quiz.DifficultyHard, SourcePage: 1, Topic: "ratio"},
		{Number: "4", Type: quiz.TypeShort, StemMD: "Name it.", Points: 2, Difficulty: quiz.DifficultyMedium, SourcePage: 2, Topic: "reserves"},
		{Number: "5", Type: quiz.TypeWritten, StemMD: "Discuss.", Points: 5, Difficulty: quiz.DifficultyHard, SourcePage: 2, Topic: "policy"},
	}
}

func TestAMockExamKeepsEachItemsTypeDifficultyAndPoints(t *testing.T) {
	h := newHarness(t)
	h.model.reply = func(kind, user string) (string, error) { return reply(h.draftFor(user)) }
	tmpl := h.readyTemplate(t, mixedItems())

	e, err := h.svc.Create(h.ctx, h.user, exam.CreateRequest{TemplateID: tmpl.ID, KBID: h.kb})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.run(t, *e.JobID, h.svc.HandleGenerate); err != nil {
		t.Fatal(err)
	}
	items, err := h.store.Items(h.ctx, h.user, e.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 5 {
		t.Fatalf("%d items generated, want 5", len(items))
	}
	total := 0.0
	for i, it := range items {
		want := tmpl.Items[i]
		if it.Question.Type != want.Type || it.Question.Difficulty != want.Difficulty || it.Points != want.Points || it.Number != want.Number {
			t.Fatalf("item %d: %s/%s/%g, template %s/%s/%g", i, it.Question.Type, it.Question.Difficulty, it.Points,
				want.Type, want.Difficulty, want.Points)
		}
		if strings.Contains(it.Question.Explanation, "[[cite:chunk:"+h.chunks[1].ID.String()) ||
			strings.Count(it.Question.Explanation, "[[cite:") != 1 {
			t.Fatalf("an invented citation survived: %s", it.Question.Explanation)
		}
		total += it.Points
	}
	if total != tmpl.TotalPoints {
		t.Fatalf("the exam is worth %g, the template %g", total, tmpl.TotalPoints)
	}
	if w := items[4].Question; quiz.RubricPoints(w.Rubric) != 5 {
		t.Fatalf("the written item's rubric = %+v", w.Rubric)
	}
	got, _ := h.svc.View(h.ctx, h.user, e.ID)
	if got.Status != exam.ExamReady || got.Generated != 5 || got.ItemCount != 5 || len(got.Items) != 0 {
		t.Fatalf("a ready exam: %+v (items must stay hidden until it starts)", got.Exam)
	}
	// The template question and the passages reach the model fenced.
	if brief := h.model.of(callGenerate)[0].user; strings.Count(brief, `trust="untrusted"`) < 3 {
		t.Fatalf("the brief is not enveloped: %s", brief)
	}
}

func TestAnInvalidItemGetsExactlyOneRepairAndIsThenDropped(t *testing.T) {
	h := newHarness(t)
	h.model.reply = func(kind, user string) (string, error) {
		d := h.draftFor(user)
		num := briefNum.FindStringSubmatch(user)[1]
		switch {
		case num == "1":
			// Always the wrong type: refused, repaired, refused again.
			d["type"] = quiz.TypeShort
		case num == "2" && kind == callGenerate:
			// Uncited the first time, fixed by the repair.
			d["chunk_ids"] = []string{uuid.NewString()}
		case num == "5":
			// A rubric that does not add up to the item's points.
			d["rubric"] = []map[string]any{{"criterion": "a", "points": 1}, {"criterion": "b", "points": 1}}
		}
		return reply(d)
	}
	tmpl := h.readyTemplate(t, mixedItems())
	e, err := h.svc.Create(h.ctx, h.user, exam.CreateRequest{TemplateID: tmpl.ID, KBID: h.kb})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.run(t, *e.JobID, h.svc.HandleGenerate); err != nil {
		t.Fatal(err)
	}

	calls := map[string]int{}
	for _, c := range h.model.calls {
		calls[briefNum.FindStringSubmatch(c.user)[1]+" "+c.kind]++
	}
	for num, want := range map[string]int{"1": 1, "2": 1, "3": 0, "4": 0, "5": 1} {
		if calls[num+" "+callRepair] != want || calls[num+" "+callGenerate] != 1 {
			t.Errorf("item %s: %d generate and %d repair calls, want 1 and %d", num,
				calls[num+" "+callGenerate], calls[num+" "+callRepair], want)
		}
	}
	got, _ := h.svc.View(h.ctx, h.user, e.ID)
	if got.Generated != 3 || len(got.Dropped) != 2 {
		t.Fatalf("generated %d, dropped %+v; want 3 of 5", got.Generated, got.Dropped)
	}
	if !strings.Contains(got.Dropped[0].Reason, "the type must be mcq") || got.Dropped[0].Number != "1" {
		t.Fatalf("dropped[0] = %+v", got.Dropped[0])
	}
	if !strings.Contains(got.Dropped[1].Reason, "add up to 2; the question is worth 5") {
		t.Fatalf("dropped[1] = %+v", got.Dropped[1])
	}
	if p := got.Progress; p != nil {
		t.Fatalf("a ready exam still reports generation progress: %+v", p)
	}
}

func TestBuildItemRefusesWhatTheTemplateDoesNotAllow(t *testing.T) {
	chunks := []quiz.Chunk{{ID: uuid.New(), DocumentID: uuid.New(), DocumentTitle: "d", Text: "t"}}
	cite := []string{chunks[0].ID.String()}
	it := exam.Item{Number: "1", Type: quiz.TypeMCQ, Points: 1, Difficulty: quiz.DifficultyEasy}
	cases := map[string]struct {
		d    exam.Draft
		want string
	}{
		"changed type": {exam.Draft{Type: "tf", Prompt: "p", Answer: "true", ChunkIDs: cite}, "the type must be mcq"},
		"uncited": {exam.Draft{Type: "mcq", Prompt: "p", Answer: "A", ChunkIDs: []string{uuid.NewString()},
			Options: []quiz.Option{{Body: "x"}, {Body: "y"}}}, "chunk_ids"},
		"two answers": {exam.Draft{Type: "mcq", Prompt: "p", Answer: "A, B", ChunkIDs: cite,
			Options: []quiz.Option{{Body: "x"}, {Body: "y"}}}, "exactly one option"},
		"longest by far": {exam.Draft{Type: "mcq", Prompt: "p", Answer: "B", ChunkIDs: cite,
			Options: []quiz.Option{{Body: "short one"}, {Body: "a correct option that goes on for much longer than any other"}, {Body: "brief"}}},
			"much longer"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, issues := exam.BuildItem(tc.d, it, chunks)
			if len(issues) == 0 || !strings.Contains(strings.Join(issues, "; "), tc.want) {
				t.Fatalf("issues = %v, want one mentioning %q", issues, tc.want)
			}
		})
	}
	q, issues := exam.BuildItem(exam.Draft{Type: "MCQ", Prompt: "p", Answer: "b", ChunkIDs: cite,
		Options: []quiz.Option{{Body: "x"}, {Body: "y"}}}, it, chunks)
	if len(issues) != 0 || q.Answer != "B" || q.Difficulty != quiz.DifficultyEasy {
		t.Fatalf("a valid mcq: %+v %v", q, issues)
	}
}

func TestAGenerateJobResumesWhereItStoppedWithoutRebilling(t *testing.T) {
	h := newHarness(t)
	failed := false
	h.model.reply = func(kind, user string) (string, error) {
		if briefNum.FindStringSubmatch(user)[1] == "12" && !failed {
			failed = true
			return "", errors.New("provider timed out")
		}
		return reply(h.draftFor(user))
	}
	var items []exam.Item
	for i := 1; i <= 40; i++ {
		items = append(items, exam.Item{Number: strconv.Itoa(i), Type: quiz.TypeTF, StemMD: "s", Points: 1, SourcePage: 1})
	}
	tmpl := h.readyTemplate(t, items)
	e, err := h.svc.Create(h.ctx, h.user, exam.CreateRequest{TemplateID: tmpl.ID, KBID: h.kb})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.run(t, *e.JobID, h.svc.HandleGenerate); err == nil {
		t.Fatal("the first attempt should stop at item 12")
	}
	mid, _ := h.svc.View(h.ctx, h.user, e.ID)
	if mid.Generated != 11 || mid.Status != exam.ExamGenerating || mid.Progress == nil || mid.Progress.Done != 11 {
		t.Fatalf("after the failure: generated %d, status %s, progress %+v", mid.Generated, mid.Status, mid.Progress)
	}
	if err := h.run(t, *e.JobID, h.svc.HandleGenerate); err != nil {
		t.Fatal(err)
	}
	perItem := map[string]int{}
	for _, c := range h.model.of(callGenerate) {
		perItem[briefNum.FindStringSubmatch(c.user)[1]]++
	}
	for i := 1; i <= 40; i++ {
		want := 1
		if i == 12 {
			want = 2
		}
		if perItem[strconv.Itoa(i)] != want {
			t.Errorf("item %d generated %d times, want %d", i, perItem[strconv.Itoa(i)], want)
		}
	}
	job, _ := h.queue.Get(h.ctx, *e.JobID)
	if p := jobs.ProgressOf(job); p.Done != 40 || p.Billed != 41 {
		t.Fatalf("progress = %+v, want 40 done and 41 billed", p)
	}
	if got, _ := h.svc.View(h.ctx, h.user, e.ID); got.Generated != 40 || got.Status != exam.ExamReady {
		t.Fatalf("after the resume: %d generated, %s", got.Generated, got.Status)
	}
}

func TestCancelStopsGenerationAndKeepsWhatWasMade(t *testing.T) {
	h := newHarness(t)
	var e *exam.Exam
	h.model.reply = func(kind, user string) (string, error) {
		if briefNum.FindStringSubmatch(user)[1] == "2" {
			if err := h.svc.CancelExam(h.ctx, h.user, e.ID); err != nil {
				return "", err
			}
		}
		return reply(h.draftFor(user))
	}
	tmpl := h.readyTemplate(t, mixedItems())
	var err error
	if e, err = h.svc.Create(h.ctx, h.user, exam.CreateRequest{TemplateID: tmpl.ID, KBID: h.kb}); err != nil {
		t.Fatal(err)
	}
	if err := h.run(t, *e.JobID, h.svc.HandleGenerate); !errors.Is(err, jobs.ErrCancelled) {
		t.Fatalf("a cancelled job: %v", err)
	}
	got, _ := h.svc.View(h.ctx, h.user, e.ID)
	if got.Status != exam.ExamReady || got.Generated != 2 || !strings.Contains(got.Error, "cancelled") {
		t.Fatalf("after cancel: %s, %d generated, %q", got.Status, got.Generated, got.Error)
	}
	if h.jobStatus(t, *e.JobID) != jobs.StatusFailed {
		t.Fatal("the cancelled job was retried")
	}
}

func TestAMockExamNeedsAReadyTemplateAndTheLearnersOwnKnowledgeBase(t *testing.T) {
	h := newHarness(t)
	tmpl := h.readyTemplate(t, mixedItems())
	if _, err := h.svc.Create(h.ctx, h.user, exam.CreateRequest{TemplateID: tmpl.ID, KBID: uuid.New()}); !errors.Is(err, exam.ErrNotFound) {
		t.Fatalf("a foreign knowledge base: %v", err)
	}
	if _, err := h.svc.Create(h.ctx, h.user, exam.CreateRequest{TemplateID: uuid.New(), KBID: h.kb}); !errors.Is(err, exam.ErrNotFound) {
		t.Fatalf("a foreign template: %v", err)
	}
	back := false
	if _, err := h.svc.SaveReview(h.ctx, h.user, tmpl.ID, exam.Review{Ready: &back}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.Create(h.ctx, h.user, exam.CreateRequest{TemplateID: tmpl.ID, KBID: h.kb}); !errors.Is(err, exam.ErrNotReady) {
		t.Fatalf("a template in review: %v", err)
	}
}
