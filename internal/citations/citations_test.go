package citations

import (
	"strings"
	"testing"
)

func TestParseFindsMarkersInOrder(t *testing.T) {
	text := "Retrieval is hybrid [[cite:chunk:abc-1]]. It also reranks [[cite:chunk:def-2]] " +
		"and the first point repeats [[cite:chunk:abc-1]]."

	refs := Parse(text)
	if len(refs) != 3 {
		t.Fatalf("found %d markers, want 3", len(refs))
	}
	if refs[0].ID != "abc-1" || refs[1].ID != "def-2" || refs[2].ID != "abc-1" {
		t.Fatalf("ids = %v", refs)
	}
	for _, r := range refs {
		if r.Kind != KindChunk {
			t.Errorf("kind = %q, want chunk", r.Kind)
		}
	}
}

// The marker charset is narrow on purpose: a permissive pattern would swallow
// attacker text out of a document into an "id" that later gets rendered.
func TestParseRejectsMalformedMarkers(t *testing.T) {
	for _, text := range []string{
		"[[cite:chunk:]]",
		"[[cite:file:abc]]",
		"[[cite:chunk:has space]]",
		"[[cite:chunk:<script>]]",
		"[cite:chunk:abc]",
		"[[cite:chunk:" + strings.Repeat("a", 200) + "]]",
	} {
		if refs := Parse(text); len(refs) != 0 {
			t.Errorf("%q parsed as %v, want no markers", text, refs)
		}
	}
}

func TestFormatAndParseRoundTrip(t *testing.T) {
	marker := Format(KindChunk, "7f3a-9")
	refs := Parse("see " + marker)
	if len(refs) != 1 || refs[0].ID != "7f3a-9" {
		t.Fatalf("round trip failed: %v", refs)
	}
}

// The product's whole claim is that an answer is worth what its source is
// worth. A citation nothing produced is removed, not rendered.
func TestValidateDropsUnknownCitations(t *testing.T) {
	known := Index([]Source{
		{Kind: KindChunk, ID: "real-1", Title: "Chapter 3", Page: 14, DocumentID: "doc-1"},
	})

	res := Validate(
		"Grounded [[cite:chunk:real-1]] and invented [[cite:chunk:hallucinated]].", known)

	if strings.Contains(res.Text, "hallucinated") {
		t.Fatalf("the unknown marker survived: %q", res.Text)
	}
	if !strings.Contains(res.Text, "[[cite:chunk:real-1]]") {
		t.Fatalf("the real marker was removed: %q", res.Text)
	}
	if len(res.Sources) != 1 || res.Sources[0].Page != 14 {
		t.Fatalf("sources = %+v", res.Sources)
	}
	if len(res.Dropped) != 1 || res.Dropped[0].ID != "hallucinated" {
		t.Fatalf("dropped = %+v", res.Dropped)
	}
}

// A source cited twice is one chip, in first-citation order.
func TestValidateDeduplicatesSourcesInFirstCitationOrder(t *testing.T) {
	known := Index([]Source{
		{Kind: KindChunk, ID: "b", Title: "B"},
		{Kind: KindChunk, ID: "a", Title: "A"},
	})

	res := Validate("[[cite:chunk:a]] then [[cite:chunk:b]] then [[cite:chunk:a]]", known)

	if len(res.Sources) != 2 {
		t.Fatalf("got %d sources, want 2", len(res.Sources))
	}
	if res.Sources[0].ID != "a" || res.Sources[1].ID != "b" {
		t.Fatalf("order = %s,%s, want a,b (first citation wins)", res.Sources[0].ID, res.Sources[1].ID)
	}
}

// An answer with no citations at all is passed through unchanged: not every
// sentence is a claim about a document.
func TestValidateLeavesUncitedProseAlone(t *testing.T) {
	const text = "I could not find anything about that in your documents."
	res := Validate(text, nil)
	if res.Text != text {
		t.Fatalf("text was altered: %q", res.Text)
	}
	if len(res.Sources) != 0 || len(res.Dropped) != 0 {
		t.Fatalf("invented sources: %+v / %+v", res.Sources, res.Dropped)
	}
}

// A model that cites nothing but real ids, with no known sources at all (a turn
// where every tool errored), must end up with plain prose rather than raw
// markers on screen.
func TestValidateWithNoKnownSourcesStripsEverything(t *testing.T) {
	res := Validate("Answer [[cite:chunk:x]] here.", nil)
	if strings.Contains(res.Text, "cite:") {
		t.Fatalf("a marker survived with no known sources: %q", res.Text)
	}
	if res.Text != "Answer here." {
		t.Fatalf("text = %q, want the double space collapsed", res.Text)
	}
}

func TestStripRemovesMarkersForPlainText(t *testing.T) {
	got := Strip("One [[cite:chunk:a]] two [[cite:url:3]] three.")
	if got != "One two three." {
		t.Fatalf("Strip = %q", got)
	}
}

// Every id a tool mints has to survive the marker it goes into. This is the
// test that would have caught `#p14`: a `#` is outside the id charset, so the
// marker never parses, the validator never sees it, and it reaches the reader
// as literal `[[cite:chunk:…]]` in the answer and in the stored transcript.
func TestPageRefRoundTripsThroughTheMarker(t *testing.T) {
	const doc = "6f1c9c4e-2b7a-4f1e-9d3a-0c2b8e4a1f77"

	for _, page := range []int{1, 9, 14, 250, 1999} {
		id := PageRef(doc, page)
		refs := Parse(Format(KindChunk, id))
		if len(refs) != 1 {
			t.Fatalf("PageRef(%d) = %q produced a marker that does not parse", page, id)
		}
		if refs[0].ID != id {
			t.Fatalf("round trip changed the id: %q -> %q", id, refs[0].ID)
		}

		// And it survives validation as a real source rather than being dropped.
		res := Validate("Claim. "+Format(KindChunk, id),
			Index([]Source{{Kind: KindChunk, ID: id, Title: "Chapter 3", Page: page, DocumentID: doc}}))
		if len(res.Sources) != 1 || len(res.Dropped) != 0 {
			t.Fatalf("PageRef id did not validate: sources=%+v dropped=%+v", res.Sources, res.Dropped)
		}
	}
}

// The characters an id may NOT contain, stated as a test so a future id scheme
// has to confront them.
func TestIDsOutsideTheCharsetDoNotParse(t *testing.T) {
	const doc = "6f1c9c4e-2b7a-4f1e-9d3a-0c2b8e4a1f77"
	for _, bad := range []string{doc + "#p14", doc + "/p14", doc + " p14", doc + "?page=14"} {
		if refs := Parse(Format(KindChunk, bad)); len(refs) != 0 {
			t.Errorf("%q unexpectedly parsed as %+v", bad, refs)
		}
	}
}

func TestKeyMatchesIndex(t *testing.T) {
	idx := Index([]Source{{Kind: KindURL, ID: "3"}})
	if _, ok := idx[Key(KindURL, "3")]; !ok {
		t.Fatal("Key and Index disagree on the map key")
	}
}
