package providers

import (
	"strings"
	"testing"
)

// The breakpoint stays on the marked block when system text follows it:
// chat's per-turn notes sit beside the question and change every turn, so a
// breakpoint on them would write a cache entry no later call reads.
func TestAnthropicKeepsTheBreakpointOnTheMarkedBlock(t *testing.T) {
	p := NewAnthropicProvider("k")
	body := p.buildRequestBody("claude", ChatRequest{Messages: []Message{
		{Role: "system", Content: "rules\n" + SystemCacheBoundaryMarker},
		{Role: "user", Content: "earlier"},
		{Role: "assistant", Content: "answer"},
		{Role: "system", Content: "per-turn note"},
		{Role: "user", Content: "now"},
	}}, false)
	blocks := body["system"].([]map[string]interface{})
	if len(blocks) != 2 || blocks[0]["text"] != "rules" || blocks[1]["text"] != "per-turn note" {
		t.Fatalf("system blocks: %+v", blocks)
	}
	if blocks[0]["cache_control"] == nil || blocks[1]["cache_control"] != nil {
		t.Fatalf("breakpoint on the wrong block: %+v", blocks)
	}
}

// A provider with no cache never sees the marker as text.
func TestTheMarkerIsStrippedForProvidersWithoutACache(t *testing.T) {
	if got := StripCacheMarker("rules\n" + SystemCacheBoundaryMarker); got != "rules" {
		t.Fatalf("got %q", got)
	}
	body := (&CodexProvider{}).buildBody("m", ChatRequest{Messages: []Message{{Role: "system", Content: "rules\n" + SystemCacheBoundaryMarker}, {Role: "user", Content: "q"}}}, false)
	if strings.Contains(body["instructions"].(string), "cache-boundary") {
		t.Fatal("codex was sent the marker")
	}
}
