package readingapi_test

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/readingapi"
	"github.com/D0bby999/anytools/internal/capabilities/reading"
	"github.com/D0bby999/anytools/internal/notebook"
	"github.com/D0bby999/anytools/internal/runtime"
)

// TestTheWholeReadingLoop is the phase's acceptance criterion, run over HTTP
// against a real database with a scripted provider:
//
//	open a seeded PDF → highlight a passage → "explain" streams an answer →
//	save it to the notebook → the note carries the document id AND the page →
//	the notebook's export.md contains both.
//
// It is one test rather than six because the criterion is the SEQUENCE. Six
// tests that each pass on their own is exactly the shape of a feature where
// every part works and the product does not.
func TestTheWholeReadingLoop(t *testing.T) {
	h := newHarness(t)

	// 1. Open the document. The workspace is created on first read.
	ws := h.openWorkspace(t, h.alice, h.aliceDoc)
	if ws.DocumentID != h.aliceDoc {
		t.Fatalf("workspace document = %s, want %s", ws.DocumentID, h.aliceDoc)
	}

	// 2. The viewer fetches the original bytes — this is what pdf.js renders.
	res := h.do(t, h.alice, http.MethodGet, "/v1/reading/"+ws.ID.String()+"/file", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET file: status %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/pdf" {
		t.Fatalf("file content-type = %q", ct)
	}
	if res.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("the file endpoint lets the browser sniff a user's uploaded bytes")
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(body) != string(h.pdfBytes) {
		t.Fatalf("the file endpoint served %d bytes, want the seeded document", len(body))
	}

	// 3. Highlight a passage on page 14.
	const passage = "A system at equilibrium opposes the change imposed on it."
	hl := decode[reading.Highlight](t,
		h.do(t, h.alice, http.MethodPost, "/v1/reading/"+ws.ID.String()+"/highlights",
			map[string]any{"page": 14, "text": passage, "color": "yellow"}),
		http.StatusCreated)
	if hl.Page != 14 {
		t.Fatalf("highlight page = %d", hl.Page)
	}

	// 4. "Explain" starts a turn in the `reading` capability.
	started := decode[map[string]any](t,
		h.do(t, h.alice, http.MethodPost, "/v1/reading/"+ws.ID.String()+"/actions",
			map[string]any{"action": "explain", "selection": passage, "page": 14}),
		http.StatusAccepted)
	turnID, _ := started["turn_id"].(string)
	if turnID == "" {
		t.Fatalf("no turn id in %v", started)
	}

	// 5. The answer streams over the EXISTING turn endpoint.
	frames := h.readStream(t, h.alice, turnID)
	if s := h.await(t); s != runtime.StatusDone {
		t.Fatalf("turn status = %s", s)
	}
	var deltas int
	for _, f := range frames {
		if f.Data.Type == runtime.EvContent {
			deltas++
		}
	}
	if deltas == 0 {
		t.Fatal("the answer arrived in one piece: nothing streamed")
	}
	answer := answerOf(frames)
	if answer == "" {
		t.Fatalf("no result event in %d frames", len(frames))
	}

	// The selection reached the model inside a provenance envelope. Checked
	// here as well as in the capability's own tests, because this is the path
	// an actual request takes and the two could drift.
	sent := h.provider.sent()
	if len(sent) != 1 {
		t.Fatalf("%d provider calls, want 1", len(sent))
	}
	last := sent[0].Messages[len(sent[0].Messages)-1]
	if !strings.Contains(last.Content, `trust="untrusted"`) || !strings.Contains(last.Content, passage) {
		t.Fatalf("the selection did not reach the model enveloped:\n%s", last.Content)
	}

	// 6. Save the answer to the notebook, linked to the highlight.
	note := decode[notebook.Note](t,
		h.do(t, h.alice, http.MethodPost, "/v1/reading/"+ws.ID.String()+"/notes", map[string]any{
			"title": "Le Chatelier", "body_md": answer,
			"page": 14, "from": "tutor", "highlight_id": hl.ID.String(),
		}),
		http.StatusCreated)

	// 7. The note carries the document id AND the page — the phase's criterion.
	if note.Source.Kind != notebook.SourceDocument {
		t.Fatalf("note source kind = %q", note.Source.Kind)
	}
	if note.Source.ID != h.aliceDoc.String() {
		t.Fatalf("note source id = %q, want the document %s", note.Source.ID, h.aliceDoc)
	}
	if note.Source.Page != 14 {
		t.Fatalf("note source page = %d, want 14", note.Source.Page)
	}
	if note.CreatedBy != notebook.CreatedByAgent {
		t.Fatalf("created_by = %q; the tutor's answer must not be filed as the reader's own", note.CreatedBy)
	}
}

