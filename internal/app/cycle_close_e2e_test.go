package app

// cycle_close_e2e_test.go — up-methods phase 10 over HTTP: a cycle reports
// its day on the learner's calendar; its close is a cycle_close naming it,
// one per cycle; a transfer without its changed condition and a done close
// holding an unfinished stop are 400 naming the row; and the next cycle reads
// the last close's continue and transfer rows, never its stops.

import (
	"context"
	"net/http"
	"testing"
)

func TestTheCycleCloseEndToEnd(t *testing.T) {
	e := buildE2E(t, "http://127.0.0.1:9", nil, nil)
	ctx := context.Background()

	started := e.json(http.MethodPost, "/v1/learning/states", map[string]any{
		"goal": "Explain my work in English", "real_scenario": "Client calls",
		"outcome_12w": "One call unaided", "first_task": "Record a two-minute explanation"}, http.StatusCreated)
	stateID, cycleID := mapAt(started, "state")["id"].(string), mapAt(started, "cycle")["id"].(string)

	// Day 84 of the cycle, on the learner's (UTC) calendar.
	if _, err := e.pool.Exec(ctx, `UPDATE cycles SET started_at = now() - interval '83 days', phase = 'deliver'
		WHERE id = $1`, cycleID); err != nil {
		t.Fatal(err)
	}
	cycle := e.json(http.MethodGet, "/v1/cycles/"+cycleID, nil, http.StatusOK)
	if cycle["day"] != float64(84) || cycle["close_from_day"] != float64(84) {
		t.Fatalf("day %v, close from %v", cycle["day"], cycle["close_from_day"])
	}
	closes := e.json(http.MethodGet, "/v1/cycles/"+cycleID+"/close", nil, http.StatusOK)
	if closes["close"] != nil || closes["previous"] != nil {
		t.Fatalf("closes before any: %v", closes)
	}

	created := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": "cycle_close", "title": "Close",
		"cycle_id": cycleID}, http.StatusCreated)
	id, rev := created["id"].(string), created["updated_at"].(string)
	if created["state_id"] != stateID || created["cycle_id"] != cycleID {
		t.Fatalf("created %v", created)
	}
	again := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": "cycle_close", "title": "Close",
		"cycle_id": cycleID, "state_id": stateID}, http.StatusConflict)
	if again["code"] != "cycle_closed" {
		t.Fatalf("a second close = %v", again)
	}
	if mapAt(e.json(http.MethodGet, "/v1/cycles/"+cycleID+"/close", nil, http.StatusOK), "close")["id"] != id {
		t.Fatal("the cycle does not read its close")
	}

	row := func(cells map[string]any) map[string]any { return map[string]any{"row": "", "cells": cells} }
	results := func(rows ...any) map[string]any {
		return map[string]any{"destinations": map[string]any{"results": rows}}
	}
	cont := row(map[string]any{"result": "Explaining", "destination": "continue", "next_step": "Explain to a new client"})
	transfer := map[string]any{"result": "Calls", "destination": "transfer", "next_step": "Answer questions I cannot predict"}
	bad := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": rev,
		"answers": results(cont, row(transfer))}, http.StatusBadRequest)
	if bad["field"] != "destinations.results[1].condition" {
		t.Fatalf("a transfer without its condition = %v", bad)
	}
	transfer["condition"] = "unprepared questions"
	stop := map[string]any{"result": "Podcast", "destination": "stop", "basis": "No listeners"}
	saved := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": rev,
		"answers": results(cont, row(transfer), row(stop))}, http.StatusOK)
	bad = e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": saved["updated_at"],
		"status": "done"}, http.StatusBadRequest)
	if bad["field"] != "destinations.results[2]" {
		t.Fatalf("done with an unfinished stop = %v", bad)
	}
	stop["archived"], stop["told"] = "Drive/podcast", "My co-host"
	saved = e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": saved["updated_at"],
		"answers": results(cont, row(transfer), row(stop)), "status": "done"}, http.StatusOK)
	if saved["status"] != "done" {
		t.Fatalf("a finished close: %v", saved)
	}

	// The next cycle, empty, reads the last close's rows.
	next := e.json(http.MethodPost, "/v1/learning/states/"+stateID+"/cycles", map[string]any{}, http.StatusCreated)
	nextID := next["id"].(string)
	closes = e.json(http.MethodGet, "/v1/cycles/"+nextID+"/close", nil, http.StatusOK)
	prev := mapAt(closes, "previous")
	offers, _ := prev["offers"].([]any)
	if prev["id"] != id || closes["close"] != nil || len(offers) != 2 {
		t.Fatalf("the next cycle's closes = %v", closes)
	}
	for i, want := range []string{"Explain to a new client", "Answer questions I cannot predict"} {
		if got := offers[i].(map[string]any)["next_step"]; got != want {
			t.Errorf("offer %d = %v, want %q", i, got, want)
		}
	}
}
