package mastery

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/learning"
)

// review_test.go proves the cross-path review's interleaving rule against an
// in-memory store of several paths. The SQL half (bounded, due-only, the
// caller's rows only) is proven in internal/store/pg; the HTTP chain in
// internal/app.

var reviewNow = time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)

// reviewStore holds paths, modules and due points for one user. Every point
// has been answered right before and has a banked question, so serving never
// teaches or generates: what is under test is which point comes next.
type reviewStore struct {
	Store
	user        uuid.UUID
	paths       map[uuid.UUID]Path
	modules     map[uuid.UUID]Module
	points      map[uuid.UUID]KnowledgePoint
	due         []ReviewCandidate // oldest first, as the SQL orders them
	lastAttempt uuid.UUID
	awaiting    map[uuid.UUID][]uuid.UUID // path → points waiting for an explain-back
	progress    map[uuid.UUID]PointProgress
	limits      []int
}

func newReviewStore() *reviewStore {
	return &reviewStore{user: uuid.New(), paths: map[uuid.UUID]Path{}, modules: map[uuid.UUID]Module{},
		points: map[uuid.UUID]KnowledgePoint{}, awaiting: map[uuid.UUID][]uuid.UUID{},
		progress: map[uuid.UUID]PointProgress{}}
}

func (f *reviewStore) addPath(goal string) Path {
	p := Path{ID: uuid.New(), UserID: f.user, KBID: uuid.New(), Goal: goal, Status: StatusActive}
	f.paths[p.ID] = p
	return p
}

func (f *reviewStore) addModule(path Path, name string) Module {
	m := Module{ID: uuid.New(), UserID: f.user, PathID: path.ID, Name: name, PassThreshold: 0.7}
	f.modules[m.ID] = m
	return m
}

// addDue adds n due points to a module. Each later call's points are due
// later than every earlier one's.
func (f *reviewStore) addDue(m Module, n int) {
	for i := 0; i < n; i++ {
		kp := KnowledgePoint{ID: uuid.New(), UserID: f.user, ModuleID: m.ID,
			Name: fmt.Sprintf("%s point %d", m.Name, i+1), Type: "concept"}
		f.points[kp.ID] = kp
		f.due = append(f.due, ReviewCandidate{
			Candidate: learning.Candidate{KPID: kp.ID, KPName: kp.Name, Type: kp.Type, ModuleID: m.ID,
				ModuleName: m.Name, DueAt: reviewNow.Add(-time.Duration(1000-len(f.due)) * time.Minute)},
			PathID: m.PathID, PathGoal: f.paths[m.PathID].Goal,
		})
	}
}

// answer is what the answer route does to this store: the point leaves the
// due set and becomes the latest attempt.
func (f *reviewStore) answer(kpID uuid.UUID) {
	for i, c := range f.due {
		if c.KPID == kpID {
			f.due = append(f.due[:i], f.due[i+1:]...)
			break
		}
	}
	f.lastAttempt = kpID
}

