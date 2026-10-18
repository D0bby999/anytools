// Package videonotesprompts holds the video study-notes prompt as a Markdown
// file embedded at build time (see internal/prompts/quiz for why files rather
// than string constants).
package videonotesprompts

import (
	_ "embed"
)

// Notes asks for a video's study notes, section by section, as JSON.
//
//go:embed notes.md
var Notes string
