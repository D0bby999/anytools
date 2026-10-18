package app

// project_kinds_e2e_test.go — up-methods phase 8, through the wiring.
//
// A delivered artifact brief goes on its goal's evidence chain at the
// transfer timepoint (the page's "Add to evidence"), its parallel test is set
// only once the delivery line is filled, the narrative case review is refused
// as evidence and cannot attach to a goal, and the interview card's story
// bank takes twelve stories through the row append route, not thirteen.

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/learning/worksheet"
)

func TestPhase8ProjectKindsEndToEnd(t *testing.T) {
	e := newE2E(t)
	started := e.json(http.MethodPost, "/v1/learning/states", map[string]string{
		"goal": "Ship a status page", "real_scenario": "My team's weekly update",
		"outcome_12w": "Others use it without me", "first_task": "One page",
	}, http.StatusCreated)
	stateID := mapAt(started, "state")["id"].(string)
	chain := e.json(http.MethodPost, "/v1/learning/states/"+stateID+"/chains",
		map[string]any{"question": "Can someone else start from it?"}, http.StatusCreated)
	chainID := chain["id"].(string)

	// ── the artifact brief ────────────────────────────────────────────────
	brief := e.json(http.MethodPost, "/v1/worksheets", map[string]any{
		"kind": worksheet.ArtifactBriefKind, "title": "Status page brief", "state_id": stateID}, http.StatusCreated)
	briefID := brief["id"].(string)
	if reviews, _ := brief["reviews"].(map[string]any); len(reviews) != 0 {
		t.Fatalf("the parallel test is set before delivery: %v", reviews)
	}
	delivered := e.json(http.MethodPatch, "/v1/worksheets/"+briefID, map[string]any{
		"revision": brief["updated_at"],
		"answers": map[string]any{worksheet.ArtifactDelivery: map[string]any{
			worksheet.ArtifactDeliveredOn: "v1.0, delivered today"}},
	}, http.StatusOK)
	test := mapAt(delivered, "reviews", "parallel_test")
	if test["due"] == nil || test["due"] != test["earliest"] {
		t.Fatalf("the parallel test after delivery: %v", test)
	}
	e.json(http.MethodPost, "/v1/learning/chains/"+chainID+"/evidence", map[string]any{
		"kind": "worksheet", "ref_id": briefID, "timepoint": "transfer"}, http.StatusCreated)
	onChain := e.json(http.MethodGet, "/v1/learning/chains/"+chainID, nil, http.StatusOK)
	var found bool
	for _, col := range onChain["columns"].([]any) {
		c := col.(map[string]any)
		for _, r := range c["refs"].([]any) {
			ref := r.(map[string]any)
			if ref["ref_id"] == briefID {
				found = c["timepoint"] == "transfer" &&
					mapAt(ref, "target")["label"] == "Status page brief" &&
					mapAt(ref, "target")["detail"] == "Artifact brief"
			}
		}
	}
	if !found {
		t.Fatalf("the brief is not on the chain as transfer evidence: %v", onChain["columns"])
	}

	// ── the narrative case review: private ───────────────────────────────
	if got := e.status(http.MethodPost, "/v1/worksheets", map[string]any{
		"kind": worksheet.NarrativeCaseReviewKind, "title": "Leaving my last job", "state_id": stateID}); got != http.StatusBadRequest {
		t.Errorf("a narrative case review attached to a goal: %d", got)
	}
	narrative := e.json(http.MethodPost, "/v1/worksheets", map[string]any{
		"kind": worksheet.NarrativeCaseReviewKind, "title": "Leaving my last job"}, http.StatusCreated)
	if narrative["private"] != true {
		t.Fatalf("the narrative case review is stored as not private: %v", narrative["private"])
	}
	if got := e.status(http.MethodPost, "/v1/learning/chains/"+chainID+"/evidence", map[string]any{
		"kind": "worksheet", "ref_id": narrative["id"], "timepoint": "transfer"}); got != http.StatusNotFound {
		t.Errorf("a narrative case review added to a chain: %d", got)
	}
	if got := e.raw(http.MethodGet, "/v1/learning/chains/"+chainID, nil); strings.Contains(got, "Leaving my last job") {
		t.Fatal("the narrative case review's title is on the chain")
	}

	// ── the story bank: twelve stories, not thirteen ─────────────────────
	card := e.json(http.MethodPost, "/v1/worksheets", map[string]any{
		"kind": worksheet.InterviewEvidenceKind, "title": "Backend role", "state_id": stateID}, http.StatusCreated)
	story := func(n int) map[string]any {
		return map[string]any{"section": "stories", "field": "stories", "row": map[string]any{
			"row": "", "cells": map[string]any{"name": fmt.Sprintf("Story %d", n), "answers": []string{"failure"}, "holds": "yes"}}}
	}
	for n := 1; n <= 12; n++ {
		e.json(http.MethodPost, "/v1/worksheets/"+card["id"].(string)+"/rows", story(n), http.StatusCreated)
	}
	if got := e.status(http.MethodPost, "/v1/worksheets/"+card["id"].(string)+"/rows", story(13)); got != http.StatusBadRequest {
		t.Fatalf("a thirteenth story: %d", got)
	}
}
