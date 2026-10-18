package app

// up_templates_e2e_test.go — phase 2 of plans/261017-1828-up-f13ff2d-upgrade
// over HTTP: up's four templates new at f13ff2d are served as project kinds,
// each goes on a goal's evidence chain; an AI evaluation's stored pass rate
// that disagrees with its case rows is 400 (a timeout counts among the
// attempts, and a case added afterwards is not refused); and a consistency
// plan cannot be opened on another user's learning state, which answers
// exactly like a missing one.

import (
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/testutil"
)

var upF13ff2dTemplates = []string{
	worksheet.ConsistencyPlanKind, worksheet.AIEvaluationKind, worksheet.AITrendRadarKind, worksheet.StartupExperimentKind,
}

func TestTheFourNewTemplatesAreProjectEvidence(t *testing.T) {
	e := newE2E(t)
	served := map[string]map[string]any{}
	for _, k := range e.json(http.MethodGet, "/v1/worksheet-kinds", nil, http.StatusOK)["kinds"].([]any) {
		m := k.(map[string]any)
		served[m["kind"].(string)] = m
	}
	started := e.json(http.MethodPost, "/v1/learning/states", map[string]string{
		"goal": "Decide on an AI workflow", "real_scenario": "Weekly price comparison",
		"outcome_12w": "A decision with evidence", "first_task": "Ten fixed cases",
	}, http.StatusCreated)
	stateID := mapAt(started, "state")["id"].(string)
	chainID := e.json(http.MethodPost, "/v1/learning/states/"+stateID+"/chains",
		map[string]any{"question": "Does the candidate hold up?"}, http.StatusCreated)["id"].(string)

	for _, kind := range upF13ff2dTemplates {
		k := served[kind]
		if k == nil || k["group"] != worksheet.GroupProjects || k["private"] != false || k["attach"] != worksheet.AttachState {
			t.Fatalf("%s is not served as a project kind that attaches to a goal: %v", kind, k)
		}
		w := e.json(http.MethodPost, "/v1/worksheets", map[string]any{
			"kind": kind, "title": kind + " on the goal", "state_id": stateID}, http.StatusCreated)
		if w["private"] != false {
			t.Fatalf("%s stored as private", kind)
		}
		e.json(http.MethodPost, "/v1/learning/chains/"+chainID+"/evidence", map[string]any{
			"kind": "worksheet", "ref_id": w["id"], "timepoint": "transfer"}, http.StatusCreated)
	}
}

func TestAnAIEvaluationsStoredRateMustMatchItsCases(t *testing.T) {
	e := newE2E(t)
	w := e.json(http.MethodPost, "/v1/worksheets", map[string]any{
		"kind": worksheet.AIEvaluationKind, "title": "Price extraction, prompt B"}, http.StatusCreated)
	id := w["id"].(string)
	attempt := func(version, first, final string) map[string]any {
		return map[string]any{"row": "", "cells": map[string]any{
			worksheet.EvaluationVersion: version, worksheet.EvaluationFirstPass: first, worksheet.EvaluationFinal: final}}
	}
	cases := func(rev any, rows ...any) map[string]any {
		return e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": rev,
			"answers": map[string]any{worksheet.EvaluationCases: map[string]any{worksheet.EvaluationCasesTable: rows}}},
			http.StatusOK)
	}
	rates := func(rev any, first string) map[string]any {
		return map[string]any{"revision": rev, "answers": map[string]any{worksheet.EvaluationResults: map[string]any{
			worksheet.EvaluationRates: []any{map[string]any{"row": worksheet.VersionCurrent, "cells": map[string]any{
				worksheet.EvaluationFirstPass: first}}}}}}
	}

	// Three attempts on the current version: one pass, one fail, one timeout.
	saved := cases(w["updated_at"],
		attempt(worksheet.VersionCurrent, worksheet.AttemptPass, worksheet.FinalAccepted),
		attempt(worksheet.VersionCurrent, worksheet.AttemptFail, worksheet.FinalAccepted),
		attempt(worksheet.VersionCurrent, worksheet.AttemptTimeout, worksheet.FinalTimeout))
	// Leaving the timeout out of the attempts is refused, naming the cell.
	bad := e.json(http.MethodPatch, "/v1/worksheets/"+id, rates(saved["updated_at"], "1/2"), http.StatusBadRequest)
	if bad["field"] != "results.rates[0].first_pass" {
		t.Fatalf("a rate that drops the timeout = %v", bad)
	}
	if bad := e.json(http.MethodPatch, "/v1/worksheets/"+id, rates(saved["updated_at"], "about half"), http.StatusBadRequest); bad["field"] != "results.rates[0].first_pass" {
		t.Fatalf("a rate that is not accepted/attempts = %v", bad)
	}
	saved = e.json(http.MethodPatch, "/v1/worksheets/"+id, rates(saved["updated_at"], "1/3"), http.StatusOK)

	// A fourth attempt is not refused for the rate it makes out of date…
	saved = cases(saved["updated_at"],
		attempt(worksheet.VersionCurrent, worksheet.AttemptPass, worksheet.FinalAccepted),
		attempt(worksheet.VersionCurrent, worksheet.AttemptFail, worksheet.FinalAccepted),
		attempt(worksheet.VersionCurrent, worksheet.AttemptTimeout, worksheet.FinalTimeout),
		attempt(worksheet.VersionCurrent, worksheet.AttemptPass, worksheet.FinalAccepted))
	// …but the results cannot be saved again with it.
	e.json(http.MethodPatch, "/v1/worksheets/"+id, rates(saved["updated_at"], "1/3"), http.StatusBadRequest)
	e.json(http.MethodPatch, "/v1/worksheets/"+id, rates(saved["updated_at"], "2/4"), http.StatusOK)
}

func TestAConsistencyPlanOnAnotherUsersStateIsNotFound(t *testing.T) {
	e := newE2E(t)
	alice := e.user
	bob := testutil.NewUser(t, e.pool)
	e.user = bob
	bobs := mapAt(e.json(http.MethodPost, "/v1/learning/states", map[string]string{
		"goal": "Bob's goal", "real_scenario": "Bob's work", "outcome_12w": "Bob's outcome",
		"first_task": "Bob's next task",
	}, http.StatusCreated), "state")["id"].(string)
	e.user = alice

	// The new-worksheet page reads the state for its prefill, then creates
	// the plan on it: both answer as if the state did not exist.
	foreign := e.do(http.MethodGet, "/v1/learning/states/"+bobs, nil)
	foreign.Body.Close()
	missing := e.do(http.MethodGet, "/v1/learning/states/"+uuid.NewString(), nil)
	missing.Body.Close()
	if foreign.StatusCode != http.StatusNotFound || missing.StatusCode != http.StatusNotFound {
		t.Fatalf("reading another user's state: %d (a missing one: %d)", foreign.StatusCode, missing.StatusCode)
	}
	if got := e.status(http.MethodPost, "/v1/worksheets", map[string]any{
		"kind": worksheet.ConsistencyPlanKind, "title": "Plan", "state_id": bobs}); got != http.StatusNotFound {
		t.Fatalf("a consistency plan on another user's state: %d", got)
	}
}
