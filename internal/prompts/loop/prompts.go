// Package loopprompts holds the learning loop's prompts as Markdown files
// embedded at build time, for the reasons internal/prompts/quiz gives: a
// prompt change reviewed as prose, and a binary that carries its own prompts.
package loopprompts

import (
	_ "embed"
)

// Resume is the system message a chat linked to a learning state starts
// from: restate, one exercise, one validated paste-back.
//
//go:embed resume.md
var Resume string
