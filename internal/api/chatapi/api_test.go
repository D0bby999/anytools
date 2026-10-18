package chatapi_test

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Every chat route must be declared in api.RegisteredPatterns(), which is what
// the authentication structural test walks. A route that exists but is not
// declared is the one that ships unreviewed.
func TestEveryChatRouteIsDeclaredForTheAuthenticationTest(t *testing.T) {
	declared := map[string]bool{}
	for _, p := range api.RegisteredPatterns() {
		declared[p] = true
	}
	for _, p := range chatapiPatterns() {
		if !declared[p] {
			t.Errorf("%s is not in api.RegisteredPatterns()", p)
		}
	}
}

// A session naming a knowledge base the user does not own is refused, with the
// same 404 a nonexistent one gets.
func TestCreatingASessionWithAForeignKBIsRefused(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, groundedScript())

	stranger := uuid.New()
	h.authz.kbs[stranger] = uuid.New() // owned by somebody else

	foreign := h.do(t, p, http.MethodPost, "/v1/chat/sessions",
		map[string]any{"title": "x", "kb_ids": []string{stranger.String()}})
	defer foreign.Body.Close()
	if foreign.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(foreign.Body)
		t.Fatalf("foreign kb accepted: %d %s", foreign.StatusCode, body)
	}

	missing := h.do(t, p, http.MethodPost, "/v1/chat/sessions",
		map[string]any{"title": "x", "kb_ids": []string{uuid.NewString()}})
	defer missing.Body.Close()
	if missing.StatusCode != foreign.StatusCode {
		t.Fatalf("missing kb answered %d and foreign kb %d — the status code is an existence oracle",
			missing.StatusCode, foreign.StatusCode)
	}
}

// Sessions CRUD, end to end.
func TestSessionCRUD(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, groundedScript())

	sessionID := h.createSession(t, p)

	list := decode[map[string]any](t,
		h.do(t, p, http.MethodGet, "/v1/chat/sessions", nil), http.StatusOK)
	if len(list["sessions"].([]any)) == 0 {
		t.Fatal("the new session is not in the list")
	}

	renamed := decode[map[string]any](t,
		h.do(t, p, http.MethodPatch, "/v1/chat/sessions/"+sessionID,
			map[string]any{"title": "Renamed"}), http.StatusOK)
	if renamed["title"] != "Renamed" {
		t.Fatalf("rename = %+v", renamed)
	}
	if renamed["allow_web"] != false {
		t.Fatal("a rename changed allow_web")
	}

	toggled := decode[map[string]any](t,
		h.do(t, p, http.MethodPatch, "/v1/chat/sessions/"+sessionID,
			map[string]any{"allow_web": true}), http.StatusOK)
	if toggled["allow_web"] != true || toggled["title"] != "Renamed" {
		t.Fatalf("toggle = %+v", toggled)
	}

	res := h.do(t, p, http.MethodDelete, "/v1/chat/sessions/"+sessionID, nil)
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", res.StatusCode)
	}

	gone := h.do(t, p, http.MethodGet, "/v1/chat/sessions/"+sessionID, nil)
	gone.Body.Close()
	if gone.StatusCode != http.StatusNotFound {
		t.Fatalf("a deleted session answered %d", gone.StatusCode)
	}
}

// A malformed id answers 404, never 400: telling a caller their guess was
// well-formed is telling them something.
func TestMalformedIDsAnswerNotFound(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, groundedScript())

	for _, path := range []string{
		"/v1/chat/sessions/not-a-uuid",
		"/v1/chat/sessions/not-a-uuid/messages",
		"/v1/turns/not-a-uuid/events",
	} {
		res := h.do(t, p, http.MethodGet, path, nil)
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", path, res.StatusCode)
		}
	}
}

// An empty message is refused before a turn row exists: a turn with nothing to
// answer costs a provider call and produces an empty transcript entry.
func TestEmptyMessageIsRefused(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, groundedScript())
	sessionID := h.createSession(t, p)

	res := h.do(t, p, http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
		map[string]any{"message": "   "})
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty message = %d, want 400", res.StatusCode)
	}
}