func (f *reviewStore) ReviewCandidates(_ context.Context, userID uuid.UUID, _ time.Time, limit int) ([]ReviewCandidate, error) {
	f.limits = append(f.limits, limit)
	if userID != f.user {
		return []ReviewCandidate{}, nil
	}
	out := append([]ReviewCandidate{}, f.due...)
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// Candidates is the per-path read, for the one test that compares with Next.
func (f *reviewStore) Candidates(_ context.Context, _, pathID uuid.UUID) ([]learning.Candidate, error) {
	out := []learning.Candidate{}
	for _, c := range f.due {
		if c.PathID == pathID {
			out = append(out, c.Candidate)
		}
	}
	return out, nil
}

func (f *reviewStore) LatestExplainBack(context.Context, uuid.UUID, uuid.UUID) (*ExplainBackAttempt, error) {
	return nil, ErrNotFound
}

func (f *reviewStore) LastAttemptedPoint(_ context.Context, userID uuid.UUID) (uuid.UUID, bool, error) {
	if userID != f.user || f.lastAttempt == uuid.Nil {
		return uuid.Nil, false, nil
	}
	return f.lastAttempt, true, nil
}

func (f *reviewStore) KnowledgePoint(_ context.Context, userID, kpID uuid.UUID) (*KnowledgePoint, *Module, error) {
	kp, ok := f.points[kpID]
	if !ok || userID != f.user {
		return nil, nil, ErrNotFound
	}
	m := f.modules[kp.ModuleID]
	return &kp, &m, nil
}

func (f *reviewStore) GetPath(_ context.Context, userID, pathID uuid.UUID) (*Path, error) {
	p, ok := f.paths[pathID]
	if !ok || userID != f.user {
		return nil, ErrNotFound
	}
	return &p, nil
}

func (f *reviewStore) PointProgress(_ context.Context, _, kpID uuid.UUID) (*PointProgress, error) {
	p, ok := f.progress[kpID]
	if !ok {
		p = PointProgress{HasCorrect: true, Taught: true}
	}
	return &p, nil
}

func (f *reviewStore) UnansweredQuestion(_ context.Context, _, kpID uuid.UUID) (*quiz.Question, error) {
	return &quiz.Question{ID: uuid.New(), KnowledgePointID: &kpID, Prompt: "p", Type: quiz.TypeShort}, nil
}

func (f *reviewStore) AwaitingExplainBack(_ context.Context, _, pathID uuid.UUID) ([]uuid.UUID, error) {
	return f.awaiting[pathID], nil
}

func newReviewService(store *reviewStore) *Service {
	return NewService(Config{Store: store, Quiz: stubQuiz{}, Now: func() time.Time { return reviewNow }})
}

// threePaths is the phase file's fixture: path A with modules A1 and A2, path
// B with B1, and path C with C1. A1's points are the oldest, so a ranking
// without the rule would serve A1 four times running; and A1 outlasts B and C,
// so the end of the session has to alternate A1 and A2 inside one path.
func threePaths() *reviewStore {
	f := newReviewStore()
	a, b, c := f.addPath("Path A"), f.addPath("Path B"), f.addPath("Path C")
	f.addDue(f.addModule(a, "A1"), 4)
	f.addDue(f.addModule(a, "A2"), 2)
	f.addDue(f.addModule(b, "B1"), 1)
	f.addDue(f.addModule(c, "C1"), 1)
	return f
}

func TestReviewNeverRepeatsAModuleWhileAnotherIsDueAndAlternatesPaths(t *testing.T) {
	store := threePaths()
	svc := newReviewService(store)
	ctx := context.Background()

	total := len(store.due)
	var prev *KnowledgePoint
	for step := 0; step < total; step++ {
		// What was due before this step, by module and by path.
		modules, paths := map[uuid.UUID]bool{}, map[uuid.UUID]bool{}
		for _, c := range store.due {
			modules[c.ModuleID], paths[c.PathID] = true, true
		}

		next, err := svc.ReviewNext(ctx, store.user, nil)
		if err != nil {
			t.Fatalf("step %d: %v", step, err)
		}
		if next.Kind != NextQuestionKind || next.Question == nil {
			t.Fatalf("step %d: kind %q; the review asks one question of one point", step, next.Kind)
		}
		if next.PathGoal == "" || next.ModuleName == "" || next.PathID == uuid.Nil {
			t.Fatalf("step %d: path or module missing from %+v", step, next)
		}
		if next.Remaining != len(store.due)-1 {
			t.Errorf("step %d: remaining %d, want %d", step, next.Remaining, len(store.due)-1)
		}
		if prev != nil {
			prevModule := store.modules[prev.ModuleID]
			if next.Point.ModuleID == prev.ModuleID {
				delete(modules, prev.ModuleID)
				if len(modules) > 0 {
					t.Fatalf("step %d: %s again while another module had something due", step, next.ModuleName)
				}
			}
			if next.PathID == prevModule.PathID {
				delete(paths, prevModule.PathID)
				if len(paths) > 0 {
					t.Fatalf("step %d: %s again while another path had something due", step, next.PathGoal)
				}
			}
		}
		point := next.Point
		prev = &point
		store.answer(point.ID)
	}
	if len(store.due) != 0 {
		t.Fatalf("%d points never served", len(store.due))
	}
	for _, limit := range store.limits {
		if limit != ReviewCandidateLimit {
			t.Fatalf("candidates read with limit %d, want %d", limit, ReviewCandidateLimit)
		}
	}
}

func TestReviewFallsBackToTheSameModuleOnlyWhenNothingElseIsDue(t *testing.T) {
	store := newReviewStore()
	m := store.addModule(store.addPath("Only"), "Only module")
	store.addDue(m, 2)
	store.lastAttempt = store.due[0].KPID
	store.due = store.due[1:]

	next, err := newReviewService(store).ReviewNext(context.Background(), store.user, nil)
	if err != nil || next.Point.ModuleID != m.ID {
		t.Fatalf("ReviewNext = %+v, %v; want the same module when it is all that is due", next, err)
	}
}

func TestReviewTakesThePreviousPointFromTheLastAttemptSoAReloadKeepsTheAlternation(t *testing.T) {
	store := threePaths()
	svc := newReviewService(store)
	first, err := svc.ReviewNext(context.Background(), store.user, nil)
	if err != nil {
		t.Fatal(err)
	}
	store.answer(first.Point.ID)

	// A reload, or a second tab: no `after`, the same answer.
	for i := 0; i < 2; i++ {
		next, err := svc.ReviewNext(context.Background(), store.user, nil)
		if err != nil {
			t.Fatal(err)
		}
		if next.Point.ModuleID == first.Point.ModuleID || next.PathID == first.PathID {
			t.Fatalf("load %d after answering %s served %s/%s", i, first.ModuleName, next.PathGoal, next.ModuleName)
		}
	}
}

func TestReviewAfterOverridesTheLastAttemptAndAForeignAfterIsIgnored(t *testing.T) {
	store := threePaths()
	svc := newReviewService(store)
	ctx := context.Background()

	// The last attempt was in C1; the client says it just showed an A1 point.
	var a1, c1 ReviewCandidate
	for _, c := range store.due {
		switch c.ModuleName {
		case "A1":
			a1 = c
		case "C1":
			c1 = c
		}
	}
	store.lastAttempt = c1.KPID

	withAfter, err := svc.ReviewNext(ctx, store.user, &a1.KPID)
	if err != nil {
		t.Fatal(err)
	}
	if withAfter.PathID == a1.PathID {
		t.Fatalf("after=%s served path A again: %s", a1.KPName, withAfter.ModuleName)
	}

	without, err := svc.ReviewNext(ctx, store.user, nil)
	if err != nil {
		t.Fatal(err)
	}
	if without.PathID == c1.PathID {
		t.Fatalf("without after, the last attempt's path C was served again")
	}

	// Another user's point (here: any id this user does not own) is ignored,
	// never an error: the answer is exactly the one without it.
	foreign := uuid.New()
	ignored, err := svc.ReviewNext(ctx, store.user, &foreign)
	if err != nil {
		t.Fatalf("a foreign after is an error: %v", err)
	}
	if ignored.Point.ID != without.Point.ID {
		t.Fatalf("a foreign after changed the answer: %s, want %s", ignored.Point.Name, without.Point.Name)
	}
}

func TestReviewWithNothingDueSaysSo(t *testing.T) {
	store := newReviewStore()
	store.addModule(store.addPath("Empty"), "m")
	if _, err := newReviewService(store).ReviewNext(context.Background(), store.user, nil); !errors.Is(err, ErrNothingDue) {
		t.Fatalf("err = %v, want ErrNothingDue", err)
	}
	// Another user with due points does not make this one's review non-empty.
	other := threePaths()
	if _, err := newReviewService(other).ReviewNext(context.Background(), uuid.New(), nil); !errors.Is(err, ErrNothingDue) {
		t.Fatalf("a stranger's review = %v, want ErrNothingDue", err)
	}
}

func TestReviewLeavesExplainBacksOnTheirPathAndSaysOneIsWaiting(t *testing.T) {
	store := newReviewStore()
	path := store.addPath("Path A")
	store.addDue(store.addModule(path, "A1"), 1)
	kp := store.due[0].KPID
	store.progress[kp] = PointProgress{HasCorrect: true, Taught: true, AwaitingExplain: true}
	store.awaiting[path.ID] = []uuid.UUID{kp}

	next, err := newReviewService(store).ReviewNext(context.Background(), store.user, nil)
	if err != nil {
		t.Fatal(err)
	}
	if next.Kind != NextQuestionKind || next.Prompt != "" {
		t.Fatalf("kind %q: the review asked for an explain-back", next.Kind)
	}
	if !next.ExplainBackWaiting || next.PathID != path.ID || next.PathGoal != "Path A" {
		t.Fatalf("waiting = %v on %s; want the waiting explain-back named with its path", next.ExplainBackWaiting, next.PathGoal)
	}

	// The per-path session still asks for it.
	own, err := newReviewService(store).Next(context.Background(), store.user, path.ID)
	if err != nil || own.Kind != NextExplainKind {
		t.Fatalf("per-path Next = %+v, %v; want the explain-back", own, err)
	}
}