// TestTheSavedNoteIsBackLinkedAndExported continues the loop's last two steps.
//
// Split from the test above only because the assertion set is a different
// subject — what the notebook holds afterwards, rather than what the reading
// surface did.
func TestTheSavedNoteIsBackLinkedAndExported(t *testing.T) {
	h := newHarness(t)
	ws := h.openWorkspace(t, h.alice, h.aliceDoc)

	const passage = "Reciprocal rank fusion merges a lexical arm and a vector arm."
	hl := decode[reading.Highlight](t,
		h.do(t, h.alice, http.MethodPost, "/v1/reading/"+ws.ID.String()+"/highlights",
			map[string]any{"page": 7, "text": passage}),
		http.StatusCreated)

	note := decode[notebook.Note](t,
		h.do(t, h.alice, http.MethodPost, "/v1/reading/"+ws.ID.String()+"/notes", map[string]any{
			"title": "RRF", "body_md": passage, "from": "me", "highlight_id": hl.ID.String(),
		}),
		http.StatusCreated)

	// The page came from the highlight, not from the body: a reader who saves a
	// highlight should not have to restate which page it was on.
	if note.Source.Page != 7 {
		t.Fatalf("note page = %d, want 7 from the highlight", note.Source.Page)
	}
	if note.CreatedBy != notebook.CreatedByUser {
		t.Fatalf("created_by = %q, want user", note.CreatedBy)
	}

	highlights := decode[struct {
		Highlights []reading.Highlight `json:"highlights"`
	}](t, h.do(t, h.alice, http.MethodGet, "/v1/reading/"+ws.ID.String()+"/highlights", nil),
		http.StatusOK)
	if len(highlights.Highlights) != 1 {
		t.Fatalf("%d highlights, want 1", len(highlights.Highlights))
	}
	if got := highlights.Highlights[0].NoteID; got == nil || *got != note.ID {
		t.Fatalf("highlight note_id = %v, want %s", got, note.ID)
	}

	// The export names the document and the page as visible text.
	books := decode[struct {
		Notebooks []notebook.Notebook `json:"notebooks"`
	}](t, h.do(t, h.alice, http.MethodGet, "/v1/notebooks", nil), http.StatusOK)
	if len(books.Notebooks) != 1 {
		t.Fatalf("%d notebooks, want the one created on demand", len(books.Notebooks))
	}

	res := h.do(t, h.alice, http.MethodGet,
		"/v1/notebooks/"+books.Notebooks[0].ID.String()+"/export.md", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("export status %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/markdown") {
		t.Fatalf("export content-type = %q; Markdown rendered as HTML is an XSS surface", ct)
	}
	if cd := res.Header.Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment;") {
		t.Fatalf("export content-disposition = %q", cd)
	}
	md, _ := io.ReadAll(res.Body)
	res.Body.Close()

	for _, want := range []string{h.aliceDoc.String(), "page 7", "RRF", passage} {
		if !strings.Contains(string(md), want) {
			t.Errorf("export.md is missing %q\n---\n%s", want, md)
		}
	}
}

// TestProgressResumes: the whole point of a workspace.
func TestProgressResumes(t *testing.T) {
	h := newHarness(t)
	ws := h.openWorkspace(t, h.alice, h.aliceDoc)

	updated := decode[reading.Workspace](t,
		h.do(t, h.alice, http.MethodPatch, "/v1/reading/"+ws.ID.String(),
			map[string]any{"progress": map[string]any{"page": 14, "percent": 0.42}}),
		http.StatusOK)
	if updated.Progress.Page != 14 {
		t.Fatalf("progress = %+v", updated.Progress)
	}

	// Opening the document again is what a page load does.
	again := h.openWorkspace(t, h.alice, h.aliceDoc)
	if again.ID != ws.ID || again.Progress.Page != 14 {
		t.Fatalf("reopened workspace = %+v", again)
	}
}

