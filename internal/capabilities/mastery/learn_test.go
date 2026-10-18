package mastery

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/runtime"
)

// learn_test.go proves the learn and explain-back rules with a scripted model
// and an in-memory store. The store's own half (the row lock, the gate, the
// replay) is proven against Postgres in internal/store/pg; the whole chain
// through the real BYOK resolver in internal/app.

// ── scripted model ────────────────────────────────────────────────────────

type scriptedModel struct {
	mu      sync.Mutex
	replies []string
	calls   int
	users   []string
}

func (m *scriptedModel) Chat(_ context.Context, req runtime.ChatRequest) (*runtime.ChatResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.users = append(m.users, req.Messages[len(req.Messages)-1].Content)
	reply := m.replies[min(m.calls, len(m.replies)-1)]
	m.calls++
	return &runtime.ChatResponse{Content: reply}, nil
}

func (m *scriptedModel) ChatStream(ctx context.Context, req runtime.ChatRequest, _ func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
	return m.Chat(ctx, req)
}
func (m *scriptedModel) DefaultModel() string { return "fake-1" }
func (m *scriptedModel) Name() string         { return "scripted" }

type resolver struct{ model *scriptedModel }

func (r resolver) ChatFor(context.Context, uuid.UUID, string) (runtime.ChatProvider, error) {
	return r.model, nil
}

type retriever struct{ chunks []quiz.Chunk }

func (r retriever) Search(context.Context, uuid.UUID, []uuid.UUID, string, int) ([]quiz.Chunk, error) {
	return r.chunks, nil
}

// ── in-memory store ───────────────────────────────────────────────────────

// fakeStore implements what these tests touch; anything else panics through
// the nil embedded interface, which is how a test learns it touched more.
type fakeStore struct {
	Store
	mu           sync.Mutex
	user         uuid.UUID
	path         Path
	module       Module
	point        KnowledgePoint
	explanations map[int]Explanation
	attempts     map[uuid.UUID]*ExplainBackAttempt // by request id
	verdicts     []ExplainVerdict
	saves        int
	progress     PointProgress
	candidates   []learning.Candidate
	awaiting     []uuid.UUID
	graduateRuns int
}

func newFakeStore(kpType string) *fakeStore {
	user := uuid.New()
	path := Path{ID: uuid.New(), UserID: user, KBID: uuid.New(), Goal: "g", Status: StatusActive}
	module := Module{ID: uuid.New(), UserID: user, PathID: path.ID, Name: "Memory in RAG", PassThreshold: 0.7}
	point := KnowledgePoint{ID: uuid.New(), UserID: user, ModuleID: module.ID, Name: "Parametric memory", Type: kpType}
	return &fakeStore{user: user, path: path, module: module, point: point,
		explanations: map[int]Explanation{}, attempts: map[uuid.UUID]*ExplainBackAttempt{}}
}

func (f *fakeStore) KnowledgePoint(_ context.Context, userID, kpID uuid.UUID) (*KnowledgePoint, *Module, error) {
	if userID != f.user || kpID != f.point.ID {
		return nil, nil, ErrNotFound
	}
	p, m := f.point, f.module
	return &p, &m, nil
}

func (f *fakeStore) GetPath(_ context.Context, userID, pathID uuid.UUID) (*Path, error) {
	if userID != f.user || pathID != f.path.ID {
		return nil, ErrNotFound
	}
	p := f.path
	return &p, nil
}

func (f *fakeStore) Explanation(_ context.Context, _, _ uuid.UUID, _ string, variant int) (*Explanation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	e, ok := f.explanations[variant]
	if !ok {
		return nil, ErrNotFound
	}
	return &e, nil
}

func (f *fakeStore) SaveExplanation(_ context.Context, e Explanation, _ []DocVersion) (*Explanation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.saves++
	e.ID = uuid.New()
	f.explanations[e.Variant] = e
	return &e, nil
}

func (f *fakeStore) DocumentVersions(context.Context, uuid.UUID, []uuid.UUID) ([]DocVersion, error) {
	return nil, nil
}

// ResolveSources answers from the chunks the retriever serves, as the real
// store answers from the caller's own chunks.
func (f *fakeStore) ResolveSources(_ context.Context, _ uuid.UUID, ids []uuid.UUID) ([]citations.Source, error) {
	out := []citations.Source{}
	for _, id := range ids {
		for _, c := range testChunks {
			if c.ID == id {
				out = append(out, chunkSources([]quiz.Chunk{c})...)
			}
		}
	}
	return out, nil
}

func (f *fakeStore) AppendEvent(context.Context, uuid.UUID, uuid.UUID, string, any) (int64, error) {
	return 1, nil
}

