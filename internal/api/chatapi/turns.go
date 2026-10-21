package chatapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/sse"
	"github.com/D0bby999/anytools/internal/capabilities/chat"
	"github.com/D0bby999/anytools/internal/learning/ownversion"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// maxInput caps a chat message. It is well under httpx's 1 MiB body limit and
// is about what a long question with a pasted excerpt looks like.
const maxInput = 32 << 10

type createTurnRequest struct {
	Message    string `json:"message"`
	Capability string `json:"capability"`
	// OwnVersion is the learner's three lines, written before asking
	// (internal/learning/ownversion). Required when their switch is on.
	OwnVersion *ownversion.Lines `json:"own_version"`
	// RewindToID asks again from one of the learner's earlier questions: that
	// question and everything after it are removed first. With no message it
	// is "regenerate", the same question again; with one it is "edit".
	RewindToID string `json:"rewind_to_id"`
	// References are documents the learner pointed at (`@`): each must be
	// theirs and in one of the session's knowledge bases. This turn's searches
	// return only their passages.
	References []string `json:"references"`
	// ConnectionID and Model ask this one turn of another model on the
	// learner's chat route ("Ask again with…"); the conversation keeps its
	// own pick.
	ConnectionID string `json:"connection_id"`
	Model        string `json:"model"`
}

// maxReferences caps the documents one question may point at.
const maxReferences = 8

// createTurn stores the user's message and starts a turn.
//
// It returns as soon as the turn row exists. The client's next call is
// GET /v1/turns/{id}/events, and everything the turn produces arrives there —
// including its failure, so there is no error path the client can miss by not
// reading the stream.
func (h *Handler) createTurn(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	sessionID, ok := pathID(w, r, "id")
	if !ok {
		return
	}

	var req createTurnRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}
	// Control characters and direction overrides go before anything else
	// reads the message (chat's input guard).
	message := strings.TrimSpace(chat.CleanInput(req.Message))
	rewindID := uuid.Nil
	if req.RewindToID != "" {
		id, err := uuid.Parse(req.RewindToID)
		if err != nil {
			notFound(w)
			return
		}
		rewindID = id
	}
	if message == "" && rewindID == uuid.Nil {
		httpx.WriteError(w, http.StatusBadRequest, "a message is required", "empty_message")
		return
	}
	if len(message) > maxInput {
		httpx.WriteError(w, http.StatusRequestEntityTooLarge, "that message is too long", "message_too_long")
		return
	}

	capability := strings.TrimSpace(req.Capability)
	if capability == "" {
		capability = "chat"
	}

	sess, err := h.sessions.GetSession(r.Context(), userID, sessionID)
	if err != nil {
		notFound(w)
		return
	}

	// The question being rewound to, read (not yet removed) so that every
	// refusal below happens before anything is deleted.
	sent := req.OwnVersion
	if rewindID != uuid.Nil {
		q, err := h.sessions.GetMessage(r.Context(), userID, rewindID)
		if err != nil || q.SessionID != sess.ID || q.Role != runtime.RoleUser {
			notFound(w)
			return
		}
		if message == "" {
			message = q.Content
		}
		// The learner's own attempt stays with the question unless the edit
		// brought a new one.
		if sent == nil {
			sent = ownversion.FromAttachments(q.Attachments)
		}
	}

	lines, serr := h.CheckOwnVersion(r.Context(), userID, sent)
	if serr != nil {
		httpx.WriteError(w, serr.Status, serr.Message, serr.Code)
		return
	}
	// The lines go in with the message, in the same insert, as an object:
	// nothing later has to turn a stored array into one.
	var attachments []byte
	if lines != nil {
		attachments = ownversion.Attachments(*lines)
	}

	if rewindID != uuid.Nil {
		// Never under a running turn: its answer would land after a question
		// that no longer exists.
		if busy, err := h.sessionIsBusy(r.Context(), userID, sess.ID); err != nil || busy {
			httpx.WriteError(w, http.StatusConflict, "this conversation already has a turn in progress", "turn_in_progress")
			return
		}
		if _, err := h.sessions.RewindTo(r.Context(), userID, sess.ID, rewindID); err != nil {
			if errors.Is(err, pg.ErrNotAQuestion) {
				notFound(w)
				return
			}
			httpx.WriteError(w, http.StatusInternalServerError, "could not rewind the conversation", "rewind_failed")
			return
		}
		// The summary may have been cleared with the messages it ended on.
		if fresh, err := h.sessions.GetSession(r.Context(), userID, sess.ID); err == nil {
			sess = fresh
		}
	}

	params, serr := h.references(r.Context(), userID, *sess, req.References)
	if serr != nil {
		httpx.WriteError(w, serr.Status, serr.Message, serr.Code)
		return
	}
	if serr := h.turnModel(r.Context(), userID, req.ConnectionID, req.Model, &params); serr != nil {
		httpx.WriteError(w, serr.Status, serr.Message, serr.Code)
		return
	}

	turn, serr := h.begin(r.Context(), userID, *sess, capability, message, attachments, nil, params)
	if serr != nil {
		httpx.WriteError(w, serr.Status, serr.Message, serr.Code)
		return
	}

	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{
		"turn_id": turn.ID.String(),
		"status":  turn.Status,
	})
}

