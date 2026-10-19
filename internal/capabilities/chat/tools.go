package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/D0bby999/anytools/internal/runtime"
)

// tools.go runs one round's tool calls.
//
// Two passes. The calls run concurrently (a model asking for three searches
// used to wait for three round trips), then their results are handled one by
// one in the order the model asked for them: tool_result events, sources,
// ask_user. Handling them in order keeps a turn's sources, and so its
// citation numbering, the same however the calls happened to finish, and
// keeps ask_user a single question at a time.

// toolConcurrency caps the calls one round runs at once.
const toolConcurrency = 4

// Tool output budget (postclaw tool_output_budget.go): a result is capped
// before it enters the prompt, line-snapped head and tail with a marker, so one
// long page cannot take the whole window. The UI and the sources are not
// affected; only what the model reads is.
const (
	toolOutputMaxChars   = 16_000
	toolOutputRetryChars = 4_000
)

// workStep is one tool call, as the answer's "how it was found" row shows it.
type workStep struct {
	Tool     string `json:"tool"`
	Detail   string `json:"detail,omitempty"`
	Found    int    `json:"found,omitempty"`
	Error    bool   `json:"error,omitempty"`
	Repeated bool   `json:"repeated,omitempty"`
	MS       int64  `json:"ms"`
}

// workRecord is a turn's work, stored on its answer.
type workRecord struct {
	Steps        []workStep `json:"steps,omitempty"`
	Rounds       int        `json:"rounds"`
	Summarised   int        `json:"summarised,omitempty"`
	Continued    bool       `json:"continued,omitempty"`
	LimitReached bool       `json:"limit_reached,omitempty"`
	MS           int64      `json:"ms"`
	// ContextTokens is the estimated prompt before this turn's tool rounds;
	// ContextWindow the model's window it was sized against.
	ContextTokens int `json:"context_tokens,omitempty"`
	ContextWindow int `json:"context_window,omitempty"`
}

type toolOutcome struct {
	content   string
	retrieved bool
}

// execution is the first pass's result for one call.
type execution struct {
	result   runtime.ToolResult
	err      error
	ms       int64
	skip     *toolOutcome // decided without running the tool
	repeated bool
}