func (f *fakeStore) ReserveExplainBack(_ context.Context, a ExplainBackAttempt) (*ExplainBackAttempt, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if existing, ok := f.attempts[a.RequestID]; ok {
		cp := *existing
		return &cp, false, nil
	}
	a.ID, a.Verdict = uuid.New(), VerdictPending
	f.attempts[a.RequestID] = &a
	cp := a
	return &cp, true, nil
}

func (f *fakeStore) ReleaseExplainBack(_ context.Context, _, attemptID uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for k, a := range f.attempts {
		if a.ID == attemptID && a.Verdict == VerdictPending {
			delete(f.attempts, k)
		}
	}
	return nil
}

func (f *fakeStore) RecordExplainVerdict(_ context.Context, _, attemptID uuid.UUID, v ExplainVerdict, _ time.Time) (*ExplainBackAttempt, *quiz.Scheduled, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.verdicts = append(f.verdicts, v)
	for _, a := range f.attempts {
		if a.ID == attemptID {
			a.Verdict, a.Gaps, a.Misconceptions, a.Feedback, a.Sources, a.Model =
				v.Verdict, v.Gaps, v.Misconceptions, v.Feedback, v.Sources, v.Model
			a.Passed = v.Verdict == VerdictPassed
			cp := *a
			var sched *quiz.Scheduled
			if v.Verdict != VerdictUnjudged {
				sched = &quiz.Scheduled{KnowledgePointID: a.KnowledgePointID}
			}
			return &cp, sched, nil
		}
	}
	return nil, nil, ErrNotFound
}

func (f *fakeStore) Graduate(context.Context, uuid.UUID, uuid.UUID, time.Time) ([]GraduatedModule, error) {
	f.graduateRuns++
	return nil, nil
}

func (f *fakeStore) Candidates(context.Context, uuid.UUID, uuid.UUID) ([]learning.Candidate, error) {
	return f.candidates, nil
}

func (f *fakeStore) PointProgress(context.Context, uuid.UUID, uuid.UUID) (*PointProgress, error) {
	p := f.progress
	return &p, nil
}

func (f *fakeStore) AwaitingExplainBack(context.Context, uuid.UUID, uuid.UUID) ([]uuid.UUID, error) {
	return f.awaiting, nil
}

func (f *fakeStore) LatestExplainBack(context.Context, uuid.UUID, uuid.UUID) (*ExplainBackAttempt, error) {
	return nil, ErrNotFound
}

// ── fixtures ──────────────────────────────────────────────────────────────

var testChunks = []quiz.Chunk{{
	ID: uuid.MustParse("11111111-1111-4111-8111-111111111111"), DocumentID: uuid.New(),
	DocumentTitle: "rag.pdf", Page: 2,
	Text: "Parametric memory is the knowledge stored in the model's weights.",
}}

const realCite = "[[cite:chunk:11111111-1111-4111-8111-111111111111]]"
const fakeCite = "[[cite:chunk:00000000-0000-4000-8000-000000000000]]"

func newTestService(t *testing.T, kpType string, replies ...string) (*Service, *fakeStore, *scriptedModel) {
	t.Helper()
	store := newFakeStore(kpType)
	model := &scriptedModel{replies: replies}
	svc := NewService(Config{
		Store: store, Providers: resolver{model}, Retriever: retriever{testChunks},
		Now: func() time.Time { return time.Date(2026, 9, 27, 9, 0, 0, 0, time.UTC) },
	})
	return svc, store, model
}

const learnReply = `{"explanation": "Parametric memory is what a model knows from training: it lives in the weights. ` +
	realCite + ` It is cheap to update. ` + fakeCite + `"}`

// ── learn ─────────────────────────────────────────────────────────────────

func TestLearnCachesAndASecondVisitMakesNoModelCall(t *testing.T) {
	svc, store, model := newTestService(t, "concept", learnReply)

	first, err := svc.Learn(context.Background(), store.user, store.point.ID, LearnRequest{})
	if err != nil {
		t.Fatalf("Learn: %v", err)
	}
	if strings.Contains(first.BodyMD, fakeCite) || !strings.Contains(first.BodyMD, realCite) {
		t.Fatalf("the body kept an invented citation or lost the real one: %q", first.BodyMD)
	}
	if len(first.Sources) != 1 || first.Sources[0].Page != 2 {
		t.Fatalf("sources = %+v", first.Sources)
	}
	if !strings.Contains(model.users[0], `trust="untrusted"`) {
		t.Error("the passages reached the model without the provenance envelope")
	}

	second, err := svc.Learn(context.Background(), store.user, store.point.ID, LearnRequest{})
	if err != nil {
		t.Fatalf("second Learn: %v", err)
	}
	if model.calls != 1 || store.saves != 1 {
		t.Fatalf("the second visit cost %d model calls and %d writes; want 1 and 1", model.calls, store.saves)
	}
	if !second.Cached || second.BodyMD != first.BodyMD {
		t.Fatalf("second visit = %+v, want the cached body", second)
	}

	// "Explain it differently" is a new variant: one more call, a different
	// angle in the prompt.
	v := 1
	if _, err := svc.Learn(context.Background(), store.user, store.point.ID, LearnRequest{Variant: &v}); err != nil {
		t.Fatalf("variant: %v", err)
	}
	if model.calls != 2 || !strings.Contains(model.users[1], angles[1]) {
		t.Fatalf("variant 1: %d calls, prompt %q", model.calls, model.users[1])
	}
}

