// Command quizstarters writes the Python starter set AnyLearn's quiz offers
// (the private design notes, phase 4) from a checkout
// of Exercism's Python track (MIT): each exercise's instructions, stub, tests
// and example solution, unchanged, into
// internal/capabilities/quiz/starters/python.json.
//
// Since the Library (the private design notes, phase 5) the
// whole practice track goes in: Slugs first, as before, then every other
// exercise that is not deprecated, by difficulty, but Skip's, whose example
// solution does not pass its tests in Pyodide (checked by running each).
//
//	go run ./scripts/quizstarters <path to exercism/python> <commit>
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"
)

// Slugs are the exercises, easiest first.
var Slugs = []string{
	"hello-world", "leap", "reverse-string", "raindrops", "isogram", "pangram", "hamming",
	"rna-transcription", "acronym", "armstrong-numbers", "collatz-conjecture", "difference-of-squares",
	"grains", "darts", "perfect-numbers", "isbn-verifier", "matching-brackets", "bob",
}

// Skip: exercises whose example solution fails its own tests in Pyodide,
// with why.
var Skip = map[string]string{
	"alphametics": "one test is marked skip (too slow), so the set could never be passed",
	"paasio":      "its tests import test_utils, a file beside them",
}

// maxPrompt is questions.prompt's CHECK, in characters.
const maxPrompt = 4000

// promptOf is the question's prompt as AddSet writes it.
func promptOf(slug, instructions string) string {
	return "## " + title(slug) + "\n\n" + instructions
}

type exercise struct {
	Slug         string `json:"slug"`
	Title        string `json:"title"`
	Module       string `json:"module"`
	Instructions string `json:"instructions"`
	Starter      string `json:"starter"`
	Tests        string `json:"tests"`
	Solution     string `json:"solution"`
	Credit       string `json:"credit"`
	// Difficulty is Exercism's, 1 to 10.
	Difficulty int `json:"difficulty"`
}

func read(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func title(slug string) string {
	words := strings.Split(slug, "-")
	for i, w := range words {
		words[i] = strings.ToUpper(w[:1]) + w[1:]
	}
	return strings.Join(words, " ")
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: quizstarters <exercism/python checkout> <commit>")
		os.Exit(2)
	}
	root, commit := os.Args[1], os.Args[2]
	var config struct {
		Exercises struct {
			Practice []struct {
				Slug       string `json:"slug"`
				Status     string `json:"status"`
				Difficulty int    `json:"difficulty"`
			} `json:"practice"`
		} `json:"exercises"`
	}
	b, err := os.ReadFile(filepath.Join(root, "config.json"))
	if err == nil {
		err = json.Unmarshal(b, &config)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "config.json:", err)
		os.Exit(1)
	}
	practice := config.Exercises.Practice
	sort.SliceStable(practice, func(i, j int) bool { return practice[i].Difficulty < practice[j].Difficulty })
	slugs := append([]string{}, Slugs...)
	difficulty := map[string]int{}
	for _, p := range practice {
		difficulty[p.Slug] = p.Difficulty
	}
	for _, p := range practice {
		if p.Status == "deprecated" || slices.Contains(Slugs, p.Slug) || Skip[p.Slug] != "" {
			continue
		}
		slugs = append(slugs, p.Slug)
	}
	var out []exercise
	var shortened, tooLong []string
	for _, slug := range slugs {
		dir := filepath.Join(root, "exercises", "practice", slug)
		module := strings.ReplaceAll(slug, "-", "_")
		docs := []string{}
		for _, f := range []string{"introduction.md", "instructions.md", "instructions.append.md"} {
			if s := read(filepath.Join(dir, ".docs", f)); s != "" {
				docs = append(docs, s)
			}
		}
		instructions := strings.Join(docs, "\n\n")
		// A question's prompt is at most 4,000 characters (questions.prompt's
		// CHECK): a long story goes, the instructions stay; still too long, the
		// exercise is left out.
		if utf8.RuneCountInString(promptOf(slug, instructions)) > maxPrompt && len(docs) > 1 && strings.HasPrefix(instructions, read(filepath.Join(dir, ".docs", "introduction.md"))) {
			instructions = strings.Join(docs[1:], "\n\n")
			shortened = append(shortened, slug)
		}
		if utf8.RuneCountInString(promptOf(slug, instructions)) > maxPrompt {
			tooLong = append(tooLong, slug)
			continue
		}
		e := exercise{
			Slug: slug, Title: title(slug), Module: module, Difficulty: difficulty[slug],
			Instructions: instructions,
			Starter:      read(filepath.Join(dir, module+".py")) + "\n",
			Tests:        read(filepath.Join(dir, module+"_test.py")) + "\n",
			Solution:     read(filepath.Join(dir, ".meta", "example.py")) + "\n",
			Credit: fmt.Sprintf("Exercise from Exercism's Python track (MIT licence), commit %s: https://exercism.org/tracks/python/exercises/%s",
				commit[:7], slug),
		}
		if e.Instructions == "" || len(e.Starter) < 2 || len(e.Tests) < 2 || len(e.Solution) < 2 {
			fmt.Fprintf(os.Stderr, "%s: missing a file\n", slug)
			os.Exit(1)
		}
		out = append(out, e)
	}
	b, err = json.MarshalIndent(out, "", " ")
	if err != nil {
		panic(err)
	}
	dst := filepath.Join("internal", "capabilities", "quiz", "starters", "python.json")
	if err := os.WriteFile(dst, append(b, '\n'), 0o644); err != nil {
		panic(err)
	}
	fmt.Printf("%s: %d exercises; introduction left out (too long): %v; left out, too long: %v\n", dst, len(out), shortened, tooLong)
}
