package app

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// recordingModel is an OpenAI-compatible upstream that keeps every request
// body it is sent and answers each with one short streamed sentence.
type recordingModel struct {
	server *httptest.Server
	mu     sync.Mutex
	bodies []string
}

func newRecordingModel(t *testing.T) *recordingModel {
	t.Helper()
	m := &recordingModel{}
	m.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		m.mu.Lock()
		m.bodies = append(m.bodies, string(raw))
		m.mu.Unlock()
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		writeSSE(w, flusher, map[string]any{
			"choices": []any{map[string]any{"delta": map[string]any{"content": "Noted."}}},
		})
		writeSSE(w, flusher, map[string]any{
			"choices": []any{map[string]any{"delta": map[string]any{}, "finish_reason": "stop"}},
			"usage":   map[string]any{"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
		})
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	t.Cleanup(m.server.Close)
	return m
}

func (m *recordingModel) sent() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return strings.Join(m.bodies, "\n")
}

// TestAskForHelpNeverReachesTheModel is AC3's marker test for the minimum
// contract (phase 13): a state-linked chat turn, through the real BYOK chain,
// sends the contract's first two answers to the learner's model and never the
// third.
func TestAskForHelpNeverReachesTheModel(t *testing.T) {
	model := newRecordingModel(t)
	e := buildE2E(t, model.server.URL, []string{"chat"}, nil)

	started := e.json(http.MethodPost, "/v1/learning/states", map[string]string{
		"goal": "Read Vietnamese news", "real_scenario": "s", "outcome_12w": "o", "first_task": "Ten words",
	}, http.StatusCreated)
	stateID := mapAt(started, "state")["id"].(string)
	e.json(http.MethodPatch, "/v1/learning/states/"+stateID, map[string]any{
		"minimum_contract": map[string]string{
			"downshift_when":      "DOWNSHIFT-MARKER-c41e",
			"still_worth_keeping": "KEEPING-MARKER-c41e",
			"ask_for_help_when":   "HELP-MARKER-c41e",
		},
	}, http.StatusOK)

	sessionID := e.json(http.MethodPost, "/v1/learning/states/"+stateID+"/resume", nil, http.StatusCreated)["session_id"].(string)
	turn := e.json(http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
		map[string]any{"message": "Where were we?"}, http.StatusAccepted)
	for _, f := range e.readTurnStream(turn["turn_id"].(string)) {
		if f.event == "stream_error" {
			t.Fatalf("the turn failed: %v", f.data["content"])
		}
	}

	sent := model.sent()
	if !strings.Contains(sent, "KEEPING-MARKER-c41e") || !strings.Contains(sent, "DOWNSHIFT-MARKER-c41e") {
		t.Fatal("the shared answers did not reach the model; the test is not exercising the resume path")
	}
	if strings.Contains(sent, "HELP-MARKER") {
		t.Fatal("ask_for_help_when reached the learner's model")
	}
}
