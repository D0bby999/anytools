package quiz

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"testing"
)

// The question type lists live in three places: AllTypes, the last
// questions_type_check in the migrations, and the web's QuestionType union
// with its QUESTION_TYPES list. A type added to one and not the others is a
// question the database refuses, or one the browser cannot render.
func TestQuestionTypesAgreeInGoSQLAndTheWeb(t *testing.T) {
	want := slices.Clone(AllTypes())
	sort.Strings(want)

	files, err := filepath.Glob("../../../migrations/*.up.sql")
	if err != nil || len(files) == 0 {
		t.Fatalf("no migrations found: %v", err)
	}
	sort.Strings(files)
	check := regexp.MustCompile(`(?s)questions_type_check\s+CHECK \(type IN \(([^)]*)\)\)`)
	inline := regexp.MustCompile(`type\s+text NOT NULL CHECK \(type IN \(('mcq'[^)]*)\)\)`)
	var sqlList string
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, re := range []*regexp.Regexp{inline, check} {
			for _, m := range re.FindAllStringSubmatch(string(raw), -1) {
				sqlList = m[1]
			}
		}
	}
	if got := quoted(sqlList, `'`); !slices.Equal(got, want) {
		t.Errorf("migrations say %v, AllTypes says %v", got, want)
	}

	raw, err := os.ReadFile("../../../ui/web/app/lib/study-types.ts")
	if err != nil {
		t.Fatal(err)
	}
	union := regexp.MustCompile(`export type QuestionType = ([^;]*);`).FindStringSubmatch(string(raw))
	list := regexp.MustCompile(`export const QUESTION_TYPES: readonly QuestionType\[\] = \[([^\]]*)\]`).FindStringSubmatch(string(raw))
	if union == nil || list == nil {
		t.Fatal("study-types.ts no longer declares QuestionType and QUESTION_TYPES")
	}
	if got := quoted(union[1], `"`); !slices.Equal(got, want) {
		t.Errorf("QuestionType is %v, AllTypes %v", got, want)
	}
	if got := quoted(list[1], `"`); !slices.Equal(got, want) {
		t.Errorf("QUESTION_TYPES is %v, AllTypes %v", got, want)
	}
}

func quoted(s, q string) []string {
	var out []string
	for _, part := range strings.Split(s, q) {
		if p := strings.TrimSpace(part); p != "" && p != "," && p != "|" {
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out
}
