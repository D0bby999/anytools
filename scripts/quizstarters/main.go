// Command quizstarters writes the Python starter set AnyLearn's quiz offers
// (the private design notes, phase 4) from a checkout
// of Exercism's Python track (MIT): each exercise's instructions, stub, tests
// and example solution, unchanged, into
// internal/capabilities/quiz/starters/python.json.
//
//	go run ./scripts/quizstarters <path to exercism/python> <commit>
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Slugs are the exercises, easiest first.
var Slugs = []string{
	"hello-world", "leap", "reverse-string", "raindrops", "isogram", "pangram", "hamming",
	"rna-transcription", "acronym", "armstrong-numbers", "collatz-conjecture", "difference-of-squares",
	"grains", "darts", "perfect-numbers", "isbn-verifier", "matching-brackets", "bob",
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
	var out []exercise
	for _, slug := range Slugs {
		dir := filepath.Join(root, "exercises", "practice", slug)
		module := strings.ReplaceAll(slug, "-", "_")
		docs := []string{}
		for _, f := range []string{"introduction.md", "instructions.md", "instructions.append.md"} {
			if s := read(filepath.Join(dir, ".docs", f)); s != "" {
				docs = append(docs, s)
			}
		}
		e := exercise{
			Slug: slug, Title: title(slug), Module: module,
			Instructions: strings.Join(docs, "\n\n"),
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
	b, err := json.MarshalIndent(out, "", " ")
	if err != nil {
		panic(err)
	}
	dst := filepath.Join("internal", "capabilities", "quiz", "starters", "python.json")
	if err := os.WriteFile(dst, append(b, '\n'), 0o644); err != nil {
		panic(err)
	}
	fmt.Printf("%s: %d exercises\n", dst, len(out))
}
