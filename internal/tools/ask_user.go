package tools

import (
	"context"
	"strings"

	"github.com/D0bby999/anytools/internal/runtime"
)

// maxAskOptions caps the choices offered. A question with twenty buttons is not
// a clarification, it is the model refusing to decide.
const maxAskOptions = 6

// AskUser is `ask_user(question, options[])`.
//
// It does not block here. The tool returns a ToolResult carrying the question,
// and the chat capability suspends the turn on it through TurnContext.Ask —
// which is what moves the row to `waiting_user` and emits `wait_for_input`.
// Blocking inside a tool would hide a status change from the turn engine, and
// the sweeper would then be looking at a `running` row nobody was working on.
type AskUser struct{}

// NewAskUser builds the tool.
func NewAskUser() *AskUser { return &AskUser{} }

// Name implements runtime.Tool.
func (t *AskUser) Name() string { return "ask_user" }

// NeedsNetwork implements runtime.Tool.
func (t *AskUser) NeedsNetwork() bool { return false }

// Definition implements runtime.Tool.
func (t *AskUser) Definition() runtime.ToolDefinition {
	return runtime.ToolDefinition{
		Type: "function",
		Function: runtime.ToolFunctionSchema{
			Name: t.Name(),
			Description: "Ask the user one short question and wait for their answer. " +
				"Use it when the request is ambiguous in a way that changes the answer — not to confirm what you already know.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"question": map[string]any{
						"type":        "string",
						"description": "One question, in plain language.",
					},
					"options": map[string]any{
						"type":        "array",
						"items":       map[string]any{"type": "string"},
						"description": "Up to six suggested answers. The user may still type their own.",
					},
				},
				"required": []string{"question"},
			},
		},
	}
}

// Execute implements runtime.Tool.
func (t *AskUser) Execute(_ context.Context, args map[string]any, _ runtime.ToolInput) (runtime.ToolResult, error) {
	question := stringArg(args, "question")
	if question == "" {
		return toolError("ask_user needs a question"), nil
	}

	var options []string
	if raw, ok := args["options"]; ok {
		switch t := raw.(type) {
		case []any:
			for _, item := range t {
				if s, ok := item.(string); ok {
					if s = strings.TrimSpace(s); s != "" {
						options = append(options, s)
					}
				}
			}
		case []string:
			options = t
		}
	}
	if len(options) > maxAskOptions {
		options = options[:maxAskOptions]
	}

	return runtime.ToolResult{
		Ask: &runtime.AskUser{Question: question, Options: options},
	}, nil
}