// ask_user over HTTP: the turn parks, the answer endpoint resumes it, and the
// answer joins the transcript.
func TestAskUserRoundTripThroughTheAPI(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, &scriptedProvider{responses: []*runtime.ChatResponse{
		{
			FinishReason: "tool_calls",
			ToolCalls: []runtime.ToolCall{{
				ID: "call-1", Name: "ask_user",
				Arguments: map[string]any{
					"question": "Which chapter did you mean?",
					"options":  []any{"Chapter 3", "Chapter 4"},
				},
			}},
		},
		{Content: "Chapter 4 covers that.", FinishReason: "stop"},
	}})

	sessionID := h.createSession(t, p)
	turnID := h.createTurn(t, p, sessionID, "Where is that explained?")

	waitUntil(t, func() bool {
		turn, err := p.turns.GetTurn(context.Background(), h.userID, uuid.MustParse(turnID))
		return err == nil && turn.Status == runtime.StatusWaitingUser
	})

	// A cancel-style answer to the wrong turn is refused, and an empty one too.
	empty := h.do(t, p, http.MethodPost, "/v1/turns/"+turnID+"/answer", map[string]any{"answer": " "})
	empty.Body.Close()
	if empty.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty answer = %d, want 400", empty.StatusCode)
	}

	accepted := h.do(t, p, http.MethodPost, "/v1/turns/"+turnID+"/answer",
		map[string]any{"answer": "Chapter 4"})
	accepted.Body.Close()
	if accepted.StatusCode != http.StatusAccepted {
		t.Fatalf("answer = %d, want 202", accepted.StatusCode)
	}

	if got := p.await(t); got != runtime.StatusDone {
		t.Fatalf("turn finished %q after the answer, want done", got)
	}

	frames := h.readStream(t, p, turnID, 0, "", 0)
	var waited bool
	for _, f := range frames {
		if f.Data.Type == runtime.EvWaitForInput {
			waited = true
			if f.Data.Content != "Which chapter did you mean?" {
				t.Errorf("wait_for_input carried %q", f.Data.Content)
			}
			opts, _ := f.Data.Metadata["options"].([]any)
			if len(opts) != 2 {
				t.Errorf("wait_for_input options = %+v", f.Data.Metadata["options"])
			}
			// The id the client echoes back with its answer.
			if qid, _ := f.Data.Metadata["question_id"].(string); qid == "" {
				t.Errorf("wait_for_input carried no question_id: %+v", f.Data.Metadata)
			}
		}
	}
	if !waited {
		t.Fatal("no wait_for_input frame reached the client")
	}

	// The user's choice is in the transcript: a reader tomorrow must see it.
	msgs := decode[map[string]any](t,
		h.do(t, p, http.MethodGet, "/v1/chat/sessions/"+sessionID+"/messages", nil), http.StatusOK)
	var sawAnswer bool
	for _, m := range msgs["messages"].([]any) {
		if m.(map[string]any)["content"] == "Chapter 4" {
			sawAnswer = true
		}
	}
	if !sawAnswer {
		t.Fatal("the user's answer is not in the transcript")
	}
}

// An answer carrying a question id that does not match the open question is
// taken by the channel but discarded by the turn, which keeps waiting. The
// server cannot refuse it at the HTTP layer — the handler does not know which
// question is open — so the test asserts what the USER sees: the turn does not
// resume on the wrong answer.
func TestAnAnswerForAWrongQuestionIDDoesNotResumeTheTurn(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, &scriptedProvider{responses: []*runtime.ChatResponse{
		{
			FinishReason: "tool_calls",
			ToolCalls: []runtime.ToolCall{{
				ID: "call-1", Name: "ask_user",
				Arguments: map[string]any{"question": "Which chapter?"},
			}},
		},
		{Content: "Chapter 4 covers that.", FinishReason: "stop"},
	}})

	sessionID := h.createSession(t, p)
	turnID := h.createTurn(t, p, sessionID, "Where is that explained?")

	waitUntil(t, func() bool {
		turn, err := p.turns.GetTurn(context.Background(), h.userID, uuid.MustParse(turnID))
		return err == nil && turn.Status == runtime.StatusWaitingUser
	})

	// An answer addressed to a question that is not the open one.
	stale := h.do(t, p, http.MethodPost, "/v1/turns/"+turnID+"/answer",
		map[string]any{"answer": "Chapter 3", "question_id": uuid.NewString()})
	stale.Body.Close()

	// The turn must still be waiting: the stale answer did not resume it.
	waitUntil(t, func() bool {
		turn, err := p.turns.GetTurn(context.Background(), h.userID, uuid.MustParse(turnID))
		return err == nil && turn.Status == runtime.StatusWaitingUser
	})

	// The real answer, with no id, still works.
	accepted := h.do(t, p, http.MethodPost, "/v1/turns/"+turnID+"/answer",
		map[string]any{"answer": "Chapter 4"})
	accepted.Body.Close()
	if accepted.StatusCode != http.StatusAccepted {
		t.Fatalf("the real answer was refused: %d", accepted.StatusCode)
	}
	if got := p.await(t); got != runtime.StatusDone {
		t.Fatalf("turn finished %q", got)
	}
}

