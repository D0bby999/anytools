// Command gen writes a worksheet kind's outline from up's Markdown
// (the private design notes, phase 0, requirement 18). Each kind's phase
// runs it once for its source and commits the result unedited:
//
//	go run ./internal/learning/worksheet/testdata/gen \
//	    -up ~/.anytools-refs/up -file docs/en/templates/artifact-brief.md \
//	    -sections 1-5 -kind artifact_brief
//
// -sections picks `##` sections by their order in the file, from 1 ("" for
// all; "3", "2-5" or "1,3,4"). -fenced also reads the headings inside code
// blocks as sections (outline.GenerateFenced), for a template that is one
// code block: ai-case-review.md, ai-project-scorecard.md. The up checkout must be at f13ff2d, the
// commit every kind follows; -commit is only for the engine's own fixture.
//
// A kind that gathers cards from several files of one directory names them
// all: -file takes a comma-separated list and -sections one selection per
// file, separated by ";". The outline's source is then the directory, and
// its selection names each file with its sections
// (the private design notes, phase 3):
//
//	go run ./internal/learning/worksheet/testdata/gen -fenced \
//	    -file docs/en/threads/part-6/a.md,docs/en/threads/part-6/b.md \
//	    -sections '5,7;4,7' -kind self_reflection
package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/D0bby999/anytools/internal/learning/worksheet/outline"
)

const upCommit = "f13ff2d"

func main() {
	up := flag.String("up", filepath.Join(os.Getenv("HOME"), ".anytools-refs", "up"), "the up checkout")
	file := flag.String("file", "", "the Markdown file, relative to -up")
	sections := flag.String("sections", "", `the "##" sections to read, by order in the file ("" = all)`)
	kind := flag.String("kind", "", "the kind id; the outline is written to testdata/outlines/<kind>.txt")
	commit := flag.String("commit", "", "record this commit instead of the checkout's (fixtures only)")
	fenced := flag.Bool("fenced", false, "headings inside code blocks start sections too")
	out := flag.String("out", "internal/learning/worksheet/testdata/outlines", "the outlines directory")
	flag.Parse()
	if *file == "" || !regexp.MustCompile(`^[a-z][a-z0-9_]{0,47}$`).MatchString(*kind) {
		fail("usage: gen -file docs/en/templates/x.md -kind kind_id [-sections 1-3] [-up dir]")
	}

	recorded := *commit
	if recorded == "" {
		head, err := exec.Command("git", "-C", *up, "rev-parse", "--short=7", "HEAD").Output()
		if err != nil {
			fail("reading the up checkout's commit: %v", err)
		}
		recorded = strings.TrimSpace(string(head))
		if recorded != upCommit {
			fail("the up checkout is at %s; every kind follows %s", recorded, upCommit)
		}
	}
	generate := outline.Generate
	if *fenced {
		generate = outline.GenerateFenced
	}
	files := strings.Split(*file, ",")
	selections := []string{*sections}
	if len(files) > 1 {
		selections = strings.Split(*sections, ";")
		if len(selections) != len(files) {
			fail("-sections needs one selection per file, separated by \";\": %d files, %d selections", len(files), len(selections))
		}
	}
	source, selection := *file, *sections
	var secs []outline.Section
	var named []string
	for i, f := range files {
		md, err := os.ReadFile(filepath.Join(*up, f))
		if err != nil {
			fail("%v", err)
		}
		got, err := generate(md, selections[i])
		if err != nil {
			fail("%s: %v", f, err)
		}
		if len(files) > 1 {
			dir, base := filepath.Split(f)
			if i > 0 && dir != source {
				fail("the files of one outline must share a directory: %s is not in %s", f, source)
			}
			source = dir
			named = append(named, base+" "+selections[i])
			for j := range got {
				got[j].Title = base + ": " + got[j].Title
			}
		}
		secs = append(secs, got...)
	}
	if len(files) > 1 {
		selection = strings.Join(named, "; ")
	}
	text := outline.Format(outline.Outline{Source: source, Commit: recorded, Selection: selection, Fenced: *fenced, Sections: secs})
	path := filepath.Join(*out, *kind+".txt")
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		fail("%v", err)
	}
	fmt.Println("wrote", path)
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "gen: "+format+"\n", args...)
	os.Exit(1)
}