func TestAStaleExplanationIsServedFlaggedAndRewrittenOnlyOnRequest(t *testing.T) {
	svc, store, model := newTestService(t, "concept", learnReply)
	store.explanations[0] = Explanation{KnowledgePointID: store.point.ID, Model: "fake-1",
		BodyMD: "Old text. " + realCite, Sources: chunkSources(testChunks), Stale: true}

	got, err := svc.Learn(context.Background(), store.user, store.point.ID, LearnRequest{})
	if err != nil || !got.Stale || model.calls != 0 {
		t.Fatalf("stale visit: %+v, %v, %d calls; want the stale entry, free", got, err, model.calls)
	}
	got, err = svc.Learn(context.Background(), store.user, store.point.ID, LearnRequest{Refresh: true})
	if err != nil || got.Stale || model.calls != 1 {
		t.Fatalf("refresh: %+v, %v, %d calls; want a fresh rewrite", got, err, model.calls)
	}
}

func TestAnExplanationCitingNothingRealIsRefusedAndNotCached(t *testing.T) {
	svc, store, _ := newTestService(t, "concept", `{"explanation": "From memory. `+fakeCite+`"}`)
	_, err := svc.Learn(context.Background(), store.user, store.point.ID, LearnRequest{})
	if !errors.Is(err, ErrBadExplanation) || store.saves != 0 {
		t.Fatalf("err = %v, saves = %d; want ErrBadExplanation and nothing cached", err, store.saves)
	}
}

