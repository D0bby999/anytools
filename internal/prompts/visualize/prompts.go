// Package visualizeprompts holds the "Draw it" prompts as Markdown files
// embedded at build time (see internal/prompts/quiz for why files rather than
// string constants).
package visualizeprompts

import (
	_ "embed"
)

// Draw asks for one diagram of a piece of content, as JSON.
//
//go:embed draw.md
var Draw string

// Repair gives the model the validation error and asks for a corrected diagram.
//
//go:embed repair.md
var Repair string
