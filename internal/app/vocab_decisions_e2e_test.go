package app

// vocab_decisions_e2e_test.go — up-methods phase 3 through the wiring: the
// five decisions about an unknown word, the production card, and copying
// notes into a vocabulary audit's §3 queue.
//
// Words come from the same scripted reading model as vocab_e2e_test.go; no
// live provider was called. Nothing on these routes calls a model.

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestVocabularyDecisionsEndToEnd(t *testing.T) {
	model := newTermsModel(t)
	e := buildE2E(t, model.server.URL, []string{"reading"}, nil)

	kbID := uuid.MustParse(e.json(http.MethodPost, "/v1/kb",
		map[string]string{"name": "Papers"}, http.StatusCreated)["id"].(string))
	e.upload(kbID, "rag.pdf", ragFixturePDF(t))
	e.drainJobs()
	var docID uuid.UUID
	if err := e.pool.QueryRow(e.t.Context(),
		`SELECT id FROM documents WHERE user_id = $1 AND kb_id = $2`, e.user, kbID).Scan(&docID); err != nil {
		t.Fatal(err)
	}
	ws := e.json(http.MethodPost, "/v1/reading/workspaces",
		map[string]any{"document_id": docID}, http.StatusOK)["id"].(string)
	selection := "Crucially, by using pre-trained access mechanisms, the ability to access knowl- edge is present without additional training."
	word := func(term, decision string, record map[string]string) map[string]any {
		return map[string]any{"workspace_id": ws, "page": 2, "selection": selection, "term": term,
			"decision": decision, "record": record, "task_impact": "minor"}
	}

	// A decision without its minimum record, or one up does not have, is 400.
	for name, body := range map[string]map[string]any{
		"skip without why":    word("Crucially", "skip", map[string]string{}),
		"an unknown decision": word("Crucially", "memorise", map[string]string{"why": "w"}),
		"infer, no sense":     word("Crucially", "infer", map[string]string{"confidence": "low"}),
	} {
		if got := e.status(http.MethodPost, "/v1/vocab", body); got != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", name, got)
		}
	}

	// Skip: stored with its record, no meaning, no cards, no week count.
	skipped := e.json(http.MethodPost, "/v1/vocab",
		word("Crucially", "skip", map[string]string{"why": "only emphasis"}), http.StatusCreated)
	note := mapAt(skipped, "note")
	if note["decision"] != "skip" || mapAt(note, "record")["why"] != "only emphasis" || note["task_impact"] != "minor" {
		t.Fatalf("skip note = %v", note)
	}
	if cards, _ := note["cards"].([]any); len(cards) != 0 || skipped["week"] != nil {
		t.Fatalf("a skipped word: cards %v, week %v", cards, skipped["week"])
	}
	id := note["id"].(string)

	// The picker finds it by term, and a second save keeps its decision.
	found := e.json(http.MethodGet, "/v1/vocab?term=crucially&term=nothing&lang=en", nil, http.StatusOK)
	if notes, _ := found["notes"].([]any); len(notes) != 1 || mapAt(notes[0])["id"] != id {
		t.Fatalf("lookup by term = %v", found)
	}
	learnBody := word("Crucially", "learn", map[string]string{"sound": "KROO-shul-ee", "collocation": "crucially, …", "cue": "the deciding point"})
	learnBody["meaning"] = "in a way that decides the outcome"
	again := e.json(http.MethodPost, "/v1/vocab", learnBody, http.StatusOK)
	if mapAt(again, "note")["decision"] != "skip" || again["created"] != false {
		t.Fatalf("a second save changed the decision: %v", again)
	}
	if due := e.json(http.MethodGet, "/v1/vocab/due?limit=0", nil, http.StatusOK)["due_count"].(float64); due != 0 {
		t.Fatalf("%v due after a skip", due)
	}
	// Production is refused on a word that is not being learned.
	if got := e.status(http.MethodPost, "/v1/vocab/"+id+"/production", map[string]any{"scenario": "s"}); got != http.StatusBadRequest {
		t.Fatalf("production on a skipped word: %d, want 400", got)
	}

	// PATCH to learn: two cards, and the week's count beside the note.
	learned := e.json(http.MethodPatch, "/v1/vocab/"+id, map[string]any{
		"decision": "learn", "record": learnBody["record"], "meaning": learnBody["meaning"],
	}, http.StatusOK)
	if cards, _ := learned["cards"].([]any); learned["decision"] != "learn" || len(cards) != 2 {
		t.Fatalf("skip → learn = %v", learned)
	}
	if week := mapAt(learned, "week"); week["learning"].(float64) != 1 || week["notice"] != nil {
		t.Fatalf("week = %v", week)
	}

	// Practise using it: the production card, scenario on its front.
	practised := e.json(http.MethodPost, "/v1/vocab/"+id+"/production", map[string]any{
		"scenario": "telling the team which test decides the release", "confusable": "critically: about danger, not deciding",
	}, http.StatusOK)
	if cards, _ := practised["cards"].([]any); practised["production"] != true || len(cards) != 3 {
		t.Fatalf("production on = %v", practised)
	}
	due := e.json(http.MethodGet, "/v1/vocab/due", nil, http.StatusOK)
	var production map[string]any
	for _, c := range due["cards"].([]any) {
		if mapAt(c)["kind"] == "production" {
			production = mapAt(c)
		}
	}
	if production == nil || production["scenario"] != "telling the team which test decides the release" ||
		production["confusable"] != "critically: about danger, not deciding" {
		t.Fatalf("due production card = %v (all: %v)", production, due)
	}
	review := e.json(http.MethodPost, "/v1/vocab/cards/"+production["id"].(string)+"/review",
		map[string]any{"rating": "good", "answer": "crucially", "request_id": uuid.NewString()}, http.StatusOK)
	if review["matched"] != true {
		t.Fatalf("a typed production answer: %v", review)
	}
	off := e.json(http.MethodPatch, "/v1/vocab/"+id, map[string]any{"production": false}, http.StatusOK)
	if off["production"] != false || off["week"] != nil {
		t.Fatalf("production off = %v", off)
	}

	// The listening card (the private design notes, phase 1): refused
	// for a word from a PDF; once the document is a timed video, the note
	// carries the line and its card plays it.
	if got := e.status(http.MethodPatch, "/v1/vocab/"+id, map[string]any{"listening": true}); got != http.StatusBadRequest {
		t.Fatalf("listening on a word from a PDF: %d, want 400", got)
	}
	if _, err := e.pool.Exec(e.t.Context(), `
		UPDATE documents SET source_kind = 'youtube', source_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
		       media_id = 'dQw4w9WgXcQ', timeline = '[[0, 4], [12, 17]]' WHERE id = $1`, docID); err != nil {
		t.Fatal(err)
	}
	heard := e.json(http.MethodPatch, "/v1/vocab/"+id, map[string]any{"listening": true}, http.StatusOK)
	if clip := mapAt(heard, "clip"); heard["listening"] != true || clip["video_id"] != "dQw4w9WgXcQ" || clip["start"] != float64(12) {
		t.Fatalf("listening on = %v", heard)
	}
	var listen map[string]any
	for _, c := range e.json(http.MethodGet, "/v1/vocab/due?limit=50", nil, http.StatusOK)["cards"].([]any) {
		if mapAt(c)["kind"] == "listen" {
			listen = mapAt(c)
		}
	}
	if listen == nil || mapAt(listen, "clip")["end"] != float64(17) || listen["cloze"] == "" {
		t.Fatalf("due listening card = %v", listen)
	}
	e.json(http.MethodPatch, "/v1/vocab/"+id, map[string]any{"listening": false}, http.StatusOK)

	// A client from before decisions still saves a word to learn.
	legacy := e.json(http.MethodPost, "/v1/vocab", map[string]any{"workspace_id": ws, "page": 2, "selection": selection,
		"term": "access mechanisms", "meaning": "The way a model reaches stored knowledge."}, http.StatusCreated)
	if n := mapAt(legacy, "note"); n["decision"] != "learn" || len(n["cards"].([]any)) != 2 {
		t.Fatalf("a save without a decision = %v", n)
	}
	if mapAt(legacy, "week")["learning"].(float64) != 2 {
		t.Fatalf("week after a second learn = %v", legacy["week"])
	}

	// "Add to a vocabulary audit": the note becomes a row of an open audit's
	// §3 queue, in the shape the vocabulary page sends.
	audit := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": "vocabulary_audit", "title": "Reading the RAG paper"}, http.StatusCreated)
	row := map[string]any{"section": "queue", "field": "items", "row": map[string]any{"row": "", "cells": map[string]any{
		"item": "Crucially", "impact": "minor", "decision": "learn", "basis": "the deciding point"}}}
	appended := e.json(http.MethodPost, "/v1/worksheets/"+audit["id"].(string)+"/rows", row, http.StatusCreated)
	items, _ := mapAt(appended, "answers", "queue")["items"].([]any)
	if len(items) != 1 || mapAt(items[0], "cells")["item"] != "Crucially" {
		t.Fatalf("the audit's queue = %v", appended["answers"])
	}
	row["row"].(map[string]any)["cells"].(map[string]any)["decision"] = "memorise"
	if got := e.status(http.MethodPost, "/v1/worksheets/"+audit["id"].(string)+"/rows", row); got != http.StatusBadRequest {
		t.Fatalf("a queue row with a decision up does not have: %d, want 400", got)
	}
}