func TestLearnRefusesAnotherUsersPointBeforeAnyModelCall(t *testing.T) {
	svc, store, model := newTestService(t, "concept", learnReply)
	if _, err := svc.Learn(context.Background(), uuid.New(), store.point.ID, LearnRequest{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
	if model.calls != 0 {
		t.Fatal("a foreign point id reached the model")
	}
}

// ── explain back ──────────────────────────────────────────────────────────

func explain(svc *Service, store *fakeStore, text string, requestID uuid.UUID) (*ExplainBackResult, error) {
	return svc.ExplainBack(context.Background(), store.user, store.point.ID,
		ExplainBackRequest{Text: text, RequestID: requestID})
}

const learnerText = "It is the knowledge a model keeps from training."

func TestAnInventedCitationInAVerdictIsDropped(t *testing.T) {
	svc, store, model := newTestService(t, "concept",
		`{"gaps": ["Say where it is stored. `+realCite+`", "Mention the index. `+fakeCite+`"],
		  "misconceptions": [], "feedback": "Close. `+fakeCite+`", "passed": false}`)

	res, err := explain(svc, store, learnerText, uuid.New())
	if err != nil {
		t.Fatalf("ExplainBack: %v", err)
	}
	a := res.Attempt
	if a.Verdict != VerdictFailed || len(a.Gaps) != 2 {
		t.Fatalf("attempt = %+v", a)
	}
	for _, text := range append(append([]string{}, a.Gaps...), a.Feedback) {
		if strings.Contains(text, fakeCite) {
			t.Fatalf("an invented citation survived: %q", text)
		}
	}
	if !strings.Contains(a.Gaps[0], realCite) || len(a.Sources) != 1 {
		t.Fatalf("the real citation was lost: gaps %q sources %+v", a.Gaps, a.Sources)
	}
	// The learner's text is enveloped like a document.
	if !strings.Contains(model.users[0], `source="the learner's explanation"`) {
		t.Error("the learner's explanation reached the model without the envelope")
	}
	if store.graduateRuns != 1 {
		t.Errorf("graduation checked %d times, want once in the same request", store.graduateRuns)
	}
}

func TestAVerdictWithAMisconceptionCannotPass(t *testing.T) {
	svc, store, _ := newTestService(t, "design",
		`{"gaps": [], "misconceptions": ["It is not in the index. `+realCite+`"], "feedback": "", "passed": true}`)
	res, err := explain(svc, store, learnerText, uuid.New())
	if err != nil {
		t.Fatalf("ExplainBack: %v", err)
	}
	if res.Attempt.Verdict != VerdictFailed {
		t.Fatalf("verdict = %s; a misconception must fail however `passed` is set", res.Attempt.Verdict)
	}
}

func TestAnUnreadableVerdictIsUnjudgedAndChangesNoSchedule(t *testing.T) {
	svc, store, _ := newTestService(t, "concept", "I think they did fine!")
	res, err := explain(svc, store, learnerText, uuid.New())
	if err != nil {
		t.Fatalf("ExplainBack: %v", err)
	}
	if res.Attempt.Verdict != VerdictUnjudged || res.Attempt.Passed || res.Scheduled != nil {
		t.Fatalf("result = %+v; want unjudged, not passed, nothing scheduled", res)
	}
	if !strings.Contains(res.Attempt.Feedback, "could not be read") {
		t.Errorf("feedback %q does not say it could not judge", res.Attempt.Feedback)
	}
}

func TestAReplayedRequestIDReturnsTheStoredVerdictWithoutJudgingAgain(t *testing.T) {
	svc, store, model := newTestService(t, "concept",
		`{"gaps": [], "misconceptions": [], "feedback": "Right. `+realCite+`", "passed": true}`)
	id := uuid.New()
	first, err := explain(svc, store, learnerText, id)
	if err != nil || first.Replayed {
		t.Fatalf("first: %+v, %v", first, err)
	}
	second, err := explain(svc, store, learnerText, id)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if !second.Replayed || second.Attempt.ID != first.Attempt.ID || second.Attempt.Verdict != VerdictPassed {
		t.Fatalf("replay = %+v", second)
	}
	if model.calls != 1 || len(store.verdicts) != 1 {
		t.Fatalf("judged %d times, recorded %d verdicts; want 1 and 1", model.calls, len(store.verdicts))
	}
}

func TestExplainBackRefusesMemoryPointsAndBadText(t *testing.T) {
	svc, store, model := newTestService(t, "memory", `{}`)
	if _, err := explain(svc, store, learnerText, uuid.New()); !errors.Is(err, ErrBadRequest) {
		t.Fatalf("memory point: err = %v, want ErrBadRequest", err)
	}
	svc, store, _ = newTestService(t, "concept", `{}`)
	for _, text := range []string{"too short", strings.Repeat("x", ExplainMaxChars+1)} {
		if _, err := explain(svc, store, text, uuid.New()); !errors.Is(err, ErrBadRequest) {
			t.Fatalf("%d characters: err = %v, want ErrBadRequest", len(text), err)
		}
	}
	if _, err := explain(svc, store, learnerText, uuid.Nil); !errors.Is(err, ErrBadRequest) {
		t.Fatalf("no request_id: err = %v", err)
	}
	if model.calls != 0 {
		t.Fatal("a refused request reached the model")
	}
}

// ── Next ──────────────────────────────────────────────────────────────────

func TestNextTeachesBeforeTestingAndAsksForTheExplanationAfterACorrectAnswer(t *testing.T) {
	svc, store, _ := newTestService(t, "concept", learnReply)
	store.candidates = []learning.Candidate{{
		KPID: store.point.ID, KPName: store.point.Name, Type: "concept", ModuleID: store.module.ID,
		DueAt: time.Date(2026, 9, 27, 8, 0, 0, 0, time.UTC),
	}}

	// Never answered right, never taught: learn.
	next, err := svc.Next(context.Background(), store.user, store.path.ID)
	if err != nil || next.Kind != NextLearnKind || next.Explanation == nil || next.Question != nil {
		t.Fatalf("first Next = %+v, %v; want a learn card", next, err)
	}

	// Answered right, awaiting its explanation: explain_back, no model call.
	store.progress = PointProgress{HasCorrect: true, Taught: true, AwaitingExplain: true}
	next, err = svc.Next(context.Background(), store.user, store.path.ID)
	if err != nil || next.Kind != NextExplainKind || next.Prompt == "" {
		t.Fatalf("Next after a correct answer = %+v, %v; want an explain-back prompt", next, err)
	}

	// Answered right before (an older path): never taught unasked.
	store.progress = PointProgress{HasCorrect: true}
	store.explanations = map[int]Explanation{}
	svc.quiz = stubQuiz{}
	next, err = svc.Next(context.Background(), store.user, store.path.ID)
	if err != nil || next.Kind != NextQuestionKind {
		t.Fatalf("Next on an answered point = %+v, %v; want a question", next, err)
	}
}

type stubQuiz struct{}

func (stubQuiz) Generate(context.Context, uuid.UUID, quiz.GenerateRequest) (*quiz.GenerateResult, error) {
	return &quiz.GenerateResult{Questions: []quiz.Question{{ID: uuid.New(), Prompt: "p", Type: quiz.TypeShort}}}, nil
}

func (f *fakeStore) UnansweredQuestion(context.Context, uuid.UUID, uuid.UUID) (*quiz.Question, error) {
	return nil, quiz.ErrNotFound
}
