// Command quizsets writes the Library's question sets (the private design notes, phase 5) into internal/capabilities/quiz/starters/
// sets/<id>.json.gz, and their index, with the Python set's parts, into
// ui/web/app/data/library/question-sets.json.
//
//	go run ./scripts/quizsets <opentdb.json> <arc.json> <gsm8k train.jsonl> <gsm8k test.jsonl>
//
// Sources, each credited at the end of every question's explanation:
//
//   - Open Trivia DB's verified questions (CC BY-SA 4.0), read through its API
//     with a session token (url3986 encoding), by category, in parts of 100;
//     a multiple-choice question's options in an order fixed by its text.
//   - AI2's ARC, Easy and Challenge (CC BY-SA 4.0), from the Hugging Face
//     dataset allenai/ai2_arc at the revision the file names, in parts of 100.
//   - OpenAI's GSM8K (MIT), at commit 3101c7d, in parts of 100: the answer is
//     the number after "####", the explanation the steps without their
//     <<calculator>> notes.
//
// Hendrycks's MATH is not here: its problems are from AMC and AIME papers,
// whose copyright the repository's MIT licence does not cover.
package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// The shapes of internal/capabilities/quiz/starters/sets.go, which embeds
// what this writes (so it cannot be imported before the files exist).
const (
	setTrivia  = "trivia"
	setARC     = "arc"
	setGSM8K   = "gsm8k"
	setPython  = "python"
	pythonPart = 20
	pythonFile = "internal/capabilities/quiz/starters/python.json"
)

type option struct {
	Label string `json:"label"`
	Body  string `json:"body"`
}

type question struct {
	Type        string   `json:"type"`
	Prompt      string   `json:"prompt"`
	Options     []option `json:"options,omitempty"`
	Answer      string   `json:"answer"`
	Explanation string   `json:"explanation,omitempty"`
	Difficulty  string   `json:"difficulty"`
}

type part struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Questions []question `json:"questions"`
}

type set struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Licence string `json:"licence"`
	Source  string `json:"source"`
	Credit  string `json:"credit"`
	Parts   []part `json:"parts"`
}

const (
	outDir   = "internal/capabilities/quiz/starters/sets"
	outIndex = "ui/web/app/data/library/question-sets.json"
	partSize = 100
	// maxPrompt is questions.prompt's CHECK, in characters.
	maxPrompt = 4000
)

var labels = []string{"A", "B", "C", "D", "E", "F"}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "quizsets:", err)
	os.Exit(1)
}

func readJSON(path string, v any) {
	b, err := os.ReadFile(path)
	if err == nil {
		err = json.Unmarshal(b, v)
	}
	if err != nil {
		fail(fmt.Errorf("%s: %w", path, err))
	}
}

func unesc(s string) string {
	out, err := url.PathUnescape(s)
	if err != nil {
		fail(fmt.Errorf("decode %q: %w", s, err))
	}
	return strings.TrimSpace(out)
}

// shuffled is the options in an order fixed by the question's text, so a
// rebuild gives the same order and the right answer is not always first.
func shuffled(prompt string, opts []string) []string {
	out := append([]string{}, opts...)
	h := fnv.New64a()
	h.Write([]byte(prompt))
	seed := h.Sum64()
	for i := len(out) - 1; i > 0; i-- {
		seed = seed*6364136223846793005 + 1442695040888963407
		j := int(seed>>33) % (i + 1)
		out[i], out[j] = out[j], out[i]
	}
	return out
}

func mcq(prompt string, opts []string, right string, difficulty string) (question, bool) {
	if len(opts) < 2 || len(opts) > len(labels) || utf8.RuneCountInString(prompt) > maxPrompt {
		return question{}, false
	}
	q := question{Type: "mcq", Prompt: prompt, Difficulty: difficulty}
	seen := map[string]bool{}
	for i, o := range opts {
		if o == "" || seen[o] {
			return question{}, false
		}
		seen[o] = true
		q.Options = append(q.Options, option{Label: labels[i], Body: o})
		if o == right {
			q.Answer = labels[i]
		}
	}
	return q, q.Answer != ""
}

func slug(s string) string {
	s = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(strings.ToLower(s), "-")
	return strings.Trim(s, "-")
}

// parts cuts questions into parts of partSize named "<name> <n>", or just
// "<name>" when there is one.
func parts(idPrefix, name string, qs []question) []part {
	var out []part
	for i := 0; i < len(qs); i += partSize {
		n := len(out) + 1
		out = append(out, part{ID: fmt.Sprintf("%s-%d", idPrefix, n), Name: fmt.Sprintf("%s %d", name, n), Questions: qs[i:min(i+partSize, len(qs))]})
	}
	if len(out) == 1 {
		out[0].Name = name
	}
	return out
}

