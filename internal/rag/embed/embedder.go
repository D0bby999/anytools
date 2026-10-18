// Package embed is AnyTools' embedding seam: the user's own account turns text
// into vectors.
//
// NEW code, not a port. postclaw's internal/memory carries a single hardcoded
// OpenAI embedder at a fixed 768 dimensions (scout §7); AnyTools' width is
// whatever the user's chosen model returns, which is why Dims is a value read
// back from a live call rather than a constant.
//
// What lives here: the interface, the two clients and their verify pings. What
// does NOT live here: chunking, batching and the retry budget around a large
// document. Those are phase 5's — they belong with the ingest job that knows how
// many chunks are in flight, not with the client that sends one request.
package embed

import (
	"context"
	"errors"
)

// Task tells a task-aware model what the text will be used FOR.
//
// Gemini's embedContent takes this as `task_type`, and it is not cosmetic:
// embedding a query with RETRIEVAL_DOCUMENT and the corpus with the same value
// measurably degrades retrieval, because the model is trained to place a
// question near the answers it should retrieve rather than near other
// questions. OpenAI has no equivalent parameter and ignores it.
type Task string

const (
	// TaskDocument is for text being indexed.
	TaskDocument Task = "document"
	// TaskQuery is for text being searched with.
	TaskQuery Task = "query"
)

// ErrDimensionMismatch reports that a provider returned vectors of a width other
// than the one this embedder was pinned to. Phase 5 pins a knowledge base to a
// width; silently storing a different one produces a table where distance
// comparisons are meaningless.
var ErrDimensionMismatch = errors.New("embed: provider returned an unexpected vector width")

// Embedder turns text into vectors.
type Embedder interface {
	// Name is the provider identifier ("openai", "gemini").
	Name() string
	// Model is the model id this instance will call.
	Model() string
	// Dims is the vector width, once known — from the route entry, or from the
	// last verify ping. Zero means "not yet established", which is a valid state
	// for a connection nobody has verified.
	Dims() int
	// Embed returns one vector per input, in input order.
	Embed(ctx context.Context, texts []string, task Task) ([][]float32, error)
	// Ping is the verify probe: embed one short string and report the width it
	// came back at.
	Ping(ctx context.Context) (dims int, err error)
}

// probeText is what a verify ping embeds. Short, so it costs nothing, and
// deterministic, so two pings of the same model must agree on the width.
const probeText = "AnyTools embedding verify."