// Answering a turn that is not waiting is a conflict, not a silent success.
func TestAnsweringATurnThatIsNotWaitingIsAConflict(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, groundedScript())

	sessionID := h.createSession(t, p)
	turnID := h.createTurn(t, p, sessionID, "How does hybrid retrieval work?")
	p.await(t)

	res := h.do(t, p, http.MethodPost, "/v1/turns/"+turnID+"/answer", map[string]any{"answer": "x"})
	defer res.Body.Close()
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("answering a finished turn = %d, want 409", res.StatusCode)
	}
}

// Cancel: the row says cancelled, and the stream's terminal frame says so too.
func TestCancelStopsTheTurnAndSaysCancelledNotFailed(t *testing.T) {
	h := newHarness(t)
	script := groundedScript()
	release := make(chan struct{})
	script.hold = map[int]chan struct{}{0: release}
	p := h.start(t, script)

	sessionID := h.createSession(t, p)
	turnID := h.createTurn(t, p, sessionID, "How does hybrid retrieval work?")

	waitUntil(t, func() bool {
		turn, err := p.turns.GetTurn(context.Background(), h.userID, uuid.MustParse(turnID))
		return err == nil && turn.Status == runtime.StatusRunning
	})

	out := decode[map[string]any](t,
		h.do(t, p, http.MethodPost, "/v1/turns/"+turnID+"/cancel", nil), http.StatusOK)
	if out["status"] != runtime.StatusCancelled {
		t.Fatalf("cancel returned %+v", out)
	}
	close(release)

	if got := p.await(t); got != runtime.StatusCancelled && got != runtime.StatusFailed {
		// The capability may notice the cancelled context and return either
		// way; what must NOT happen is `done`.
		t.Fatalf("turn finished %q after a cancel", got)
	}

	final, err := p.turns.GetTurn(context.Background(), h.userID, uuid.MustParse(turnID))
	if err != nil {
		t.Fatalf("GetTurn: %v", err)
	}
	if final.Status != runtime.StatusCancelled {
		t.Fatalf("a cancelled turn ended as %q; the user pressed stop, nothing crashed", final.Status)
	}
}

// Cancelling a finished turn is a no-op that reports the truth.
func TestCancellingAFinishedTurnReportsItsRealStatus(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, groundedScript())

	sessionID := h.createSession(t, p)
	turnID := h.createTurn(t, p, sessionID, "How does hybrid retrieval work?")
	p.await(t)

	out := decode[map[string]any](t,
		h.do(t, p, http.MethodPost, "/v1/turns/"+turnID+"/cancel", nil), http.StatusOK)
	if out["status"] != runtime.StatusDone {
		t.Fatalf("cancelling a done turn reported %+v", out)
	}
}

// Isolation: another user cannot read the turn, its stream, or the session,
// and cannot cancel or answer it. This is the shape AC6's generated probes
// will take for every route with a resource id.
func TestAnotherUserCannotReachThisTurnOrSession(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, groundedScript())

	sessionID := h.createSession(t, p)
	turnID := h.createTurn(t, p, sessionID, "How does hybrid retrieval work?")
	p.await(t)

	stranger := uuid.New()
	for _, tc := range []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, "/v1/chat/sessions/" + sessionID, nil},
		{http.MethodGet, "/v1/chat/sessions/" + sessionID + "/messages", nil},
		{http.MethodPatch, "/v1/chat/sessions/" + sessionID, map[string]any{"title": "stolen"}},
		{http.MethodDelete, "/v1/chat/sessions/" + sessionID, nil},
		{http.MethodPost, "/v1/chat/sessions/" + sessionID + "/turns", map[string]any{"message": "hi"}},
		{http.MethodGet, "/v1/turns/" + turnID + "/events", nil},
		{http.MethodPost, "/v1/turns/" + turnID + "/cancel", nil},
		{http.MethodPost, "/v1/turns/" + turnID + "/answer", map[string]any{"answer": "x"}},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			// The stranger is not a live user, so RequireUser refuses first —
			// which is the outer layer. The inner layer is asserted below with
			// a live second user.
			res := h.doAs(t, p, stranger, tc.method, tc.path, tc.body)
			res.Body.Close()
			if res.StatusCode == http.StatusOK || res.StatusCode == http.StatusAccepted ||
				res.StatusCode == http.StatusNoContent || res.StatusCode == http.StatusCreated {
				t.Fatalf("a stranger got %d", res.StatusCode)
			}
		})
	}
}