func trivia(path string) set {
	var raw struct {
		Read       string `json:"read"`
		Categories []struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		} `json:"categories"`
		Results []struct {
			Type       string   `json:"type"`
			Difficulty string   `json:"difficulty"`
			Category   string   `json:"category"`
			Question   string   `json:"question"`
			Correct    string   `json:"correct_answer"`
			Incorrect  []string `json:"incorrect_answers"`
			CategoryID int      `json:"category_id"`
		} `json:"results"`
	}
	readJSON(path, &raw)
	byCat := map[int][]question{}
	seen := map[string]bool{}
	skipped := 0
	for _, r := range raw.Results {
		prompt := unesc(r.Question)
		if prompt == "" || seen[prompt] {
			skipped++
			continue
		}
		seen[prompt] = true
		right := unesc(r.Correct)
		switch r.Type {
		case "boolean":
			ans := strings.ToLower(right)
			if ans != "true" && ans != "false" {
				skipped++
				continue
			}
			byCat[r.CategoryID] = append(byCat[r.CategoryID], question{Type: "tf", Prompt: prompt, Answer: ans, Difficulty: r.Difficulty})
		case "multiple":
			opts := []string{right}
			for _, w := range r.Incorrect {
				opts = append(opts, unesc(w))
			}
			q, ok := mcq(prompt, shuffled(prompt, opts), right, r.Difficulty)
			if !ok {
				skipped++
				continue
			}
			byCat[r.CategoryID] = append(byCat[r.CategoryID], q)
		default:
			skipped++
		}
	}
	s := set{
		ID: setTrivia, Name: "Open Trivia DB", Licence: "cc-by-sa", Source: "https://opentdb.com",
		Credit: "Question from Open Trivia DB (opentdb.com), CC BY-SA 4.0.",
	}
	for _, c := range raw.Categories {
		qs := byCat[c.ID]
		if len(qs) == 0 {
			continue
		}
		// Easiest first, then by text, so a rebuild keeps each part's questions.
		rank := map[string]int{"easy": 0, "medium": 1, "hard": 2}
		sort.SliceStable(qs, func(i, j int) bool {
			if rank[qs[i].Difficulty] != rank[qs[j].Difficulty] {
				return rank[qs[i].Difficulty] < rank[qs[j].Difficulty]
			}
			return qs[i].Prompt < qs[j].Prompt
		})
		s.Parts = append(s.Parts, parts(slug(c.Name), c.Name, qs)...)
	}
	kept := 0
	for _, qs := range byCat {
		kept += len(qs)
	}
	fmt.Printf("trivia (read %s): %d questions, %d left out\n", raw.Read, kept, skipped)
	return s
}

func arc(path string) set {
	var raw struct {
		Revision string `json:"revision"`
		Rows     map[string][]struct {
			ID       string `json:"id"`
			Question string `json:"question"`
			Choices  struct {
				Text  []string `json:"text"`
				Label []string `json:"label"`
			} `json:"choices"`
			AnswerKey string `json:"answerKey"`
		} `json:"rows"`
	}
	readJSON(path, &raw)
	s := set{
		ID: setARC, Name: "ARC (AI2 Reasoning Challenge)", Licence: "cc-by-sa", Source: "https://allenai.org/data/arc",
		Credit: "Question from the AI2 Reasoning Challenge (ARC), Allen Institute for AI, CC BY-SA 4.0.",
	}
	// One prompt once in the whole set: a knowledge base skips a question it
	// has by its prompt, so a Challenge question worded as an Easy one would
	// never be added.
	seen := map[string]bool{}
	for _, level := range []struct{ cfg, id, name, difficulty string }{
		{"ARC-Easy", "easy", "Easy", "easy"}, {"ARC-Challenge", "challenge", "Challenge", "hard"},
	} {
		var qs []question
		for _, r := range raw.Rows[level.cfg] {
			prompt := strings.TrimSpace(r.Question)
			if seen[prompt] {
				continue
			}
			right := ""
			for i, l := range r.Choices.Label {
				if l == r.AnswerKey && i < len(r.Choices.Text) {
					right = strings.TrimSpace(r.Choices.Text[i])
				}
			}
			var opts []string
			for _, t := range r.Choices.Text {
				opts = append(opts, strings.TrimSpace(t))
			}
			q, ok := mcq(prompt, opts, right, level.difficulty)
			if !ok {
				continue
			}
			seen[prompt] = true
			qs = append(qs, q)
		}
		s.Parts = append(s.Parts, parts(level.id, level.name, qs)...)
		fmt.Printf("arc %s (revision %s): %d questions of %d\n", level.name, raw.Revision[:7], len(qs), len(raw.Rows[level.cfg]))
	}
	return s
}