// references checks the documents a question points at and returns them as
// the turn's params. Each must be the caller's and sit in one of the
// session's knowledge bases; anything else is a 404, as for any other id
// that is not theirs.
func (h *Handler) references(ctx context.Context, userID uuid.UUID, sess runtime.Session, raw []string) (map[string]string, *StartError) {
	if len(raw) == 0 {
		return nil, nil
	}
	if len(raw) > maxReferences {
		return nil, &StartError{http.StatusBadRequest, "a question may point at up to 8 documents", "too_many_references"}
	}
	ids := make([]uuid.UUID, 0, len(raw))
	seen := map[uuid.UUID]bool{}
	for _, s := range raw {
		id, err := uuid.Parse(s)
		if err != nil {
			return nil, &StartError{http.StatusNotFound, "not found", "not_found"}
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	refs, err := h.sessions.DocumentsInKBs(ctx, userID, sess.KBIDs, ids)
	if err != nil {
		return nil, &StartError{http.StatusInternalServerError, "could not check the documents", "references_failed"}
	}
	if len(refs) != len(ids) {
		return nil, &StartError{http.StatusNotFound, "not found", "not_found"}
	}
	encoded, _ := json.Marshal(refs)
	return map[string]string{runtime.ParamReferences: string(encoded)}, nil
}

// maxModelID caps a model id named for one turn, as Settings caps one added
// by hand.
const maxModelID = 200

// turnModel checks a connection named for one turn and adds it to params. It
// must be on the caller's chat route; anything else answers as a connection
// that does not exist, as a pin does.
func (h *Handler) turnModel(ctx context.Context, userID uuid.UUID, rawID, model string, params *map[string]string) *StartError {
	if strings.TrimSpace(rawID) == "" {
		return nil
	}
	id, err := uuid.Parse(strings.TrimSpace(rawID))
	if err != nil || h.connections == nil {
		return &StartError{http.StatusNotFound, "not found", "not_found"}
	}
	model = strings.TrimSpace(chat.CleanInput(model))
	if len(model) > maxModelID {
		return &StartError{http.StatusBadRequest, "that model id is too long", "model_too_long"}
	}
	on, err := h.connections.OnChatRoute(ctx, userID, id)
	if err != nil {
		return &StartError{http.StatusInternalServerError, "could not check the connection", "check_failed"}
	}
	if !on {
		return &StartError{http.StatusNotFound, "not found", "not_found"}
	}
	if *params == nil {
		*params = map[string]string{}
	}
	(*params)[runtime.ParamConnection] = id.String()
	if model != "" {
		(*params)[runtime.ParamModel] = model
	}
	return nil
}

// CheckOwnVersion applies "write your own version first" for the caller:
// with their switch on, the three lines are required; with it off they are
// optional. Solve calls it too, so both surfaces refuse the same way.
func (h *Handler) CheckOwnVersion(ctx context.Context, userID uuid.UUID, sent *ownversion.Lines) (*ownversion.Lines, *StartError) {
	required := false
	if h.ownVersion != nil {
		on, err := h.ownVersion.OwnVersionFirst(ctx, userID)
		if err != nil {
			return nil, &StartError{http.StatusInternalServerError, "could not read your settings", "settings_failed"}
		}
		required = on
	}
	lines, refusal := ownversion.Check(required, sent)
	if refusal != nil {
		return nil, &StartError{http.StatusBadRequest, refusal.Message, refusal.Code}
	}
	return lines, nil
}

// begin is the part of starting a turn every surface shares — chat's own
// POST and the solve and research endpoints (Start, below): refuse a busy
// session, persist the question, then run.
func (h *Handler) begin(
	ctx context.Context, userID uuid.UUID, sess runtime.Session,
	capability, message string, attachments []byte, images []runtime.Image, params map[string]string,
) (*runtime.Turn, *StartError) {
	// One turn at a time per session.
	//
	// The UI assumes it; the API did not enforce it, so a double-click or a
	// retried POST started a second provider call — on the user's own key —
	// streaming into the same conversation as the first. Two answers
	// interleaving in one transcript is not a race the reader can untangle
	// afterwards.
	if busy, err := h.sessionIsBusy(ctx, userID, sess.ID); err != nil {
		return nil, &StartError{http.StatusInternalServerError, "could not check the session", "busy_check_failed"}
	} else if busy {
		return nil, &StartError{http.StatusConflict,
			"this conversation already has a turn in progress", "turn_in_progress"}
	}

	// The user's message is persisted BEFORE the turn starts. If the process
	// dies a moment later, the transcript still shows what was asked — and the
	// swept turn's failure attaches to a question the user can see, rather than
	// to nothing at all.
	stored, err := h.sessions.AppendMessage(ctx, runtime.ChatMessage{
		UserID:      userID,
		SessionID:   sess.ID,
		Role:        runtime.RoleUser,
		Content:     message,
		Capability:  capability,
		Attachments: attachments,
	})
	if err != nil {
		return nil, &StartError{http.StatusInternalServerError, "could not store the message", "store_failed"}
	}
	_ = h.sessions.TouchSession(ctx, userID, sess.ID)
	if sess.Title == "" {
		if title := titleFromQuestion(message); title != "" {
			_ = h.sessions.SetTitleIfEmpty(ctx, userID, sess.ID, title)
		}
	}

	turn, err := h.orch.Run(ctx, runtime.StartTurn{
		Session:    sess,
		Capability: capability,
		Input:      message,
		// The capability reads history, which now contains the row above. This
		// id is how it knows not to send the question a second time.
		InputMessageID: stored.ID,
		Images:         images,
		Params:         params,
	})
	if err != nil {
		return nil, &StartError{http.StatusBadRequest, "could not start the turn", "start_failed"}
	}
	return turn, nil
}

// sessionIsBusy reports whether the session already has a non-terminal turn.
func (h *Handler) sessionIsBusy(ctx context.Context, userID, sessionID uuid.UUID) (bool, error) {
	turns, err := h.sessions.ListTurns(ctx, userID, sessionID, 10)
	if err != nil {
		return false, err
	}
	for _, t := range turns {
		if !t.Terminal() {
			return true, nil
		}
	}
	return false, nil
}

// eventBuffer is how far the merge goroutine may run ahead of the writer. It
// matches the bus's own subscriber buffer: a smaller one here would make the
// HTTP writer the bottleneck that drops a subscriber the bus was happy to keep.
const eventBuffer = 512

// streamEvents is the SSE endpoint: replay from the durable log, then follow
// the live bus.
//
// The contract, measured in Spike D and reproduced here exactly:
//
//   - `seq` is monotonic from 1 and is carried in the `id:` field;
//   - the client resumes with `after_seq` OR `Last-Event-ID`;
//   - the server replays `seq > cursor` from the per-turn log AND FILTERS THE
//     LIVE PATH BY THE SAME CURSOR.
//
// That last clause is the one that was genuinely missing in the spike and is
// pinned by a test here. A client reconnecting with Last-Event-ID to a turn
// this process has not replayed anything for gets an empty replay slice, so the
// cursor has nowhere to be applied unless the live path applies it too — and
// then the browser silently receives events it already has.
func (h *Handler) streamEvents(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	turnID, ok := pathID(w, r, "id")
	if !ok {
		return
	}

	// Ownership first, before a single byte of the stream. A 200 with a
	// text/event-stream body that then says "not found" is unreadable to an
	// EventSource, which would simply reconnect forever.
	turn, err := h.turns.GetTurn(r.Context(), userID, turnID)
	if err != nil {
		notFound(w)
		return
	}
	release, ok := sse.Acquire(w, userID)
	if !ok {
		return
	}
	defer release()

	cursor := sse.Cursor(r)

	// Read the durable log first. A turn running in THIS process also has a
	// live bus holding the same events; taking the persisted rows as the replay
	// and the bus only for what follows would double-deliver everything the
	// sink has already flushed. So: if the bus is live, it is the single source
	// for both replay and live. The database is for turns this process is not
	// running — after a restart, or when the turn is already over.
	bus, live := h.orch.Buses().Get(turnID)

	events := make(chan sse.Event, eventBuffer)
	go func() {
		defer close(events)
		if live {
			h.pumpBus(r, bus, cursor, events)
			return
		}
		h.pumpStore(r, cursor, events, turn)
	}()

	sse.Stream(w, r.Context().Done(), events)
}

// pumpBus serves a turn this process is running.
func (h *Handler) pumpBus(r *http.Request, bus *runtime.StreamBus, cursor int64, out chan<- sse.Event) {
	replay, liveCh, cancel := bus.Subscribe(cursor)
	defer cancel()

	for _, ev := range replay {
		if !send(r, out, wire(ev)) {
			return
		}
		if runtime.IsTerminal(ev.Type) {
			return
		}
	}
	if liveCh == nil {
		return
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case ev, open := <-liveCh:
			if !open {
				return
			}
			// The live-path cursor filter. See the doc comment on streamEvents.
			if ev.Seq <= cursor {
				continue
			}
			if !send(r, out, wire(ev)) {
				return
			}
			if runtime.IsTerminal(ev.Type) {
				return
			}
		}
	}
}

// storePage is how many rows one EventsAfter call reads. A long turn is paged
// rather than truncated: stopping at a fixed cap would end the stream without a
// terminal frame and leave the client reconnecting to page through by accident.
const storePage = 2000

// pumpStore serves a turn this process is NOT running: replay the persisted log,
// then make sure the client is told the turn is over if it is.
//
// The synthesized terminal frame at the end is load-bearing, and it is the part
// that was missing. The recovery sweeper numbers its WORKER_LOST event from the
// PERSISTED log, but content deltas are coalesced for up to 500 ms, so at crash
// time the persisted log lags what clients already received live. A client
// sitting at live cursor 6 against a persisted max of 0 gets a recovery event at
// seq 1 — below its cursor, so `EventsAfter(6)` returns nothing, the stream ends
// empty, EventSource retries, and the spinner never stops. Deriving the frame
// from the TURN ROW instead of the log means the client is told the truth
// whatever the log's numbering, and numbering it above the client's own cursor
// means it can never be filtered out as already-seen.
func (h *Handler) pumpStore(r *http.Request, cursor int64, out chan<- sse.Event, turn *runtime.Turn) {
	at := cursor
	for {
		events, err := h.turns.EventsAfter(r.Context(), turn.UserID, turn.ID, at, storePage)
		if err != nil {
			return
		}
		for _, ev := range events {
			if !send(r, out, wire(ev)) {
				return
			}
			at = ev.Seq
			if runtime.IsTerminal(ev.Type) {
				return
			}
		}
		if len(events) < storePage {
			break
		}
	}

	if !turn.Terminal() {
		// Still running somewhere else, or waiting on the sweeper. Ending the
		// stream here is what makes EventSource reconnect and pick up the rest.
		return
	}
	send(r, out, wire(terminalFor(*turn, at+1)))
}

// terminalFor builds the frame that tells a client a turn it is watching has
// already ended, from the turn row rather than from the event log.
func terminalFor(turn runtime.Turn, seq int64) runtime.Event {
	ev := runtime.Event{
		Seq:       seq,
		Source:    turn.Capability,
		TurnID:    turn.ID.String(),
		SessionID: turn.SessionID.String(),
		Metadata: map[string]any{
			"status":       turn.Status,
			"failure_code": turn.FailureCode,
			"retryable":    turn.Retryable,
		},
	}
	if turn.Status == runtime.StatusDone {
		ev.Type = runtime.EvDone
		return ev
	}
	ev.Type = runtime.EvError
	ev.Content = turn.Error
	if ev.Content == "" {
		ev.Content = "this turn ended before it finished"
	}
	return ev
}

// wire converts a runtime event into an SSE frame, applying the ONE recorded
// rename: `error` becomes `stream_error` in the `event:` field. The JSON
// payload keeps "type":"error", so DeepTutor parity survives inside the frame.
//
// Without the rename, EventSource dispatches a server `error` frame to the same
// listener as its own transport failures, and the two differ only by whether
// `.data` exists.
func wire(ev runtime.Event) sse.Event {
	return sse.Event{
		Seq:      ev.Seq,
		Name:     runtime.NameOnWire(ev.Type),
		Data:     ev,
		Terminal: runtime.IsTerminal(ev.Type),
	}
}

func send(r *http.Request, out chan<- sse.Event, ev sse.Event) bool {
	select {
	case <-r.Context().Done():
		return false
	case out <- ev:
		return true
	}
}

// cancelTurn stops a running turn.
//
// The row is written whether or not the turn is running HERE. A turn whose
// worker died is not cancellable in process but is certainly cancellable as a
// record, and leaving it `running` would hand it to the sweeper to fail with
// WORKER_LOST — telling the user their deliberate stop was a crash.
func (h *Handler) cancelTurn(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	turnID, ok := pathID(w, r, "id")
	if !ok {
		return
	}

	turn, err := h.turns.GetTurn(r.Context(), userID, turnID)
	if err != nil {
		notFound(w)
		return
	}
	if turn.Terminal() {
		httpx.WriteJSON(w, http.StatusOK, turnJSON(*turn))
		return
	}

	updated, err := h.turns.SetStatus(r.Context(), turnID,
		[]string{runtime.StatusQueued, runtime.StatusRunning, runtime.StatusWaitingUser},
		runtime.StatusCancelled,
		runtime.TurnUpdate{FailureCode: "CANCELLED", ClearLease: true, Finished: true})
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "could not cancel the turn", "cancel_failed")
		return
	}

	// Cancel the local context AFTER the row is written: the capability then
	// sees a cancelled context and its own terminal write loses the guarded
	// UPDATE, which is the correct resolution of that race.
	h.orch.Buses().Cancel(turnID)

	if updated == nil {
		// It finished between the read and the update. Report the truth.
		current, err := h.turns.GetTurn(r.Context(), userID, turnID)
		if err != nil {
			notFound(w)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, turnJSON(*current))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, turnJSON(*updated))
}

