package app

// mastery_review_e2e_test.go — up-methods phase 12 (AC10), end to end.
//
// Two paths, three modules: the cross-path review never serves the same
// module twice in a row while another has something due, switches paths when
// it can, keeps doing so across a reload (the previous point is read from the
// last attempt, not the client), and serves a stranger only their own points
// whatever `after` they send. The model is the scripted upstream of
// quiz_mastery_e2e_test.go, reached through the real BYOK chain.

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/mastery"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// reviewPath creates and approves a path whose modules hold the named points.
func reviewPath(e *e2e, kbID uuid.UUID, goal string, modules map[string][]string) string {
	e.t.Helper()
	created := e.json(http.MethodPost, "/v1/mastery/paths",
		map[string]any{"kb_id": kbID, "goal": goal}, http.StatusCreated)
	pathID := mapAt(created, "path")["id"].(string)
	approved := []any{}
	for name, points := range modules {
		kps := []any{}
		for _, p := range points {
			kps = append(kps, map[string]string{"name": p, "type": "concept"})
		}
		approved = append(approved, map[string]any{"name": name, "objective": "o", "pass_threshold": 0.7,
			"knowledge_points": kps})
	}
	e.json(http.MethodPost, "/v1/mastery/paths/"+pathID+"/approve", map[string]any{"modules": approved}, http.StatusCreated)
	return pathID
}

// rightAnswer is the scripted generator's answer for each question type.
func rightAnswer(qType string) string {
	switch qType {
	case "mcq":
		return "B"
	case "tf":
		return "true"
	case "cloze":
		return "weights"
	}
	return "Knowledge stored in the model's weights."
}