var (
	calcNote = regexp.MustCompile(`<<[^>]*>>`)
	number   = regexp.MustCompile(`^-?[0-9][0-9,]*(\.[0-9]+)?$`)
)

func gsm8k(paths ...string) set {
	var qs []question
	seen := map[string]bool{}
	for _, path := range paths {
		b, err := os.ReadFile(path)
		if err != nil {
			fail(err)
		}
		for _, line := range bytes.Split(b, []byte("\n")) {
			if len(bytes.TrimSpace(line)) == 0 {
				continue
			}
			var r struct{ Question, Answer string }
			if err := json.Unmarshal(line, &r); err != nil {
				fail(fmt.Errorf("%s: %w", path, err))
			}
			steps, final, ok := strings.Cut(r.Answer, "####")
			final = strings.ReplaceAll(strings.TrimSpace(final), ",", "")
			prompt := strings.TrimSpace(r.Question)
			if !ok || !number.MatchString(final) || seen[prompt] || utf8.RuneCountInString(prompt) > maxPrompt {
				continue
			}
			seen[prompt] = true
			qs = append(qs, question{
				Type: "short", Prompt: prompt, Answer: final, Difficulty: "medium",
				Explanation: strings.TrimSpace(calcNote.ReplaceAllString(steps, "")),
			})
		}
	}
	fmt.Printf("gsm8k: %d questions\n", len(qs))
	return set{
		ID: setGSM8K, Name: "GSM8K: maths word problems", Licence: "mit", Source: "https://github.com/openai/grade-school-math",
		Credit: "Problem from GSM8K (OpenAI, grade-school-math), MIT licence.",
		Parts:  parts("p", "Problems", qs),
	}
}

func write(s set) {
	b, err := json.Marshal(s)
	if err != nil {
		fail(err)
	}
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	zw.Write(b)
	zw.Close()
	if err := os.WriteFile(outDir+"/"+s.ID+".json.gz", buf.Bytes(), 0o644); err != nil {
		fail(err)
	}
}

// indexPart and indexSet are the web's view: no questions.
type indexPart struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type indexSet struct {
	ID      string      `json:"id"`
	Name    string      `json:"name"`
	Licence string      `json:"licence"`
	Source  string      `json:"source"`
	Credit  string      `json:"credit"`
	Parts   []indexPart `json:"parts"`
}

func main() {
	if len(os.Args) != 5 {
		fail(fmt.Errorf("usage: go run ./scripts/quizsets <opentdb.json> <arc.json> <gsm8k train.jsonl> <gsm8k test.jsonl>"))
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		fail(err)
	}
	var index []indexSet
	for _, s := range []set{trivia(os.Args[1]), arc(os.Args[2]), gsm8k(os.Args[4], os.Args[3])} {
		write(s)
		is := indexSet{ID: s.ID, Name: s.Name, Licence: s.Licence, Source: s.Source, Credit: s.Credit}
		for _, p := range s.Parts {
			is.Parts = append(is.Parts, indexPart{ID: p.ID, Name: p.Name, Count: len(p.Questions)})
		}
		index = append(index, is)
	}
	py := indexSet{
		ID: setPython, Name: "Exercism: Python", Licence: "mit", Source: "https://exercism.org/tracks/python",
		Credit: "Exercises from Exercism's Python track, MIT licence.",
	}
	var exercises []json.RawMessage
	readJSON(pythonFile, &exercises)
	for i := 0; i < len(exercises); i += pythonPart {
		n := min(pythonPart, len(exercises)-i)
		py.Parts = append(py.Parts, indexPart{ID: strconv.Itoa(i/pythonPart + 1), Name: fmt.Sprintf("%d–%d", i+1, i+n), Count: n})
	}
	index = append(index, py)
	b, err := json.MarshalIndent(index, "", " ")
	if err != nil {
		fail(err)
	}
	if err := os.WriteFile(outIndex, append(b, '\n'), 0o644); err != nil {
		fail(err)
	}
	fmt.Println("wrote", outDir, "and", outIndex)
}
