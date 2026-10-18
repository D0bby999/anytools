// Package masteryprompts holds the mastery session's teaching and judging
// prompts as Markdown files embedded at build time (see internal/prompts/quiz
// for why files rather than string constants).
package masteryprompts

import (
	_ "embed"
)

// Learn teaches one knowledge point from the learner's own passages, with
// citations, before the session tests it.
//
//go:embed learn.md
var Learn string

// ExplainBack judges the learner's own explanation of a point (the Feynman
// check) against the passages that cover it, gaps first, verdict last.
//
//go:embed explain_back.md
var ExplainBack string
