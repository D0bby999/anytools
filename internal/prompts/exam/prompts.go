// Package examprompts holds the exam mimic's prompts as Markdown files
// embedded at build time (see internal/prompts/quiz for why files rather than
// string constants).
package examprompts

import (
	_ "embed"
)

// Extract lists the questions printed on a batch of an exam paper's pages.
//
//go:embed extract.md
var Extract string

// Generate writes one new question shaped like a template item, from the
// learner's own passages.
//
//go:embed generate.md
var Generate string

// Repair names the rules a generated question broke and asks for a
// corrected one.
//
//go:embed repair.md
var Repair string
