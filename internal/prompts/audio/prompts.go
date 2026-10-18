// Package audioprompts holds the audio overview's prompts as Markdown files
// embedded at build time (see internal/prompts/quiz for why files rather than
// string constants).
package audioprompts

import (
	_ "embed"
)

// Script writes the two-voice script from numbered sources.
//
//go:embed script.md
var Script string

// Repair names the rule a script broke and asks for a corrected one.
//
//go:embed repair.md
var Repair string
