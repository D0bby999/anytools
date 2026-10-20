package quiz

// code.go is the code exercise (plans/261020-1535-beyond-english-learning-
// areas, phase 4; owner decision 4): a Python question answered with code,
// run against its tests in the learner's browser (Pyodide, in a Web Worker),
// never on this server. The browser reports each test's result; Go marks the
// attempt from them. They are the learner's own run, recorded as reported,
// and the learner can override a verdict as on every question.

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/D0bby999/anytools/internal/learning"
)

// TypeCode is a code exercise.
const TypeCode = "code"

// JudgeModeTests marks a judgement made from the tests' results.
const JudgeModeTests = "tests"

// Code exercise limits.
const (
	MaxCodeLen  = 20000
	MaxTestsLen = 40000
	// MaxTestResults bounds what an attempt may report.
	MaxTestResults = 200
)

// CodeExercise is what the browser needs to run a code question, shown before
// the attempt. The learner's code is imported by the tests as Module.
type CodeExercise struct {
	Module  string `json:"module"`
	Starter string `json:"starter"`
	Tests   string `json:"tests"`
	// Credit names where the exercise came from, when it is not the learner's
	// own material (the starter set).
	Credit string `json:"credit,omitempty"`
}

// TestResult is one test as the browser ran it.
type TestResult struct {
	Name    string `json:"name"`
	Passed  bool   `json:"passed"`
	Message string `json:"message,omitempty"`
}

var (
	testFunc   = regexp.MustCompile(`(?m)^\s*def (test_\w+)\s*\(`)
	moduleName = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,63}$`)
)

// TestNames are the tests a file declares: its `def test_…` functions and
// methods, by name.
func TestNames(tests string) []string {
	var out []string
	seen := map[string]bool{}
	for _, m := range testFunc.FindAllStringSubmatch(tests, -1) {
		if !seen[m[1]] {
			seen[m[1]] = true
			out = append(out, m[1])
		}
	}
	return out
}

// CleanCode checks an exercise and its solution as a generator or the
// starter set wrote them.
func CleanCode(c CodeExercise, solution string) (CodeExercise, error) {
	c.Module = strings.TrimSpace(c.Module)
	if c.Module == "" {
		c.Module = "solution"
	}
	c.Starter = strings.TrimRight(c.Starter, " \n") + "\n"
	c.Tests = strings.TrimRight(c.Tests, " \n") + "\n"
	switch {
	case !moduleName.MatchString(c.Module):
		return CodeExercise{}, fmt.Errorf("%w: the module name is not a Python name", ErrBadRequest)
	case strings.TrimSpace(c.Starter) == "", strings.TrimSpace(solution) == "":
		return CodeExercise{}, fmt.Errorf("%w: an exercise needs starting code and a solution", ErrBadRequest)
	case utf8.RuneCountInString(c.Starter) > MaxCodeLen, utf8.RuneCountInString(solution) > MaxCodeLen,
		utf8.RuneCountInString(c.Tests) > MaxTestsLen:
		return CodeExercise{}, fmt.Errorf("%w: the exercise is too long", ErrBadRequest)
	case len(TestNames(c.Tests)) == 0:
		return CodeExercise{}, fmt.Errorf("%w: the tests declare no test_ function", ErrBadRequest)
	}
	return c, nil
}

// testsJudge marks a code attempt: right when every test the exercise
// declares was reported, and passed. A test is matched by its name, the part
// after a class's dot included (LeapTest.test_x is test_x).
func testsJudge(q Question, results []TestResult) (Judgement, error) {
	if q.Code == nil {
		return Judgement{}, fmt.Errorf("%w: this question has no tests", ErrBadRequest)
	}
	if len(results) > MaxTestResults {
		return Judgement{}, fmt.Errorf("%w: too many test results", ErrBadRequest)
	}
	passed := map[string]bool{}
	ran := map[string]bool{}
	for _, r := range results {
		name := r.Name
		if i := strings.LastIndex(name, "."); i >= 0 {
			name = name[i+1:]
		}
		ran[name] = true
		if r.Passed {
			passed[name] = true
		}
	}
	declared := TestNames(q.Code.Tests)
	var missing []string
	ok := 0
	for _, n := range declared {
		switch {
		case passed[n]:
			ok++
		case !ran[n]:
			missing = append(missing, n)
		}
	}
	correct := ok == len(declared)
	j := Judgement{
		Correct: correct, Mode: JudgeModeTests, Tests: results,
		Reason: fmt.Sprintf("%d of %d tests passed.", ok, len(declared)),
	}
	if !correct {
		j.ErrorType = learning.ErrTypeUnknown
		j.Missing = missing
	}
	return j, nil
}
