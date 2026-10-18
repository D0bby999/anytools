package embed_test

import (
	"errors"
	"math"
	"math/rand"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/rag/embed"
)

// The claim Spike D measured, re-proved here as arithmetic: appending zeros
// changes neither dot product nor magnitude, so cosine similarity is identical.
// The spike showed it empirically over 50 000 rows (top-40 ordering identical
// in 40/40 positions, max |cosine delta| exactly 0); this pins the reason.
func TestPaddingDoesNotChangeCosineSimilarity(t *testing.T) {
	rng := rand.New(rand.NewSource(20260916))
	for trial := 0; trial < 50; trial++ {
		a := randomVector(rng, 1536)
		b := randomVector(rng, 1536)

		pa, err := embed.Pad(a)
		if err != nil {
			t.Fatalf("Pad: %v", err)
		}
		pb, err := embed.Pad(b)
		if err != nil {
			t.Fatalf("Pad: %v", err)
		}

		native := cosine(a, b)
		padded := cosine(pa, pb)
		if delta := math.Abs(native - padded); delta > 1e-12 {
			t.Fatalf("trial %d: cosine changed by %g (%g -> %g)", trial, delta, native, padded)
		}
	}
}

func TestPadWidensToTheStorageWidthAndPreservesValues(t *testing.T) {
	v := []float32{1, -2, 3.5}
	v = append(v, make([]float32, 1536-3)...)

	out, err := embed.Pad(v)
	if err != nil {
		t.Fatalf("Pad: %v", err)
	}
	if len(out) != embed.StorageDims {
		t.Fatalf("len = %d, want %d", len(out), embed.StorageDims)
	}
	for i, want := range []float32{1, -2, 3.5} {
		if out[i] != want {
			t.Fatalf("out[%d] = %v, want %v", i, out[i], want)
		}
	}
	for i := 1536; i < embed.StorageDims; i++ {
		if out[i] != 0 {
			t.Fatalf("padding at %d is %v, want 0", i, out[i])
		}
	}
}

func TestPadIsAPassThroughAtFullWidth(t *testing.T) {
	v := make([]float32, embed.StorageDims)
	v[0] = 7
	out, err := embed.Pad(v)
	if err != nil {
		t.Fatalf("Pad: %v", err)
	}
	if len(out) != embed.StorageDims || out[0] != 7 {
		t.Fatalf("unexpected result: len=%d out[0]=%v", len(out), out[0])
	}
}

// An allowlist, not "anything up to 3072". A route that suddenly returns an
// unusual width has changed under us, and padding it quietly would index
// vectors from a different space alongside the old ones.
func TestUnsupportedWidthIsRefused(t *testing.T) {
	for _, n := range []int{0, 1, 1537, 3073, 100000} {
		if _, err := embed.Pad(make([]float32, n)); !errors.Is(err, embed.ErrUnsupportedDims) {
			t.Fatalf("Pad(%d) err = %v, want ErrUnsupportedDims", n, err)
		}
	}
	for _, n := range embed.SupportedDims {
		if err := embed.ValidateDims(n); err != nil {
			t.Fatalf("ValidateDims(%d) = %v", n, err)
		}
	}
}

// A provider that truncates one vector in a batch would otherwise have that
// short vector zero-padded into a different region of the space, and nothing
// downstream would notice.
func TestPadBatchRejectsARaggedBatch(t *testing.T) {
	good := make([]float32, 768)
	short := make([]float32, 512)

	_, err := embed.PadBatch([][]float32{good, good, short}, 768)
	if !errors.Is(err, embed.ErrDimsMismatch) {
		t.Fatalf("err = %v, want ErrDimsMismatch", err)
	}
	if !strings.Contains(err.Error(), "vector 2") {
		t.Fatalf("the error should name the offending vector: %v", err)
	}

	out, err := embed.PadBatch([][]float32{good, good}, 768)
	if err != nil {
		t.Fatalf("PadBatch: %v", err)
	}
	for i, v := range out {
		if len(v) != embed.StorageDims {
			t.Fatalf("vector %d is %d wide after padding", i, len(v))
		}
	}
}

func TestLiteralIsTheFormPgvectorParses(t *testing.T) {
	got := embed.Literal([]float32{1, -2.5, 0})
	if got != "[1,-2.5,0]" {
		t.Fatalf("Literal = %q, want [1,-2.5,0]", got)
	}
}

func randomVector(rng *rand.Rand, n int) []float32 {
	v := make([]float32, n)
	for i := range v {
		v[i] = float32(rng.NormFloat64())
	}
	return v
}

func cosine(a, b []float32) float64 {
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
	}
	for i := range b {
		nb += float64(b[i]) * float64(b[i])
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}