type answerRequest struct {
	Answer string `json:"answer"`
	// QuestionID is the id the `wait_for_input` event carried. Optional, and a
	// client that omits it is still served — but sending it is what stops a
	// retried or late POST from being consumed by a LATER question in the same
	// turn, which the server cannot otherwise tell apart from that question's
	// real answer.
	QuestionID string `json:"question_id"`
}

// answerTurn delivers the user's reply to a turn parked on ask_user.
func (h *Handler) answerTurn(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	turnID, ok := pathID(w, r, "id")
	if !ok {
		return
	}

	var req answerRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}
	answer := strings.TrimSpace(req.Answer)
	if answer == "" {
		httpx.WriteError(w, http.StatusBadRequest, "an answer is required", "empty_answer")
		return
	}
	if len(answer) > maxInput {
		httpx.WriteError(w, http.StatusRequestEntityTooLarge, "that answer is too long", "answer_too_long")
		return
	}

	turn, err := h.turns.GetTurn(r.Context(), userID, turnID)
	if err != nil {
		notFound(w)
		return
	}
	if turn.Status != runtime.StatusWaitingUser {
		httpx.WriteError(w, http.StatusConflict, "this turn is not waiting for an answer", "not_waiting")
		return
	}

	// The answer is part of the transcript, not only of the turn: a reader of
	// the conversation tomorrow has to see what the user chose.
	if _, err := h.sessions.AppendMessage(r.Context(), runtime.ChatMessage{
		UserID:     userID,
		SessionID:  turn.SessionID,
		Role:       runtime.RoleUser,
		Content:    answer,
		Capability: turn.Capability,
	}); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "could not store the answer", "store_failed")
		return
	}

	delivered := h.orch.Buses().Answer(turnID, runtime.Answer{
		QuestionID: strings.TrimSpace(req.QuestionID),
		Text:       answer,
	})
	if !delivered {
		// Waiting in a process that is gone. The sweeper will fail it; saying
		// "accepted" here would leave the user watching a stream that never
		// moves.
		httpx.WriteError(w, http.StatusConflict,
			"this turn is no longer running; ask again", "turn_not_live")
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"status": "accepted"})
}
