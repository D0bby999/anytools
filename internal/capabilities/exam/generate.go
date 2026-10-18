package exam

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/jobs"
	examprompts "github.com/D0bby999/anytools/internal/prompts/exam"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// generate.go writes a mock exam: for each template item, retrieve from the
// knowledge base on the item's topic, and ask for a new question with the
// SAME type, difficulty and points. Go validates the reply against the type's
// rules; a reply that breaks one gets exactly one repair call, and is then
// dropped with its reason. The exam reports "N of M items generated".

type generatePayload struct {
	ExamID uuid.UUID `json:"exam_id"`
}

// CreateRequest is `POST /v1/exams`.
type CreateRequest struct {
	TemplateID uuid.UUID `json:"template_id"`
	KBID       uuid.UUID `json:"kb_id"`
}

// Create checks the template and the knowledge base, stores the exam and
// queues its generation. Another user's template or knowledge base answers
// exactly like a missing one.
func (s *Service) Create(ctx context.Context, userID uuid.UUID, r CreateRequest) (*Exam, error) {
	if r.TemplateID == uuid.Nil || r.KBID == uuid.Nil {
		return nil, errorf("choose a template and a knowledge base")
	}
	if err := s.authz.OwnsKB(ctx, userID, r.KBID); err != nil {
		return nil, ErrNotFound
	}
	t, err := s.store.GetTemplate(ctx, userID, r.TemplateID)
	if err != nil {
		return nil, ErrNotFound
	}
	if t.Status != TemplateReady || len(t.Items) == 0 {
		return nil, ErrNotReady
	}
	if _, err := s.models.ChatFor(ctx, userID, functionQuiz); err != nil {
		return nil, err
	}
	blueprint := t.Items[:min(len(t.Items), MaxGenerate)]
	e, err := s.store.CreateExam(ctx, Exam{
		UserID: userID, TemplateID: &t.ID, KBID: r.KBID, Title: t.Title, Status: ExamGenerating,
		Blueprint: blueprint, Requested: len(blueprint), TimeLimitMinutes: t.TimeLimitMinutes,
	})
	if err != nil {
		return nil, err
	}
	// Two attempts: a retry resumes at the first item not yet stored.
	jobID, err := s.queue.Enqueue(ctx, userID, jobs.KindGenerateExam, generatePayload{ExamID: e.ID}, 2)
	if err != nil {
		_, _ = s.store.DeleteExam(ctx, userID, e.ID)
		return nil, err
	}
	if err := s.store.SetExamJob(ctx, userID, e.ID, jobID); err != nil {
		return nil, err
	}
	e.JobID = &jobID
	return e, nil
}

// HandleGenerate is the generate_exam job.
func (s *Service) HandleGenerate(ctx context.Context, job *jobs.Job) error {
	var p generatePayload
	if err := json.Unmarshal(job.Payload, &p); err != nil {
		return jobs.Terminal(fmt.Errorf("exam: unreadable payload: %w", err))
	}
	e, err := s.store.GetExam(ctx, job.UserID, p.ExamID)
	if err != nil || e.Status != ExamGenerating {
		return nil
	}
	err = s.queue.RunUnits(ctx, job, len(e.Blueprint), func(ctx context.Context, i int) (int, error) {
		return s.generateItem(ctx, e, i)
	})
	if err != nil {
		return terminalIfFinal(err)
	}
	return s.store.FinishGeneration(ctx, e.UserID, e.ID, "")
}

// Draft is the model's question for one item.
type Draft struct {
	Prompt      string           `json:"prompt"`
	Type        string           `json:"type"`
	Options     []quiz.Option    `json:"options"`
	Answer      string           `json:"answer"`
	Explanation string           `json:"explanation"`
	ChunkIDs    []string         `json:"chunk_ids"`
	Rubric      []quiz.Criterion `json:"rubric"`
}