// TestASecondActionSharesOneConversation: "explain, then quiz me on the same
// passage" has to be a conversation, not two amnesiac exchanges.
func TestASecondActionSharesOneConversation(t *testing.T) {
	h := newHarness(t)
	ws := h.openWorkspace(t, h.alice, h.aliceDoc)

	first := decode[map[string]any](t,
		h.do(t, h.alice, http.MethodPost, "/v1/reading/"+ws.ID.String()+"/actions",
			map[string]any{"action": "explain", "selection": "a passage", "page": 2}),
		http.StatusAccepted)
	h.readStream(t, h.alice, first["turn_id"].(string))
	h.await(t)

	second := decode[map[string]any](t,
		h.do(t, h.alice, http.MethodPost, "/v1/reading/"+ws.ID.String()+"/actions",
			map[string]any{"action": "quiz", "selection": "a passage", "page": 2}),
		http.StatusAccepted)
	h.readStream(t, h.alice, second["turn_id"].(string))
	h.await(t)

	if first["session_id"] != second["session_id"] {
		t.Fatalf("two sessions: %v and %v", first["session_id"], second["session_id"])
	}
	// And the second call saw the first exchange.
	sent := h.provider.sent()
	if len(sent) != 2 {
		t.Fatalf("%d provider calls, want 2", len(sent))
	}
	if len(sent[1].Messages) <= len(sent[0].Messages) {
		t.Fatalf("the second turn carried no history: %d messages vs %d",
			len(sent[1].Messages), len(sent[0].Messages))
	}
}

func TestActionsRejectWhatNobodyWroteAPromptFor(t *testing.T) {
	h := newHarness(t)
	ws := h.openWorkspace(t, h.alice, h.aliceDoc)
	path := "/v1/reading/" + ws.ID.String() + "/actions"

	cases := map[string]struct {
		body map[string]any
		want int
	}{
		"unknown action":  {map[string]any{"action": "summarise", "selection": "x"}, http.StatusBadRequest},
		"no action":       {map[string]any{"selection": "x"}, http.StatusBadRequest},
		"empty selection": {map[string]any{"action": "explain", "selection": "   "}, http.StatusBadRequest},
		"negative page":   {map[string]any{"action": "explain", "selection": "x", "page": -1}, http.StatusBadRequest},
		"huge selection": {
			map[string]any{"action": "explain", "selection": strings.Repeat("x", reading.MaxSelectionLen+1)},
			http.StatusRequestEntityTooLarge,
		},
	}
	for name, tc := range cases {
		if got := status(t, h.do(t, h.alice, http.MethodPost, path, tc.body)); got != tc.want {
			t.Errorf("%s: status %d, want %d", name, got, tc.want)
		}
	}
}

// TestCrossUserIsolationOnEveryIdRoute walks every route that takes an id with
// the WRONG user and requires 404 from each — never 403, and never a 200.
//
// The routes are listed from readingapi.Patterns() in the test below, so a
// route added without a probe here fails that test rather than shipping
// unprobed.
func TestCrossUserIsolationOnEveryIdRoute(t *testing.T) {
	h := newHarness(t)

	ws := h.openWorkspace(t, h.alice, h.aliceDoc)
	hl := decode[reading.Highlight](t,
		h.do(t, h.alice, http.MethodPost, "/v1/reading/"+ws.ID.String()+"/highlights",
			map[string]any{"page": 3, "text": "alice's passage"}),
		http.StatusCreated)

	id := ws.ID.String()
	probes := []struct {
		name, method, path string
		body               any
	}{
		{"GET /v1/reading/{id}", http.MethodGet, "/v1/reading/" + id, nil},
		{"PATCH /v1/reading/{id}", http.MethodPatch, "/v1/reading/" + id,
			map[string]any{"progress": map[string]any{"page": 99}}},
		{"DELETE /v1/reading/{id}", http.MethodDelete, "/v1/reading/" + id, nil},
		{"GET /v1/reading/{id}/file", http.MethodGet, "/v1/reading/" + id + "/file", nil},
		{"GET /v1/reading/{id}/highlights", http.MethodGet, "/v1/reading/" + id + "/highlights", nil},
		{"POST /v1/reading/{id}/highlights", http.MethodPost, "/v1/reading/" + id + "/highlights",
			map[string]any{"page": 1, "text": "stolen"}},
		{"POST /v1/reading/{id}/actions", http.MethodPost, "/v1/reading/" + id + "/actions",
			map[string]any{"action": "explain", "selection": "stolen"}},
		{"POST /v1/reading/{id}/terms", http.MethodPost, "/v1/reading/" + id + "/terms",
			map[string]any{"selection": "stolen", "page": 1}},
		{"POST /v1/reading/{id}/notes", http.MethodPost, "/v1/reading/" + id + "/notes",
			map[string]any{"title": "stolen", "body_md": "x"}},
		{"POST /v1/reading/{id}/diagram", http.MethodPost, "/v1/reading/" + id + "/diagram",
			map[string]any{"selection": "stolen"}},
		{"PATCH /v1/reading/highlights/{hid}", http.MethodPatch,
			"/v1/reading/highlights/" + hl.ID.String(), map[string]any{"color": "pink"}},
		{"DELETE /v1/reading/highlights/{hid}", http.MethodDelete,
			"/v1/reading/highlights/" + hl.ID.String(), nil},
	}

	for _, p := range probes {
		if got := status(t, h.do(t, h.bob, p.method, p.path, p.body)); got != http.StatusNotFound {
			t.Errorf("%s as the wrong user: status %d, want 404", p.name, got)
		}
	}

	// Bob's listing must not contain alice's workspace.
	list := decode[struct {
		Workspaces []reading.Workspace `json:"workspaces"`
	}](t, h.do(t, h.bob, http.MethodGet, "/v1/reading/workspaces", nil), http.StatusOK)
	for _, w := range list.Workspaces {
		if w.ID == ws.ID {
			t.Fatal("alice's workspace appeared in bob's list")
		}
	}

	// And opening a workspace over ALICE's document is refused before any row
	// is written — the check that stops the workspace table from becoming an
	// existence oracle for other people's libraries.
	if got := status(t, h.do(t, h.bob, http.MethodPost, "/v1/reading/workspaces",
		map[string]any{"document_id": h.aliceDoc.String()})); got != http.StatusNotFound {
		t.Errorf("opening alice's document as bob: status %d, want 404", got)
	}

	// Alice's rows survived every probe.
	if got := status(t, h.do(t, h.alice, http.MethodGet, "/v1/reading/"+id, nil)); got != http.StatusOK {
		t.Fatalf("alice lost her workspace to bob's probes: status %d", got)
	}
}

