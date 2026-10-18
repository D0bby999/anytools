// Package researchprompts holds the research pipeline's stage prompts as
// Markdown files embedded at build time (see internal/prompts/quiz for why
// files rather than string constants).
package researchprompts

import (
	_ "embed"
)

// Rephrase turns the learner's request into one self-contained question.
//
//go:embed rephrase.md
var Rephrase string

// Decompose splits it into at most N search-shaped sub-questions.
//
//go:embed decompose.md
var Decompose string

// Synthesize writes the cited report from the gathered sources.
//
//go:embed synthesize.md
var Synthesize string

// Reflect decides whether another search round is worth it (deep mode).
//
//go:embed reflect.md
var Reflect string

// Verify checks each claim of a finished report against its cited sources.
//
//go:embed verify.md
var Verify string

// RelatedQueries turns a knowledge base's summary into three paper-search
// queries (learning depth, phase 6).
//
//go:embed related.md
var RelatedQueries string
