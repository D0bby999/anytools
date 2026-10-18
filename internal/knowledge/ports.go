// Package knowledge is the Knowledge Center: knowledge bases, uploaded
// documents, and the parse → chunk → embed → index pipeline behind them.
//
// This file is the MERGE CONTRACT. Phase 4 builds the provider clients in
// `internal/rag/parse` and `internal/rag/embed`; phase 5 was built against the
// two interfaces below and fakes of them. The wiring commit's whole job is to
// supply real implementations. Nothing else in this package knows a provider
// exists.
package knowledge

import (
	"context"

	"github.com/D0bby999/anytools/internal/rag/parse"
)

// Parser converts one PAGE RANGE of a document into Markdown.
//
// Merge target: `byok.ParserFor(ctx, user)` must return an ordered chain of
// values satisfying this. The declaration lives in internal/rag/parse (as
// parse.PageParser) so that the batching, truncation and short-parse wrapper
// can be written in the package that owns those rules without importing this
// one; the aliases here are the names the wiring uses.
//
// The exact signature an implementation must satisfy:
//
//	ParsePages(ctx context.Context, req parse.PageRequest) (parse.PageResult, error)
//	ProviderName() string
//
//	type PageRequest struct {
//	    Data       []byte // a standalone document containing exactly pages Start..End
//	    MIME       string // "application/pdf"
//	    Start, End int    // ABSOLUTE page numbers in the source document
//	}
//
//	type PageResult struct {
//	    Markdown     string
//	    Finish       PageFinish // "stop" | "truncated" | "other", from the provider's own stop field
//	    Model        string     // the model id, recorded in documents.processed_by
//	    InputTokens  int
//	    OutputTokens int
//	}
//
// Two obligations on any implementation, both paid for by Spike B:
//
//  1. Retry 429 and 5xx with backoff INTERNALLY. A single transient `503 high
//     demand` silently dropped ten pages of a 29-page document and the run
//     reported success.
//  2. Report Finish from the provider's own field — Gemini finishReason,
//     OpenAI status/incomplete_details, Anthropic stop_reason — and never from
//     inspecting the text. "The output looks short" is a separate signal this
//     package already computes, and conflating them hides the case where a
//     model stops cleanly on a page it could not read.
type Parser = parse.PageParser

// ParseRequest is one page window handed to a Parser.
type ParseRequest = parse.PageRequest

// ParseResult is one window's output.
type ParseResult = parse.PageResult

// ParseFinish is why a provider stopped.
type ParseFinish = parse.PageFinish

// EmbedTask says what the text being embedded will be used FOR.
//
// This is not cosmetic and it is not optional. A task-aware model (Gemini's
// embedContent takes it as `task_type`) is trained to place a QUESTION near the
// answers that should be retrieved for it, rather than near other questions.
// Embedding the corpus and the query with the same task measurably degrades
// retrieval — and degrades it silently, since every call still succeeds and
// every result still looks plausible.
//
// It is on this interface rather than left to the implementation because the
// caller is the only one who knows which it is: this package embeds documents,
// and internal/api/kbapi embeds the question. A provider with no equivalent
// parameter (OpenAI) ignores the value.
type EmbedTask string

const (
	// EmbedDocument is text being indexed.
	EmbedDocument EmbedTask = "document"
	// EmbedQuery is text being searched with.
	EmbedQuery EmbedTask = "query"
)

// Embedder turns text into vectors through the user's own embed route.
//
// Merge target: `byok.EmbedderFor(ctx, user)`. Declared here rather than in
// internal/rag/embed because phase 4 owns embed/embedder.go and would collide.
//
// The contract:
//
//   - Embed returns one vector per input, in the SAME ORDER, and `dims` is the
//     width every one of them has. A provider that returns them out of order
//     or ragged silently mis-attributes every chunk in the batch, and nothing
//     downstream can detect it — so an implementation that cannot guarantee
//     order must return an error instead.
//   - `dims` must be one of embed.SupportedDims. Padding to the stored width
//     happens in this package; an implementation must not pre-pad, because the
//     native width is what the KB pins and what a query filters on.
//   - Model() is the id pinned on the knowledge base. Changing it sets
//     needs_reembed and blocks queries until a reindex, so it must be stable
//     for a given route and must not include a version that rotates on its own.
//   - The SAME Embedder must be used for a knowledge base's documents and for
//     questions asked of it, differing only in the task.
type Embedder interface {
	Embed(ctx context.Context, texts []string, task EmbedTask) (vectors [][]float32, dims int, err error)
	Model() string
	// ProviderName is the lane id, e.g. "openai", shown next to the model.
	ProviderName() string
}

// Providers resolves a user's configured lanes at the moment a job runs.
//
// Resolved per job, not held on the service, because BYOK credentials are
// per-user and can be revoked between the upload and the parse. A service
// holding one Embedder would be holding one user's credentials.
//
// ParserChain may return an empty chain: a user with no keys can still upload
// .docx, .pptx, .epub, .md, .txt and any PDF with a text layer, and gets an
// actionable failure only for a scanned PDF.
type Providers interface {
	ParserChain(ctx context.Context, userID UserID) ([]Parser, error)
	EmbedderFor(ctx context.Context, userID UserID) (Embedder, error)
}
