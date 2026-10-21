package starters

// sets.go is the Library's question sets (the private design notes, phase 5): ready questions with right answers, each set in parts
// a learner adds to a knowledge base one at a time. scripts/quizsets writes
// sets/<id>.json.gz from pinned sources; the Python set is python.json, in
// parts of PythonPart exercises.

import (
	"bytes"
	"compress/gzip"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"sync"
)

//go:embed sets/*.json.gz
var setFiles embed.FS

// The sets, by id.
const (
	SetPython  = "python"
	SetTrivia  = "trivia"
	SetARC     = "arc"
	SetGSM8K   = "gsm8k"
	PythonPart = 20
)

// Option is one choice of a multiple-choice question.
type Option struct {
	Label string `json:"label"`
	Body  string `json:"body"`
}

// Question is one question of a set as the quiz stores it: Type is "mcq",
// "tf" or "short"; Answer an option's label, "true"/"false", or the text.
type Question struct {
	Type        string   `json:"type"`
	Prompt      string   `json:"prompt"`
	Options     []Option `json:"options,omitempty"`
	Answer      string   `json:"answer"`
	Explanation string   `json:"explanation,omitempty"`
	Difficulty  string   `json:"difficulty"`
}

// Part is the questions added at once.
type Part struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Questions []Question `json:"questions"`
}

// Set is a source's questions, credited.
type Set struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Licence string `json:"licence"`
	Source  string `json:"source"`
	// Credit ends each question's explanation.
	Credit string `json:"credit"`
	Parts  []Part `json:"parts"`
}

var (
	setsOnce sync.Once
	sets     map[string]*Set
	setsErr  error
)

func loadSets() {
	sets = map[string]*Set{}
	for _, id := range []string{SetTrivia, SetARC, SetGSM8K} {
		raw, err := setFiles.ReadFile("sets/" + id + ".json.gz")
		if err != nil {
			setsErr = err
			return
		}
		zr, err := gzip.NewReader(bytes.NewReader(raw))
		if err != nil {
			setsErr = fmt.Errorf("%s: %w", id, err)
			return
		}
		b, err := io.ReadAll(zr)
		if err != nil {
			setsErr = fmt.Errorf("%s: %w", id, err)
			return
		}
		var s Set
		if err := json.Unmarshal(b, &s); err != nil {
			setsErr = fmt.Errorf("%s: %w", id, err)
			return
		}
		sets[id] = &s
	}
}

// QuestionPart is a part of a question set (not the Python set): nil, false
// when the set or the part does not exist.
func QuestionPart(set, part string) (*Set, *Part, bool) {
	setsOnce.Do(loadSets)
	if setsErr != nil {
		panic("starters: " + setsErr.Error())
	}
	s, ok := sets[set]
	if !ok {
		return nil, nil, false
	}
	for i := range s.Parts {
		if s.Parts[i].ID == part {
			return s, &s.Parts[i], true
		}
	}
	return nil, nil, false
}

// PythonParts is the Python set's parts, PythonPart exercises each, easiest
// first: "1", "2", …
func PythonParts() [][]Exercise {
	all := Python()
	var out [][]Exercise
	for i := 0; i < len(all); i += PythonPart {
		out = append(out, all[i:min(i+PythonPart, len(all))])
	}
	return out
}

// PythonPartOf is one part of the Python set by its id ("" is the first).
func PythonPartOf(part string) ([]Exercise, bool) {
	if part == "" {
		part = "1"
	}
	n, err := strconv.Atoi(part)
	parts := PythonParts()
	if err != nil || n < 1 || n > len(parts) || strconv.Itoa(n) != part {
		return nil, false
	}
	return parts[n-1], true
}