// runTools runs one round's calls and returns their outcomes in call order.
//
// A tool ERROR is returned to the model as tool content, not raised: a foreign
// id, a bad page number or a malformed argument is something the model should
// see and correct. Only an infrastructure failure, the retriever's database
// being down, ends the turn, because retrying that in the loop just burns
// rounds.
func (c *Capability) runTools(
	ctx context.Context, tc *runtime.TurnContext, calls []runtime.ToolCall,
	seen map[string]string, work *workRecord,
) ([]toolOutcome, error) {
	execs := make([]execution, len(calls))

	var wg sync.WaitGroup
	slots := make(chan struct{}, toolConcurrency)
	for i, call := range calls {
		tc.Emit(runtime.Event{
			Type: runtime.EvToolCall, Stage: stagePlanning, Source: c.Name(),
			Content:  call.Name,
			Metadata: map[string]any{"tool": call.Name, "call_id": call.ID, "arguments": redactArgs(call.Arguments)},
		})

		// postclaw's hard-won rule (providers/types.go:170): a call whose
		// argument JSON did not parse must NOT be dispatched. Arguments is an
		// empty map in that case, and running rag_search with no arguments is a
		// search the user never asked for.
		if call.ArgsParseError != "" {
			execs[i].skip = &toolOutcome{content: "your arguments were not valid JSON; send them again"}
			continue
		}
		tool, err := tc.Tools.Get(call.Name)
		if err != nil {
			execs[i].skip = &toolOutcome{content: fmt.Sprintf("there is no tool called %q in this conversation", call.Name)}
			continue
		}

		// The same call twice in one turn is answered from the first result
		// rather than paid for again: a weak model otherwise searches one
		// query until the rounds run out (postclaw's tool-loop guard).
		key := callKey(call)
		if _, dup := seen[key]; dup {
			execs[i].repeated = true
			execs[i].skip = &toolOutcome{content: "You already made this exact call in this turn; its result is above. " +
				"Use it, or change the arguments if it did not help."}
			continue
		}
		seen[key] = call.ID

		wg.Add(1)
		go func(i int, call runtime.ToolCall, tool runtime.Tool) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			start := time.Now()
			execs[i].result, execs[i].err = tool.Execute(ctx, call.Arguments, runtime.ToolInput{
				UserID:    tc.Turn.UserID,
				SessionID: tc.Session.ID,
				TurnID:    tc.Turn.ID,
				KBIDs:     tc.Session.KBIDs,
				AllowWeb:  tc.Session.AllowWeb,
			})
			execs[i].ms = time.Since(start).Milliseconds()
		}(i, call, tool)
	}
	wg.Wait()

	out := make([]toolOutcome, len(calls))
	for i, call := range calls {
		ex := execs[i]
		step := workStep{Tool: call.Name, Detail: argDetail(call.Arguments), MS: ex.ms}

		switch {
		case ex.skip != nil && ex.repeated:
			step.Repeated = true
			tc.Emit(runtime.Event{
				Type: runtime.EvToolResult, Stage: stagePlanning, Source: c.Name(),
				Content:  "already done in this turn",
				Metadata: map[string]any{"tool": call.Name, "call_id": call.ID, "repeated": true},
			})
			out[i] = *ex.skip

		case ex.skip != nil:
			step.Error = true
			out[i] = c.toolFailed(tc, call, ex.skip.content)

		case ex.err != nil:
			if ctx.Err() != nil {
				return nil, runtime.ErrTurnCancelled
			}
			return nil, fmt.Errorf("tool %s: %w", call.Name, ex.err)

		case ex.result.Ask != nil:
			// ask_user suspends the turn here. The answer comes back as the
			// tool's result, so from the model's point of view it asked a
			// question and got one.
			answer, err := tc.Ask(ctx, *ex.result.Ask)
			if err != nil {
				if errors.Is(err, runtime.ErrNoAnswer) && ctx.Err() != nil {
					return nil, runtime.ErrTurnCancelled
				}
				return nil, err
			}
			tc.Emit(runtime.Event{
				Type: runtime.EvToolResult, Stage: stagePlanning, Source: c.Name(),
				Content:  "answered",
				Metadata: map[string]any{"tool": call.Name, "call_id": call.ID},
			})
			// The user's answer is a USER instruction, and is labelled as one
			// rather than wrapped in the untrusted envelope.
			out[i] = toolOutcome{content: "The user answered: " + answer}

		case ex.result.IsError:
			step.Error = true
			out[i] = c.toolFailed(tc, call, ex.result.Content)

		default:
			res := ex.result
			tc.AddSources(res.Sources...)
			step.Found = len(res.Sources)
			tc.Emit(runtime.Event{
				Type: runtime.EvToolResult, Stage: stagePlanning, Source: c.Name(),
				Content: summarize(res.Content),
				Metadata: map[string]any{
					"tool": call.Name, "call_id": call.ID, "sources": len(res.Sources),
				},
			})
			if len(res.Sources) > 0 {
				tc.Emit(runtime.Event{
					Type: runtime.EvObservation, Stage: stagePlanning, Source: c.Name(),
					Content: fmt.Sprintf("%d passages retrieved", len(res.Sources)),
				})
			}
			out[i] = toolOutcome{content: capToolOutput(res.Content, toolOutputMaxChars), retrieved: res.Retrieved}
		}
		work.Steps = append(work.Steps, step)
	}
	return out, nil
}

func (c *Capability) toolFailed(tc *runtime.TurnContext, call runtime.ToolCall, msg string) toolOutcome {
	tc.Emit(runtime.Event{
		Type: runtime.EvToolResult, Stage: stagePlanning, Source: c.Name(),
		Content:  msg,
		Metadata: map[string]any{"tool": call.Name, "call_id": call.ID, "error": true},
	})
	return toolOutcome{content: "Tool error: " + msg}
}

// callKey identifies a call by tool and arguments. encoding/json writes map
// keys sorted, so the same arguments in another order are the same call.
func callKey(call runtime.ToolCall) string {
	args, _ := json.Marshal(call.Arguments)
	return call.Name + "\x00" + string(args)
}

// argDetail is the argument a reader recognises a call by: what it searched
// for, or which page it read.
func argDetail(args map[string]any) string {
	for _, key := range []string{"query", "question", "q", "title", "path"} {
		if s, ok := args[key].(string); ok && strings.TrimSpace(s) != "" {
			return truncate(strings.TrimSpace(s), 120)
		}
	}
	if p, ok := args["page"].(float64); ok {
		return fmt.Sprintf("page %d", int(p))
	}
	return ""
}

// capToolOutput keeps a result's head and tail within max characters, cut at
// line boundaries, with a marker naming what was left out.
func capToolOutput(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	head := string(r[:max*2/3])
	tail := string(r[len(r)-max/3:])
	if i := strings.LastIndexByte(head, '\n'); i > len(head)/2 {
		head = head[:i]
	}
	if i := strings.IndexByte(tail, '\n'); i >= 0 && i < len(tail)/2 {
		tail = tail[i+1:]
	}
	omitted := len(r) - len([]rune(head)) - len([]rune(tail))
	return head + fmt.Sprintf("\n\n[… %d characters of this result left out to fit the context …]\n\n", omitted) + tail
}