// TestEveryIdRouteIsProbed keeps the isolation sweep honest: a new route in
// Patterns() that no probe above touches fails here.
func TestEveryIdRouteIsProbed(t *testing.T) {
	probed := map[string]bool{
		"GET /v1/reading/{id}":                true,
		"PATCH /v1/reading/{id}":              true,
		"DELETE /v1/reading/{id}":             true,
		"GET /v1/reading/{id}/file":           true,
		"GET /v1/reading/{id}/highlights":     true,
		"POST /v1/reading/{id}/highlights":    true,
		"POST /v1/reading/{id}/actions":       true,
		"POST /v1/reading/{id}/terms":         true,
		"POST /v1/reading/{id}/notes":         true,
		"POST /v1/reading/{id}/diagram":       true,
		"PATCH /v1/reading/highlights/{hid}":  true,
		"DELETE /v1/reading/highlights/{hid}": true,
		// No id: collection routes are scoped by the authenticated user alone.
		"GET /v1/reading/workspaces":  true,
		"POST /v1/reading/workspaces": true,
	}
	for _, p := range readingapi.Patterns() {
		if !probed[p] {
			t.Errorf("%s has no cross-user probe in TestCrossUserIsolationOnEveryIdRoute", p)
		}
	}
}

// TestAForeignDocumentIsNeverServed: the file endpoint hands back raw uploaded
// bytes, so it gets its own assertion rather than relying on the sweep above.
func TestAForeignDocumentIsNeverServed(t *testing.T) {
	h := newHarness(t)
	bobWS := h.openWorkspace(t, h.bob, h.bobDoc)

	if got := status(t, h.do(t, h.alice, http.MethodGet,
		"/v1/reading/"+bobWS.ID.String()+"/file", nil)); got != http.StatusNotFound {
		t.Fatalf("alice read bob's file: status %d, want 404", got)
	}
}

// TestAMalformedIdIsIndistinguishableFromAForeignOne. Anything else tells a
// prober which of their guesses were syntactically interesting.
func TestAMalformedIdIsIndistinguishableFromAForeignOne(t *testing.T) {
	h := newHarness(t)
	for _, id := range []string{"not-a-uuid", uuid.Nil.String(), uuid.NewString()} {
		if got := status(t, h.do(t, h.alice, http.MethodGet, "/v1/reading/"+id, nil)); got != http.StatusNotFound {
			t.Errorf("GET /v1/reading/%s: status %d, want 404", id, got)
		}
	}
}