// The same, but with a SECOND LIVE USER, so the refusal comes from the store's
// user_id filter rather than from the authentication middleware.
func TestASecondLiveUserGetsNotFoundRatherThanData(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, groundedScript())
	sessionID := h.createSession(t, p)

	// Point the mux's user lookup at a second live user and re-issue as them.
	second := newHarness(t)
	second.pool = h.pool
	p2 := second.start(t, groundedScript())

	// A turn to aim the turn routes at.
	turnID := h.createTurn(t, p, sessionID, "How does hybrid retrieval work?")
	p.await(t)

	// Every route with a resource id, as a SECOND LIVE USER. The earlier test
	// uses a non-live id, where RequireUser refuses first and the store's own
	// user_id filter is never reached — so it would pass even if GetTurn or
	// GetSession dropped that filter entirely. This is the one that would not.
	for _, tc := range []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, "/v1/chat/sessions/" + sessionID, nil},
		{http.MethodGet, "/v1/chat/sessions/" + sessionID + "/messages", nil},
		{http.MethodPatch, "/v1/chat/sessions/" + sessionID, map[string]any{"title": "stolen"}},
		{http.MethodDelete, "/v1/chat/sessions/" + sessionID, nil},
		{http.MethodPost, "/v1/chat/sessions/" + sessionID + "/turns", map[string]any{"message": "hi"}},
		{http.MethodGet, "/v1/turns/" + turnID + "/events", nil},
		{http.MethodPost, "/v1/turns/" + turnID + "/cancel", nil},
		{http.MethodPost, "/v1/turns/" + turnID + "/answer", map[string]any{"answer": "x"}},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			res := second.do(t, p2, tc.method, tc.path, tc.body)
			defer res.Body.Close()
			if res.StatusCode != http.StatusNotFound {
				body, _ := io.ReadAll(res.Body)
				t.Fatalf("a second live user got %d on another user's resource: %s",
					res.StatusCode, body)
			}
		})
	}

	// And the owner's own session is still reachable, so the block above is not
	// passing because everything 404s.
	owner := h.do(t, p, http.MethodGet, "/v1/chat/sessions/"+sessionID, nil)
	owner.Body.Close()
	if owner.StatusCode != http.StatusOK {
		t.Fatalf("the owner lost access: %d", owner.StatusCode)
	}

	list := decode[map[string]any](t,
		second.do(t, p2, http.MethodGet, "/v1/chat/sessions", nil), http.StatusOK)
	for _, s := range list["sessions"].([]any) {
		if s.(map[string]any)["id"] == sessionID {
			t.Fatal("another user's session appeared in the list")
		}
	}
}

// One turn at a time per session. Without this a double-click starts a second
// provider call on the user's own key, streaming into the same conversation as
// the first.
func TestASecondTurnIsRefusedWhileOneIsInFlight(t *testing.T) {
	h := newHarness(t)
	script := groundedScript()
	release := make(chan struct{})
	script.hold = map[int]chan struct{}{0: release}
	p := h.start(t, script)

	sessionID := h.createSession(t, p)
	turnID := h.createTurn(t, p, sessionID, "How does hybrid retrieval work?")

	waitUntil(t, func() bool {
		turn, err := p.turns.GetTurn(context.Background(), h.userID, uuid.MustParse(turnID))
		return err == nil && turn.Status == runtime.StatusRunning
	})

	second := h.do(t, p, http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
		map[string]any{"message": "and again"})
	defer second.Body.Close()
	if second.StatusCode != http.StatusConflict {
		t.Fatalf("a second concurrent turn was accepted: %d", second.StatusCode)
	}

	close(release)
	p.await(t)

	// Once it is done, the next question is fine.
	third := h.do(t, p, http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
		map[string]any{"message": "now?"})
	defer third.Body.Close()
	if third.StatusCode != http.StatusAccepted {
		t.Fatalf("a turn after the first finished was refused: %d", third.StatusCode)
	}
}