// generateItem is one unit: item i of the blueprint, generated and stored, or
// dropped with its reason. It reports the calls it made.
func (s *Service) generateItem(ctx context.Context, e *Exam, i int) (int, error) {
	// A unit stored just before a crash, whose checkpoint was not: done.
	if done, err := s.store.HasUnit(ctx, e.UserID, e.ID, i); err != nil || done {
		return 0, err
	}
	it := e.Blueprint[i]
	drop := func(reason string) error {
		return s.store.AddDropped(ctx, e.UserID, e.ID, Dropped{Ord: i, Number: it.Number, Reason: reason})
	}

	query := it.Topic
	if query == "" {
		query = trimRunes(it.StemMD, 300)
	}
	chunks, err := s.retriever.Search(ctx, e.UserID, []uuid.UUID{e.KBID}, query, RetrievalLimit)
	if err != nil {
		return 0, err
	}
	if len(chunks) == 0 {
		return 0, drop("the knowledge base has nothing on this question's topic")
	}
	provider, err := s.models.ChatFor(ctx, e.UserID, functionQuiz)
	if err != nil {
		return 0, err
	}

	brief := itemBrief(it, chunks)
	var d Draft
	q, issues, err := s.ask(ctx, provider, examprompts.Generate, brief, &d, it, chunks)
	if err != nil {
		return 1, err
	}
	billed := 1
	if len(issues) > 0 {
		// Exactly one repair, naming every rule broken.
		billed = 2
		previous, _ := json.Marshal(d)
		repair := fmt.Sprintf("%s\n\nThe rules your question broke:\n- %s\n\nYour question:\n%s",
			brief, strings.Join(issues, "\n- "), previous)
		d = Draft{}
		q, issues, err = s.ask(ctx, provider, examprompts.Generate+"\n\n"+examprompts.Repair, repair, &d, it, chunks)
		if err != nil {
			return billed, err
		}
		if len(issues) > 0 {
			return billed, drop(strings.Join(issues, "; "))
		}
	}
	q.UserID, q.KBID = e.UserID, e.KBID
	return billed, s.store.AddGeneratedItem(ctx, e.ID, i, q, it.Points, it.Number)
}

// ask makes one generation call and validates the reply. A reply with no
// JSON is an issue (worth the repair); a provider failure is an error.
func (s *Service) ask(
	ctx context.Context, provider runtime.ChatProvider, system, user string, d *Draft, it Item, chunks []quiz.Chunk,
) (quiz.Question, []string, error) {
	if err := askJSON(ctx, provider, system, user, d); err != nil {
		if errors.Is(err, errBadReply) {
			return quiz.Question{}, []string{err.Error()}, nil
		}
		return quiz.Question{}, nil, err
	}
	q, issues := BuildItem(*d, it, chunks)
	return q, issues, nil
}

