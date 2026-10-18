// Package quizprompts holds the quiz capability's prompts as Markdown files
// embedded at build time.
//
// They are files rather than Go string constants — which is how
// internal/capabilities/chat keeps its one system prompt — for a reason that
// only applies here: there are three of them, they are long, and they are the
// part of this feature most likely to be edited by someone reading the output
// of a bad question rather than reading Go. A `.md` diff in a review shows the
// prompt change as prose; a diff inside a raw string literal shows it as a blob
// with escaped backticks.
//
// The files are embedded, not read from disk, so a deployed binary carries its
// own prompts and cannot be silently repointed at a different set.
package quizprompts

import (
	_ "embed"
)

// Ideate plans the questions: which ideas are worth testing, at what
// difficulty, from which passages.
//
//go:embed ideate.md
var Ideate string

// Generate writes the questions from that plan, with cited explanations.
//
//go:embed generate.md
var Generate string

// Judge marks one free-text answer against the model answer, with a rubric and
// a reason the learner can argue with.
//
//go:embed judge.md
var Judge string

// Rubric marks one written answer criterion by criterion, awarding partial
// points (learning depth, phase 3).
//
//go:embed rubric.md
var Rubric string
