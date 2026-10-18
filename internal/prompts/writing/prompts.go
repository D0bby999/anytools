// Package writingprompts holds the writing diagnosis prompt as a Markdown
// file embedded at build time (see internal/prompts/quiz for why files rather
// than string constants), and the five passes it names.
//
// The passes follow up's writing chapter, docs/en/threads/part-1/6-writing.md
// §6 ("Five Revision Passes, One Question Each"); the questions are written
// fresh.
package writingprompts

import (
	_ "embed"
	"strconv"
	"strings"
)

//go:embed diagnose.md
var diagnose string

// Pass is one revision pass: its name and the one question it asks.
type Pass struct {
	Name     string
	Question string
}

// Passes are up's five passes, in up's risk order. Pass n is Passes[n-1].
var Passes = [5]Pass{
	{"Task and fact", "Does the text do the task it was written for, and can every number, date, name, quotation and source in it be checked? Is a condition the reader needs for their decision missing?"},
	{"Structure and evidence", "Does each paragraph have one job? Does the evidence actually support the claim, and does the example carry the conclusion? Does the limit come before the reader has to decide?"},
	{"Sentence and meaning", "Is it clear who does what, when, under which condition? Are negation, reference and the degree of certainty unambiguous?"},
	{"Register and voice", "Does the tone fit the relationship? Is each problem an error, an ambiguity, a register choice or only a matter of taste? Does politeness hide the request, or does formality make sentences longer than they need to be?"},
	{"Delivery and boundary", "Are the title, subject, format, links, citations and attachments right? Is anything private, copyrighted or unpermitted included? Are the owner, the deadline and the way back clear, so the reader can carry on without the author?"},
}

// Diagnose is the system prompt for pass n (1–5). It panics on another n:
// the caller has already refused it.
func Diagnose(n int) string {
	p := Passes[n-1]
	return strings.NewReplacer(
		"{{PASS_NUMBER}}", strconv.Itoa(n),
		"{{PASS_NAME}}", p.Name,
		"{{PASS_QUESTION}}", p.Question,
	).Replace(diagnose)
}