// itemBrief is the request for one item: the template question, fenced as
// untrusted (it came from an uploaded paper), and the passages.
func itemBrief(it Item, chunks []quiz.Chunk) string {
	var tmpl strings.Builder
	fmt.Fprintf(&tmpl, "Question %s (%s, %s, %g marks)\n\n%s\n", it.Number, it.Type, it.Difficulty, it.Points, it.StemMD)
	for _, o := range it.Options {
		fmt.Fprintf(&tmpl, "%s. %s\n", o.Label, o.TextMD)
	}
	for _, sq := range it.SubQuestions {
		fmt.Fprintf(&tmpl, "(%s) %s\n", sq.Label, sq.StemMD)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Type: %s (fixed).\nDifficulty: %s.\nMarks: %g.\n", it.Type, it.Difficulty, it.Points)
	if it.Type == quiz.TypeMCQ {
		fmt.Fprintf(&b, "Options: %d.\n", optionCount(it))
	}
	if it.Type == quiz.TypeWritten {
		fmt.Fprintf(&b, "The rubric's points must add up to exactly %g.\n", it.Points)
	}
	b.WriteString("\nThe template question:\n\n")
	b.WriteString(tools.Wrap("exam template, question "+it.Number, "template:"+it.Number, tmpl.String()))
	b.WriteString("\n\nPassages:\n\n")
	b.WriteString(quiz.PassageBlock(chunks))
	return b.String()
}

func optionCount(it Item) int {
	if n := len(it.Options); n >= 2 {
		return n
	}
	return 4
}

// BuildItem validates one draft against its template item and returns the
// question to store, or the rules it broke. The type, difficulty and points
// are the template's: the model may not change them.
func BuildItem(d Draft, it Item, chunks []quiz.Chunk) (quiz.Question, []string) {
	var issues []string
	issue := func(format string, args ...any) { issues = append(issues, fmt.Sprintf(format, args...)) }

	if got := strings.ToLower(strings.TrimSpace(d.Type)); got != it.Type {
		issue("the type must be %s, not %q", it.Type, d.Type)
	}
	prompt := strings.TrimSpace(d.Prompt)
	answer := strings.TrimSpace(d.Answer)
	switch {
	case prompt == "":
		issue("the prompt is empty")
	case utf8.RuneCountInString(prompt) > 4000:
		issue("the prompt is longer than 4000 characters")
	}
	if answer == "" {
		issue("the answer is empty")
	}

	// Citations are checked against exactly the passages this call was shown;
	// an invented marker is removed before anyone sees it.
	sources := make([]citations.Source, 0, len(chunks))
	for _, c := range chunks {
		sources = append(sources, citations.Source{Kind: citations.KindChunk, ID: c.ID.String(),
			Title: c.DocumentTitle, Page: c.Page, DocumentID: c.DocumentID.String()})
	}
	explanation := citations.Validate(strings.TrimSpace(d.Explanation), citations.Index(sources)).Text
	chunkIDs := quiz.ChunkIDs(d.ChunkIDs, chunks)
	if len(chunkIDs) == 0 {
		issue("chunk_ids must name at least one of the passages you were given")
	}

	var (
		options []quiz.Option
		rubric  []quiz.Criterion
	)
	switch it.Type {
	case quiz.TypeMCQ:
		options = quiz.NormalizeOptions(d.Options)
		if len(options) < 2 {
			issue("a multiple-choice question needs at least two options")
			break
		}
		label, ok := quiz.MatchOptionLabel(options, answer)
		if !ok {
			issue("the answer must be the label of exactly one option")
			break
		}
		answer = label
		if longestByFar(options, label) {
			issue("the correct option is much longer than the others; make the options similar in length")
		}
	case quiz.TypeTF:
		norm, ok := quiz.NormalizeBoolean(answer)
		if !ok {
			issue("the answer to a true/false question is exactly true or false")
		}
		answer = norm
	case quiz.TypeCloze:
		if n := strings.Count(prompt, "____"); n != 1 {
			issue("a fill-in-the-blank prompt has exactly one blank (____), this has %d", n)
		}
	case quiz.TypeWritten:
		rubric = cleanRubric(d.Rubric)
		switch {
		case len(rubric) < quiz.MinCriteria || len(rubric) > quiz.MaxCriteria:
			issue("the rubric needs %d to %d criteria, it has %d", quiz.MinCriteria, quiz.MaxCriteria, len(rubric))
		case math.Abs(quiz.RubricPoints(rubric)-it.Points) > 0.01:
			issue("the rubric's points add up to %g; the question is worth %g", quiz.RubricPoints(rubric), it.Points)
		}
	}
	if len(issues) > 0 {
		return quiz.Question{}, issues
	}
	return quiz.Question{
		Prompt: prompt, Type: it.Type, Options: options, Answer: answer, Explanation: explanation,
		Difficulty: it.Difficulty, SourceChunkIDs: chunkIDs, Rubric: rubric,
	}, nil
}

// longestByFar reports the oldest tell of the format: the correct option half
// again as long as any other, and by more than a few words.
func longestByFar(options []quiz.Option, correct string) bool {
	var right, other int
	for _, o := range options {
		n := utf8.RuneCountInString(o.Body)
		if o.Label == correct {
			right = n
		} else if n > other {
			other = n
		}
	}
	return float64(right) > 1.5*float64(other) && right-other > 20
}

// cleanRubric keeps criteria with text and positive points.
func cleanRubric(in []quiz.Criterion) []quiz.Criterion {
	out := make([]quiz.Criterion, 0, len(in))
	for _, c := range in {
		text := trimRunes(c.Criterion, 500)
		if text == "" || math.IsNaN(c.Points) || c.Points <= 0 {
			continue
		}
		out = append(out, quiz.Criterion{Criterion: text, Points: math.Round(c.Points*100) / 100})
	}
	return out
}