// Deleting a session must stop whatever it is running. Otherwise the goroutine
// keeps calling the provider against rows the cascade has already removed, and
// every write it makes fails on a foreign key, logged and otherwise invisible.
func TestDeletingASessionStopsItsRunningTurn(t *testing.T) {
	h := newHarness(t)
	script := groundedScript()
	release := make(chan struct{})
	script.hold = map[int]chan struct{}{0: release}
	p := h.start(t, script)

	sessionID := h.createSession(t, p)
	turnID := h.createTurn(t, p, sessionID, "How does hybrid retrieval work?")

	waitUntil(t, func() bool {
		turn, err := p.turns.GetTurn(context.Background(), h.userID, uuid.MustParse(turnID))
		return err == nil && turn.Status == runtime.StatusRunning
	})

	res := h.do(t, p, http.MethodDelete, "/v1/chat/sessions/"+sessionID, nil)
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", res.StatusCode)
	}

	close(release)

	// The turn's goroutine notices its cancelled context and stops, rather than
	// running to completion against a session that no longer exists.
	waitUntil(t, func() bool {
		_, live := p.orch.Buses().Get(uuid.MustParse(turnID))
		return !live
	})
}

// Cancelling a QUEUED turn must not surface an internal message. The handler
// writes `cancelled` first, so the goroutine's claim then loses its guard —
// which used to be reported to the user as "turn <uuid> is not queued".
func TestCancellingBeforeTheTurnStartsReportsCancelled(t *testing.T) {
	h := newHarness(t)
	// The first model round is held, so the turn cannot FINISH before the
	// cancel lands. Without the hold the scripted answer usually completed
	// first and the turn ended `done` (4 of 5 runs in isolation) — a race in
	// the test, not the product. The cancel still arrives either while the
	// turn is queued (the path this test exists for) or while it waits on the
	// model; both must end `cancelled` with no internal message.
	script := groundedScript()
	release := make(chan struct{})
	script.hold = map[int]chan struct{}{0: release}
	p := h.start(t, script)
	sessionID := h.createSession(t, p)

	turnID := h.createTurn(t, p, sessionID, "How does hybrid retrieval work?")
	h.do(t, p, http.MethodPost, "/v1/turns/"+turnID+"/cancel", nil).Body.Close()
	close(release)
	p.await(t)

	final, err := p.turns.GetTurn(context.Background(), h.userID, uuid.MustParse(turnID))
	if err != nil {
		t.Fatalf("GetTurn: %v", err)
	}
	if final.Status != runtime.StatusCancelled {
		t.Fatalf("status = %q, want cancelled", final.Status)
	}

	for _, f := range h.readStream(t, p, turnID, 0, "", 0) {
		if f.Data.Type == runtime.EvError {
			if strings.Contains(f.Data.Content, "not queued") {
				t.Fatalf("an internal message reached the user: %q", f.Data.Content)
			}
			if f.Data.Metadata["status"] != runtime.StatusCancelled {
				t.Fatalf("terminal frame says %+v, want cancelled", f.Data.Metadata)
			}
		}
	}
}

// chatapiPatterns mirrors chatapi.Patterns() without importing it into the
// assertion, so a change to one has to be reflected in the other.
func chatapiPatterns() []string {
	return []string{
		"POST /v1/chat/sessions",
		"GET /v1/chat/sessions",
		"GET /v1/chat/sessions/{id}",
		"PATCH /v1/chat/sessions/{id}",
		"DELETE /v1/chat/sessions/{id}",
		"GET /v1/chat/sessions/{id}/messages",
		"POST /v1/chat/sessions/{id}/turns",
		"GET /v1/turns/{id}/events",
		"POST /v1/turns/{id}/cancel",
		"POST /v1/turns/{id}/answer",
	}
}

// doAs issues a request as an arbitrary user id.
func (h *harness) doAs(t *testing.T, p *process, userID uuid.UUID, method, path string, body any) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		reader = strings.NewReader(mustJSON(t, body))
	}
	req, err := http.NewRequest(method, p.server.URL+path, reader)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+testGatewayToken)
	req.Header.Set("X-AnyTools-User-Id", userID.String())
	req.Header.Set("Content-Type", "application/json")

	res, err := p.server.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return res
}
