// Package bookprompts holds the living book's prompts as Markdown files
// embedded at build time (see internal/prompts/quiz for why files rather than
// string constants).
package bookprompts

import (
	_ "embed"
)

// Propose writes a book's outline from a sample of the knowledge base.
//
//go:embed propose.md
var Propose string

// Plan chooses a chapter's blocks.
//
//go:embed plan.md
var Plan string

// Block is the rules every written block follows; one of the type sections
// below is appended to it.
//
//go:embed block.md
var Block string

// Text is a block of explanation.
//
//go:embed text.md
var Text string

// Callout is a definition, a warning or a tip.
//
//go:embed callout.md
var Callout string

// WorkedExample is a problem solved step by step.
//
//go:embed worked_example.md
var WorkedExample string

// FlashCards are front/back pairs for spaced review.
//
//go:embed flash_cards.md
var FlashCards string

// Summary closes a chapter.
//
//go:embed summary.md
var Summary string

// Repair names the rule an answer broke and asks for a corrected one.
//
//go:embed repair.md
var Repair string
