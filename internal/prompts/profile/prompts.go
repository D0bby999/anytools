// Package profileprompts holds the learner profile's prompts as Markdown files
// embedded at build time, for the reasons internal/prompts/quiz gives: a
// prompt change reviewed as prose, and a binary that carries its own prompts.
package profileprompts

import (
	_ "embed"
)

// Consolidate turns one learner's engine aggregates into proposed profile
// operations, each citing the signals it rests on.
//
//go:embed consolidate.md
var Consolidate string

// Use is the note that introduces the profile wherever a feature pulls it
// into a prompt.
//
//go:embed use.md
var Use string