func TestCrossPathReviewInterleavesModulesAndPathsThroughTheAPI(t *testing.T) {
	e, model, clock, kbID := newQuizE2E(t)

	pathA := reviewPath(e, kbID, "Path A", map[string][]string{
		"A1": {"Parametric memory", "Retrieved passages"},
		"A2": {"Search index"},
	})
	clock.Advance(time.Second) // path B's points come due after path A's
	pathB := reviewPath(e, kbID, "Path B", map[string][]string{"B1": {"Prompt template"}})

	type seen struct{ point, module, path string }
	var prev *seen
	answered := 0
	waitingSeen := false
	for step := 0; step < 12 && answered < 4; step++ {
		// What is due before this step, by module and by path.
		modules, paths := map[string]bool{}, map[string]bool{}
		for _, raw := range e.json(http.MethodGet, "/v1/mastery/due", nil, http.StatusOK)["due"].([]any) {
			d := raw.(map[string]any)
			modules[d["module_id"].(string)], paths[d["path_id"].(string)] = true, true
		}

		next := e.json(http.MethodGet, "/v1/mastery/review/next", nil, http.StatusOK)
		kp := mapAt(next, "knowledge_point")
		cur := seen{point: kp["id"].(string), module: kp["module_id"].(string), path: next["path_id"].(string)}
		if next["path_goal"] != "Path A" && next["path_goal"] != "Path B" {
			t.Fatalf("step %d: path_goal %v", step, next["path_goal"])
		}
		if next["kind"] == "explain_back" {
			t.Fatalf("step %d: the review asked for an explain-back", step)
		}
		if next["explain_back_waiting"] == true {
			waitingSeen = true
		}

		if next["kind"] == "learn" {
			// Teaching changes nothing about the order: the same point comes
			// back, now as its question.
			again := e.json(http.MethodGet, "/v1/mastery/review/next", nil, http.StatusOK)
			if mapAt(again, "knowledge_point")["id"] != cur.point || again["kind"] != "question" {
				t.Fatalf("step %d: after a learn card got %v %v", step, again["kind"], mapAt(again, "knowledge_point")["name"])
			}
			next = again
		}

		if prev != nil {
			if cur.module == prev.module {
				delete(modules, prev.module)
				if len(modules) > 0 {
					t.Fatalf("step %d: same module twice while another was due", step)
				}
			}
			if cur.path == prev.path {
				delete(paths, prev.path)
				if len(paths) > 0 {
					t.Fatalf("step %d: same path twice while another was due", step)
				}
			}
		}

		question := next["question"].(map[string]any)
		e.json(http.MethodPost, fmt.Sprintf("/v1/questions/%s/attempt", question["id"]),
			map[string]any{"user_answer": rightAnswer(question["type"].(string))}, http.StatusCreated)
		answered++
		prev = &cur

		// A reload, with no `after`: the alternation holds, and it is the same
		// item both times.
		if remaining := next["remaining_due"].(float64); remaining > 0 {
			r1 := e.json(http.MethodGet, "/v1/mastery/review/next", nil, http.StatusOK)
			r2 := e.json(http.MethodGet, "/v1/mastery/review/next", nil, http.StatusOK)
			id1, id2 := mapAt(r1, "knowledge_point")["id"], mapAt(r2, "knowledge_point")["id"]
			if id1 != id2 {
				t.Fatalf("step %d: two reloads served %v and %v", step, id1, id2)
			}
			if mapAt(r1, "knowledge_point")["module_id"] == cur.module && len(modules) > 1 {
				t.Fatalf("step %d: a reload served the module just answered", step)
			}
		}
	}
	if answered != 4 {
		t.Fatalf("answered %d of 4 points", answered)
	}
	if got := e.status(http.MethodGet, "/v1/mastery/review/next", nil); got != http.StatusConflict {
		t.Fatalf("with nothing due: status %d, want 409 nothing_due", got)
	}
	// Concept points answered right wait for their explain-back, which stays
	// on the path's own session.
	if !waitingSeen {
		t.Error("the review never said an explain-back was waiting")
	}
	if n := model.count("explain_back"); n != 0 {
		t.Errorf("the review judged %d explain-backs", n)
	}
	own := e.json(http.MethodGet, "/v1/mastery/paths/"+pathA+"/next", nil, http.StatusOK)
	if own["kind"] != "explain_back" {
		t.Errorf("path A's own session = %v, want its waiting explain-back", own["kind"])
	}

	// ── a stranger ─────────────────────────────────────────────────────────
	// Every one of the learner's points comes due again, and before the
	// stranger's: a candidate query that read across users would rank the
	// learner's first.
	clock.Advance(400 * 24 * time.Hour)
	ctx := context.Background()

	// Someone with nothing of their own is told so, whatever is due for
	// others, and whatever they name.
	empty := e.as(testutil.NewUser(t, e.pool))
	for _, path := range []string{"/v1/mastery/review/next", "/v1/mastery/review/next?after=" + prev.point} {
		res := empty.do(http.MethodGet, path, nil)
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != http.StatusConflict || !strings.Contains(string(body), "nothing_due") {
			t.Fatalf("%s for a user with nothing: %d %s", path, res.StatusCode, body)
		}
	}

	// The stranger's own point is taught and has a banked question, so
	// serving it needs no model route of theirs.
	stranger := testutil.NewUser(t, e.pool)
	masteries := pg.NewMasteryStore(e.pool)
	var strangerKB uuid.UUID
	if err := e.pool.QueryRow(ctx, `INSERT INTO knowledge_bases (user_id, name) VALUES ($1, 'Theirs') RETURNING id`,
		stranger).Scan(&strangerKB); err != nil {
		t.Fatal(err)
	}
	sp, err := masteries.CreatePath(ctx, mastery.Path{UserID: stranger, KBID: strangerKB, Goal: "Theirs", Status: mastery.StatusActive})
	if err != nil {
		t.Fatal(err)
	}
	planned, err := masteries.ApproveModules(ctx, stranger, sp.ID, []mastery.ProposedModule{{
		Name: "S1", PassThreshold: 0.7, KnowledgePoints: []mastery.ProposedKP{{Name: "Theirs", Type: "memory"}},
	}}, clock.Now())
	if err != nil {
		t.Fatal(err)
	}
	theirKP := planned.Modules[0].KnowledgePoints[0].KnowledgePoint.ID
	if _, err := masteries.AppendEvent(ctx, stranger, sp.ID, mastery.EventTeachFailed,
		map[string]any{"knowledge_point_id": theirKP}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `INSERT INTO questions (user_id, kb_id, knowledge_point_id, module_id, prompt, type, answer)
		VALUES ($1, $2, $3, $4, 'q', 'short', 'a')`, stranger, strangerKB, theirKP, planned.Modules[0].Module.ID); err != nil {
		t.Fatal(err)
	}
	clock.Advance(time.Minute)

	as := e.as(stranger)
	plain := as.json(http.MethodGet, "/v1/mastery/review/next", nil, http.StatusOK)
	withForeign := as.json(http.MethodGet, "/v1/mastery/review/next?after="+prev.point, nil, http.StatusOK)
	for _, got := range []map[string]any{plain, withForeign} {
		if mapAt(got, "knowledge_point")["id"] != theirKP.String() || got["path_id"] != sp.ID.String() {
			t.Fatalf("stranger was served %v", got)
		}
	}
	for _, body := range []string{fmt.Sprint(plain), fmt.Sprint(withForeign)} {
		for _, id := range []string{pathA, pathB, prev.point} {
			if strings.Contains(body, id) {
				t.Fatalf("stranger's review names the learner's %s", id)
			}
		}
	}
}
