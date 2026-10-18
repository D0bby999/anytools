// Package embed turns text into vectors through the user's own embed route
// and prepares them for storage.
//
// This file owns the padding rule. Phase 4 owns the provider clients.
package embed

import (
	"errors"
	"fmt"

	"github.com/pgvector/pgvector-go"
)

// StorageDims is the single width of the `chunks.embedding` column.
//
// One column, not one per model, because a KB may be re-embedded onto a
// different route and a schema change is not an acceptable cost of changing a
// dropdown. 3072 is the largest width any BYOK route in scope emits
// (text-embedding-3-large, gemini-embedding-001).
const StorageDims = 3072

// SupportedDims are the native widths a route may return.
//
// An allowlist rather than "anything <= 3072": a route that suddenly returns
// 1537 dimensions has changed under us, and quietly padding that to 3072 would
// index vectors from a different space alongside the old ones, which produces
// confident nonsense rather than an error.
var SupportedDims = []int{256, 384, 512, 768, 1024, 1536, 3072}

// ErrUnsupportedDims is returned for a width not in SupportedDims.
var ErrUnsupportedDims = errors.New("embed: unsupported embedding width")

// ErrDimsMismatch is returned when a vector's length is not the width its
// route claims.
var ErrDimsMismatch = errors.New("embed: vector width does not match the route")

// Pad widens a vector to StorageDims with zeros.
//
// Measured, not reasoned: Spike D compared a padded halfvec(3072) against a
// native halfvec(1536) twin over 50 000 rows. The top-40 ordering was identical
// in 40 of 40 positions and the maximum absolute cosine delta was exactly 0.
// Appending zeros adds nothing to either dot product or either magnitude, so
// cosine similarity is unchanged; the only cost is storage, 6152 bytes per row
// against 3080.
//
// This is what makes `halfvec(3072)` a safe single column. Without it the
// column rejects an OpenAI vector outright:
// "expected 3072 dimensions, not 1536".
func Pad(vec []float32) ([]float32, error) {
	if err := ValidateDims(len(vec)); err != nil {
		return nil, err
	}
	if len(vec) == StorageDims {
		return vec, nil
	}
	out := make([]float32, StorageDims)
	copy(out, vec)
	return out, nil
}

// ValidateDims reports whether n is a width AnyTools stores.
func ValidateDims(n int) error {
	for _, d := range SupportedDims {
		if d == n {
			return nil
		}
	}
	return fmt.Errorf("%w: %d (supported: %v)", ErrUnsupportedDims, n, SupportedDims)
}

// PadBatch pads a whole batch, checking every vector against the route's
// declared width.
//
// Checking each one matters: a provider that silently truncates the last vector
// of a batch would otherwise store a short vector zero-padded into a different
// region of the space, and nothing downstream would ever notice.
func PadBatch(vectors [][]float32, dims int) ([][]float32, error) {
	if err := ValidateDims(dims); err != nil {
		return nil, err
	}
	out := make([][]float32, len(vectors))
	for i, v := range vectors {
		if len(v) != dims {
			return nil, fmt.Errorf("%w: vector %d has %d values, route declares %d",
				ErrDimsMismatch, i, len(v), dims)
		}
		padded, err := Pad(v)
		if err != nil {
			return nil, err
		}
		out[i] = padded
	}
	return out, nil
}

// Literal renders a vector as the text form pgvector parses: "[1,2,3]".
//
// It goes out as TEXT, not as a registered binary codec. Spike D measured the
// cost — about 5 ms per execution for a 3072-wide literal — and said to use it
// or budget for it. Budgeted: the alternative is registering a type codec on
// every pooled connection, and 5 ms sits inside a retrieval whose vector arm is
// 1.3 ms and whose network round trip already exceeds both.
//
// Formatting is pgvector-go's, so the literal this produces is by construction
// the one the extension's own client library would have sent.
func Literal(vec []float32) string {
	return pgvector.NewHalfVector(vec).String()
}
