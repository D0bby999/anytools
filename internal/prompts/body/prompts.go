// Package bodyprompts holds the training coach's prompts as Markdown files
// embedded at build time (see internal/prompts/quiz for why files rather than
// string constants).
package bodyprompts

import (
	_ "embed"
)

// Common is the coach's standing rules, sent with every task.
//
//go:embed common.md
var Common string

// Plan asks for a complete weekly plan from an intake.
//
//go:embed plan.md
var Plan string

// Refine asks for the plan just proposed, revised in the learner's words.
//
//go:embed refine.md
var Refine string

// Review asks whether the plan should change, given the log.
//
//go:embed review.md
var Review string

// Repair hands back the validator's problems for the one retry.
//
//go:embed repair.md
var Repair string
