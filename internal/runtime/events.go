// Package runtime is the turn engine every AnyTools capability plugs into: a
// turn's lifecycle (queued → running → done), its lease, its in-process event
// bus, the batched persistence of that bus to Postgres, and the sweeper that
// fails turns whose worker died.
//
// Nothing in here knows what a chat is. The capability registry is the seam:
// `internal/capabilities/chat` is the first implementation and phases 7-10 add
// theirs beside it.
package runtime

import "time"

// The fifteen event types, taken VERBATIM from DeepTutor's StreamEventType
// (deeptutor/core/stream.py:20-34) in source order. Spike D
// (reports/spike-stream-retrieval.md §SSE) pinned the set and the frame shape;
// inventing a sixteenth name here is how a UI stops rendering an event it was
// never told about.
const (
	EvStageStart   = "stage_start"    // stream.py:20
	EvStageEnd     = "stage_end"      // :21
	EvThinking     = "thinking"       // :22
	EvObservation  = "observation"    // :23
	EvContent      = "content"        // :24
	EvToolCall     = "tool_call"      // :25
	EvToolResult   = "tool_result"    // :26
	EvProgress     = "progress"       // :27
	EvSources      = "sources"        // :28
	EvResult       = "result"         // :29
	EvError        = "error"          // :30
	EvSession      = "session"        // :31
	EvSessionMeta  = "session_meta"   // :32
	EvDone         = "done"           // :33
	EvWaitForInput = "wait_for_input" // :34
)

// AllEventTypes is the full set. A conformance test walks it so a typo in the
// port cannot pass unnoticed.
var AllEventTypes = []string{
	EvStageStart, EvStageEnd, EvThinking, EvObservation, EvContent,
	EvToolCall, EvToolResult, EvProgress, EvSources, EvResult,
	EvError, EvSession, EvSessionMeta, EvDone, EvWaitForInput,
}

// IsTerminal reports whether an event ends the stream. The handler writes it
// and returns; the bus closes after publishing it.
func IsTerminal(t string) bool { return t == EvDone || t == EvError }

// NameOnWire maps an event type to the name written in the SSE `event:` field.
//
// RENAME (the only one, and it is wire-only): "error" -> "stream_error".
//
// EventSource fires its OWN `error` event at the object for every transport
// failure — reconnect, DNS, 5xx. A server frame carrying `event: error` is
// dispatched to the same listener, and the two are distinguishable only by
// whether `.data` exists. Renaming removes the ambiguity. The JSON payload
// keeps "type":"error", so DeepTutor parity survives inside the frame.
func NameOnWire(t string) string {
	if t == EvError {
		return "stream_error"
	}
	return t
}

// Event mirrors DeepTutor's StreamEvent dataclass (stream.py:37-58) and its
// to_dict wire form (:60-71).
//
// Seq (:58) is assigned by the StreamBus, never by a producer, and is the
// resume cursor the client sends back as after_seq or Last-Event-ID.
type Event struct {
	Type      string         `json:"type"`
	Source    string         `json:"source,omitempty"`
	Stage     string         `json:"stage,omitempty"`
	Content   string         `json:"content,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	SessionID string         `json:"session_id,omitempty"`
	TurnID    string         `json:"turn_id,omitempty"`
	Seq       int64          `json:"seq"`
	Timestamp float64        `json:"timestamp"`
}

// Failure codes recorded on a failed turn. WORKER_LOST is DeepTutor's
// (runtime/coordination/recovery.py); the rest are AnyTools' own.
const (
	FailureWorkerLost   = "WORKER_LOST"
	FailureProvider     = "PROVIDER_ERROR"
	FailureToolRounds   = "TOOL_ROUND_LIMIT"
	FailureTokenBudget  = "TOKEN_BUDGET"
	FailureCapability   = "CAPABILITY_ERROR"
	FailureNoProvider   = "NO_PROVIDER"
	FailureUnrecognized = "UNKNOWN"
)

func nowUnix() float64 { return float64(time.Now().UnixNano()) / 1e9 }
