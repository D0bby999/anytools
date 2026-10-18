package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/learning/ownversion"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// "Write your own version first" (up-methods phase 11) through the real app:
// with the learner's switch on (users.own_version_first; the PUT route is
// tested in internal/api/authapi), Solve refuses a problem without the three lines while it is on,
// and the lines reach the learner's own model under their heading through
// the real BYOK chain (a scripted OpenAI-compatible upstream).
func TestSolveRequiresTheOwnVersionWhenSwitchedOn(t *testing.T) {
	e, model, _ := newPhase9E2E(t, newScriptedWeb(t, false))

	users := pg.NewUserStore(e.pool)
	if err := users.SetOwnVersionFirst(context.Background(), e.user, true); err != nil {
		t.Fatal(err)
	}

	problem := map[string]any{"problem": "Solve 2x + 3 = 11 for x."}
	res := e.do(http.MethodPost, "/v1/solve", problem)
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	var refusal map[string]any
	_ = json.Unmarshal(body, &refusal)
	if res.StatusCode != http.StatusBadRequest || refusal["code"] != "own_version_required" {
		t.Fatalf("solve without the lines = %d %s", res.StatusCode, body)
	}
	if n := e.scalar(`SELECT count(*) FROM chat_messages WHERE user_id = $1`, e.user); n != 0 {
		t.Fatalf("a refused solve stored %d messages", n)
	}

	withLines := map[string]any{"problem": "Solve 2x + 3 = 11 for x.", "own_version": map[string]any{
		"understanding": "UNDERSTAND-MARK", "uncertain": "UNSURE-MARK", "proof": "PROOF-MARK"}}
	started := e.json(http.MethodPost, "/v1/solve", withLines, http.StatusAccepted)
	frames := e.readTurnStream(started["turn_id"].(string))
	if _, meta := resultOf(t, frames); meta["message_id"] == nil {
		t.Fatal("the solve did not finish")
	}

	sawLines := false
	for _, b := range model.requests() {
		head := strings.Index(b, "The learner's own attempt, written before asking")
		if head >= 0 && strings.Index(b, "UNDERSTAND-MARK") > head &&
			strings.Index(b, "UNSURE-MARK") > head && strings.Index(b, "PROOF-MARK") > head {
			sawLines = true
		}
	}
	if !sawLines {
		t.Fatal("no model request carried the three lines under their heading")
	}

	var raw []byte
	if err := e.pool.QueryRow(context.Background(), `SELECT attachments FROM chat_messages
		WHERE session_id = $1 AND role = 'user'`, started["session_id"]).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if got := ownversion.FromAttachments(raw); got == nil || got.Proof != "PROOF-MARK" {
		t.Fatalf("the question's attachments lack the lines: %s", raw)
	}

	// Off again: the lines are optional.
	if err := users.SetOwnVersionFirst(context.Background(), e.user, false); err != nil {
		t.Fatal(err)
	}
	started = e.json(http.MethodPost, "/v1/solve", problem, http.StatusAccepted)
	e.readTurnStream(started["turn_id"].(string))
}
