package providers

import "encoding/json"

// tool_args.go — single place where provider adapters turn raw tool-call
// argument JSON into a map. Every adapter previously did
// `_ = json.Unmarshal(raw, &args)`, which silently swallowed the parse error:
// a truncated or malformed argument payload became an EMPTY map and the tool
// executed with zero arguments. parseToolArgs keeps that from being silent —
// the caller stores the error on ToolCall.ArgsParseError and the agent loop
// refuses to dispatch the call, feeding the error back to the model instead.

// parseToolArgs parses raw tool-call argument JSON. An empty raw string is a
// legitimate no-argument call and returns an empty map with no error. A
// non-empty string that fails to parse returns an empty map plus the parse
// error message.
func parseToolArgs(raw string) (map[string]interface{}, string) {
	args := make(map[string]interface{})
	if raw == "" {
		return args, ""
	}
	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		return map[string]interface{}{}, err.Error()
	}
	return args, ""
}
