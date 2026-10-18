package api

import (
	"slices"
	"testing"

	"github.com/D0bby999/anytools/internal/api/httpx"
)

// Up-methods phase 21: choosing an engine does not change what starting a
// transcription costs the server's budget. It stays an upload, whether the
// engine is the learner's key or the built-in Whisper (whose own daily
// minutes are metered separately, in stt_usage).
func TestTheTranscribeRouteStaysInTheUploadBudget(t *testing.T) {
	const route = "POST /v1/documents/{id}/transcribe"
	if got := budgetMarkers(t)[route]; got != "upload" {
		t.Fatalf("%s is marked %q", route, got)
	}
	for _, c := range httpx.RouteClasses {
		if slices.Contains(c.Patterns, route) && c.Name != "upload" {
			t.Fatalf("%s is in the %s class", route, c.Name)
		}
	}
}
