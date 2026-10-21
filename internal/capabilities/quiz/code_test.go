package quiz

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz/mathcheck"
	"github.com/D0bby999/anytools/internal/capabilities/quiz/starters"
)

// code_test.go: a code exercise is marked from its tests' results, shows its
// starting code and tests but not its solution before the attempt, and the
// Python starter set is added once (the private design notes, phase 4).

const leapTests = `import unittest

from leap import (
    leap_year,
)


class LeapTest(unittest.TestCase):
    def test_year_not_divisible_by_4(self):
        self.assertIs(leap_year(2015), False)

    def test_year_divisible_by_400(self):
        self.assertIs(leap_year(2000), True)
`

func codeQuestion(user uuid.UUID) Question {
	return Question{
		ID: uuid.New(), UserID: user, Type: TypeCode, Prompt: "## Leap", Answer: "def leap_year(y):\n    return y % 4 == 0\n",
		Code: &CodeExercise{Module: "leap", Starter: "def leap_year(year):\n    pass\n", Tests: leapTests},
	}
}

func TestACodeAttemptIsMarkedFromItsTests(t *testing.T) {
	user := uuid.New()
	cases := []struct {
		name    string
		results []TestResult
		correct bool
	}{
		{"all passed", []TestResult{{Name: "LeapTest.test_year_not_divisible_by_4", Passed: true}, {Name: "LeapTest.test_year_divisible_by_400", Passed: true}}, true},
		{"one failed", []TestResult{{Name: "LeapTest.test_year_not_divisible_by_4", Passed: true}, {Name: "LeapTest.test_year_divisible_by_400", Message: "AssertionError: False is not True"}}, false},
		{"one not reported", []TestResult{{Name: "LeapTest.test_year_not_divisible_by_4", Passed: true}}, false},
		{"nothing ran", nil, false},
		{"a test it does not declare passed", []TestResult{{Name: "test_made_up", Passed: true}}, false},
		// The same declared test failing in another class is not hidden by a pass.
		{"one failed beside its namesake", []TestResult{
			{Name: "LeapTest.test_year_not_divisible_by_4", Passed: true}, {Name: "LeapTest.test_year_divisible_by_400", Passed: true},
			{Name: "OtherTest.test_year_divisible_by_400", Message: "AssertionError"},
		}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := &scripted{}
			st := &recordingStore{q: codeQuestion(user)}
			svc := NewService(Config{Store: st, Providers: resolver{p}, Now: time.Now})
			res, err := svc.Attempt(context.Background(), user, st.q.ID, AttemptRequest{UserAnswer: "def leap_year(y): ...", Tests: c.results})
			if err != nil {
				t.Fatal(err)
			}
			var j Judgement
			_ = json.Unmarshal(st.written[0].Judge, &j)
			if st.written[0].IsCorrect != c.correct || j.Mode != JudgeModeTests || len(p.systems) != 0 || len(j.Tests) != len(c.results) {
				t.Fatalf("correct %v, judge %+v, %d model calls", st.written[0].IsCorrect, j, len(p.systems))
			}
			if res.Answer != st.q.Answer {
				t.Fatalf("the solution is shown after the attempt: %q", res.Answer)
			}
		})
	}
}

func TestACodeQuestionShowsItsTestsButNotItsSolution(t *testing.T) {
	q := codeQuestion(uuid.New())
	v := q.View(false)
	if _, leaked := v["answer"]; leaked {
		t.Fatal("the solution is in an unrevealed view")
	}
	code, ok := v["code"].(*CodeExercise)
	if !ok || code.Module != "leap" || code.Tests != leapTests || code.Starter == "" {
		t.Fatalf("the view's code: %+v", v["code"])
	}
}

