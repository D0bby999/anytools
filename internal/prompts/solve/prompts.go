// Package solveprompts holds the solve capability's three stage prompts as
// Markdown files embedded at build time — files for the reason
// internal/prompts/quiz gives: they are long, and a prose diff reviews better
// than a raw string literal.
package solveprompts

import (
	_ "embed"
)

// Plan restates the problem (transcribing a photo), names the topic and the
// approach, and says whether the learner's own material is worth searching.
//
//go:embed plan.md
var Plan string

// Reason works the problem step by step and checks it; for "check my answer"
// it also judges the learner's working.
//
//go:embed reason.md
var Reason string

// Write turns the reasoning into the Markdown + LaTeX write-up the learner
// reads, with citations to the passages it relied on.
//
//go:embed write.md
var Write string