func TestCleanCodeAndTestNames(t *testing.T) {
	if got := TestNames(leapTests); len(got) != 2 || got[0] != "test_year_not_divisible_by_4" {
		t.Fatalf("TestNames = %v", got)
	}
	ok := CodeExercise{Starter: "def f():\n    pass", Tests: "from solution import f\n\ndef test_f():\n    assert f() == 1"}
	c, err := CleanCode(ok, "def f():\n    return 1")
	if err != nil || c.Module != "solution" || c.Starter != "def f():\n    pass\n" {
		t.Fatalf("CleanCode: %+v, %v", c, err)
	}
	for name, bad := range map[string]struct {
		c   CodeExercise
		sol string
	}{
		"no tests":       {CodeExercise{Starter: "x = 1", Tests: "assert True"}, "x = 1"},
		"no solution":    {ok, " "},
		"no starter":     {CodeExercise{Tests: ok.Tests}, "x = 1"},
		"a path as name": {CodeExercise{Module: "../os", Starter: "x", Tests: ok.Tests}, "x"},
	} {
		if _, err := CleanCode(bad.c, bad.sol); !errors.Is(err, ErrBadRequest) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

// starterStore records inserted questions and lists them back.
type starterStore struct {
	recordingStore
	rows []Question
}

func (s *starterStore) InsertQuestions(_ context.Context, qs []Question) ([]Question, error) {
	s.rows = append(s.rows, qs...)
	return qs, nil
}

func (s *starterStore) ExistingQuestions(_ context.Context, userID, kbID uuid.UUID, prompts, modules []string) (map[string]bool, error) {
	have := map[string]bool{}
	for _, q := range s.rows {
		if q.UserID != userID || q.KBID != kbID {
			continue
		}
		if slices.Contains(prompts, q.Prompt) {
			have[q.Prompt] = true
		}
		if q.Code != nil && slices.Contains(modules, q.Code.Module) {
			have["module:"+q.Code.Module] = true
		}
	}
	return have, nil
}

type owns struct{ user, kb uuid.UUID }

func (o owns) OwnsKB(_ context.Context, userID, kbID uuid.UUID) error {
	if userID != o.user || kbID != o.kb {
		return ErrNoAccess
	}
	return nil
}

func TestThePythonStarterSetIsAddedOnce(t *testing.T) {
	user, kb := uuid.New(), uuid.New()
	st := &starterStore{}
	svc := NewService(Config{Store: st, Authz: owns{user, kb}})
	res, err := svc.AddStarter(context.Background(), user, kb, StarterPython)
	if err != nil {
		t.Fatal(err)
	}
	want := starters.PythonPart
	if len(starters.Python()) < 100 || res.Added != want || res.Already != 0 {
		t.Fatalf("first add: %+v of %d", res, want)
	}
	q := st.rows[1]
	if q.Type != TypeCode || q.Code == nil || q.Code.Module != "leap" || q.Code.Credit == "" || q.Answer == "" || len(q.Prompt) > 4000 {
		t.Fatalf("leap as a question: %+v", q)
	}
	again, err := svc.AddStarter(context.Background(), user, kb, StarterPython)
	if err != nil || again.Added != 0 || again.Already != want {
		t.Fatalf("second add: %+v, %v", again, err)
	}
	if _, err := svc.AddStarter(context.Background(), uuid.New(), kb, StarterPython); !errors.Is(err, ErrNoAccess) {
		t.Fatalf("another user's knowledge base: %v", err)
	}
	if _, err := svc.AddStarter(context.Background(), user, kb, "cobol"); !errors.Is(err, ErrBadRequest) {
		t.Fatalf("an unknown set: %v", err)
	}
	// The second part adds the next twenty; a part past the end is refused.
	next, err := svc.AddSet(context.Background(), user, kb, StarterPython, "2")
	if err != nil || next.Added != starters.PythonPart || next.Already != 0 {
		t.Fatalf("part 2: %+v, %v", next, err)
	}
	for _, part := range []string{"0", "99", "01", "x"} {
		if _, err := svc.AddSet(context.Background(), user, kb, StarterPython, part); !errors.Is(err, ErrBadRequest) {
			t.Errorf("part %q: %v", part, err)
		}
	}
}

// Every Python exercise is a code question the quiz accepts, within the
// prompt's 4,000 characters.
func TestEveryPythonExerciseFits(t *testing.T) {
	for i, part := range starters.PythonParts() {
		qs, err := setQuestions(uuid.New(), uuid.New(), StarterPython, strconv.Itoa(i+1))
		if err != nil || len(qs) != len(part) {
			t.Fatalf("part %d: %d questions, %v", i+1, len(qs), err)
		}
		for _, q := range qs {
			if utf8.RuneCountInString(q.Prompt) > 4000 || q.Code == nil || q.Answer == "" {
				t.Fatalf("%s: %d characters", q.Code.Module, utf8.RuneCountInString(q.Prompt))
			}
		}
	}
}

func TestEveryQuestionSetPartIsAQuizItCanMark(t *testing.T) {
	for _, set := range []string{starters.SetTrivia, starters.SetARC, starters.SetGSM8K} {
		for n := 1; ; n++ {
			id := map[string]string{starters.SetGSM8K: "p", starters.SetARC: "easy"}[set]
			if id == "" {
				break // trivia's parts are named by category: checked below
			}
			s, p, ok := starters.QuestionPart(set, fmt.Sprintf("%s-%d", id, n))
			if !ok {
				if n == 1 {
					t.Fatalf("%s has no part %s-1", set, id)
				}
				break
			}
			checkPart(t, s, p)
		}
	}
	s, p, ok := starters.QuestionPart(starters.SetTrivia, "general-knowledge-1")
	if !ok {
		t.Fatal("trivia has no general-knowledge-1")
	}
	checkPart(t, s, p)
}

func checkPart(t *testing.T, s *starters.Set, p *starters.Part) {
	t.Helper()
	qs, err := setQuestions(uuid.New(), uuid.New(), s.ID, p.ID)
	if err != nil || len(qs) == 0 || len(qs) > 100 {
		t.Fatalf("%s %s: %d, %v", s.ID, p.ID, len(qs), err)
	}
	for _, q := range qs {
		if !strings.HasSuffix(q.Explanation, s.Credit) || utf8.RuneCountInString(q.Prompt) > 4000 {
			t.Fatalf("%s %s: %+v", s.ID, p.ID, q)
		}
		switch q.Type {
		case TypeMCQ:
			if !matchesLabel(q.Options, q.Answer, q.Answer) {
				t.Fatalf("%s: answer %q is not an option", q.Prompt, q.Answer)
			}
		case TypeTF:
			if q.Answer != "true" && q.Answer != "false" {
				t.Fatalf("%s: answer %q", q.Prompt, q.Answer)
			}
		case TypeShort:
			// A word problem's number is marked by value, without a model.
			if v := mathcheck.Judge(q.Prompt, q.Answer, q.Answer); v != mathcheck.Right {
				t.Fatalf("%s: its own answer %q is %v", q.Prompt, q.Answer, v)
			}
		default:
			t.Fatalf("%s: type %s", q.Prompt, q.Type)
		}
	}
}

func TestAGeneratedCodeQuestionNeedsTestsAndASolution(t *testing.T) {
	chunk := uuid.New()
	known := map[string]Chunk{chunk.String(): {ID: chunk}}
	allowed := map[string]bool{TypeCode: true}
	draft := draftQuestion{
		Prompt: "Write `double(n)`, which returns twice n.", Type: "code",
		Starter: "def double(n):\n    pass", Tests: "from solution import double\n\ndef test_two():\n    assert double(2) == 4",
		Answer: "def double(n):\n    return 2 * n", ChunkIDs: []string{chunk.String()},
	}
	q, _, ok := buildQuestion(draft, allowed, known, nil)
	if !ok || q.Code == nil || q.Code.Module != "solution" || q.Answer == "" {
		t.Fatalf("a good draft: %+v, %v", q, ok)
	}
	draft.Tests = "assert double(2) == 4"
	if _, _, ok := buildQuestion(draft, allowed, known, nil); ok {
		t.Fatal("a draft whose tests declare no test_ function was kept")
	}
}
