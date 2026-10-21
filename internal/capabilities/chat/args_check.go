package chat

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// args_check.go checks a call's arguments against its tool's own schema
// before the tool runs (plan 261021-1100 phase 5, after postclaw's
// tool_args_guard.go, which stops at "did the JSON parse").
//
// It is lenient where the tools are: they accept an integer written as a
// string, a number where text is expected, and a bare string for a one-item
// list (internal/tools/args.go), so those pass here too. What fails is what
// no tool could use: a required argument that is missing or blank, a value of
// the wrong kind, a value outside the tool's list.

// checkArgs returns what is wrong with args, or "".
func checkArgs(schema map[string]any, args map[string]any) string {
	props, _ := schema["properties"].(map[string]any)
	for _, name := range requiredArgs(schema) {
		v, ok := args[name]
		if s, isString := v.(string); !ok || v == nil || (isString && strings.TrimSpace(s) == "") {
			return fmt.Sprintf("%q is required", name)
		}
	}
	names := make([]string, 0, len(args))
	for name := range args {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		spec, ok := props[name].(map[string]any)
		if !ok || args[name] == nil {
			continue
		}
		kind, _ := spec["type"].(string)
		if kind != "" && !fitsKind(kind, args[name]) {
			return fmt.Sprintf("%q must be %s", name, kindName(kind))
		}
		if allowed, ok := spec["enum"].([]any); ok && len(allowed) > 0 && !inEnum(allowed, args[name]) {
			return fmt.Sprintf("%q must be one of %s", name, enumList(allowed))
		}
		if allowed, ok := spec["enum"].([]string); ok && len(allowed) > 0 {
			list := make([]any, len(allowed))
			for i, a := range allowed {
				list[i] = a
			}
			if !inEnum(list, args[name]) {
				return fmt.Sprintf("%q must be one of %s", name, enumList(list))
			}
		}
	}
	return ""
}

// argsSignature lists what a tool takes, for the model to correct a call.
func argsSignature(schema map[string]any) string {
	props, _ := schema["properties"].(map[string]any)
	if len(props) == 0 {
		return "It takes no arguments."
	}
	required := map[string]bool{}
	for _, name := range requiredArgs(schema) {
		required[name] = true
	}
	names := make([]string, 0, len(props))
	for name := range props {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		if required[names[i]] != required[names[j]] {
			return required[names[i]]
		}
		return names[i] < names[j]
	})
	parts := make([]string, len(names))
	for i, name := range names {
		kind := "any"
		if spec, ok := props[name].(map[string]any); ok {
			if k, ok := spec["type"].(string); ok {
				kind = k
			}
		}
		parts[i] = name + " (" + kind
		if required[name] {
			parts[i] += ", required"
		}
		parts[i] += ")"
	}
	return "It takes: " + strings.Join(parts, ", ") + "."
}

func requiredArgs(schema map[string]any) []string {
	switch r := schema["required"].(type) {
	case []string:
		return r
	case []any:
		out := make([]string, 0, len(r))
		for _, v := range r {
			if s, ok := v.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

func fitsKind(kind string, v any) bool {
	switch kind {
	case "string":
		switch v.(type) {
		case string, float64, json.Number:
			return true
		}
	case "integer":
		switch t := v.(type) {
		case float64:
			return t == math.Trunc(t)
		case json.Number:
			_, err := t.Int64()
			return err == nil
		case string:
			_, err := strconv.Atoi(strings.TrimSpace(t))
			return err == nil
		}
	case "number":
		switch t := v.(type) {
		case float64, json.Number:
			return true
		case string:
			_, err := strconv.ParseFloat(strings.TrimSpace(t), 64)
			return err == nil
		}
	case "boolean":
		switch t := v.(type) {
		case bool:
			return true
		case string:
			return t == "true" || t == "false"
		}
	case "array":
		switch v.(type) {
		case []any, string:
			return true
		}
	case "object":
		_, ok := v.(map[string]any)
		return ok
	default:
		return true
	}
	return false
}

func kindName(kind string) string {
	switch kind {
	case "string":
		return "text"
	case "integer":
		return "a whole number"
	case "number":
		return "a number"
	case "boolean":
		return "true or false"
	case "array":
		return "a list"
	case "object":
		return "an object"
	}
	return kind
}

func inEnum(allowed []any, v any) bool {
	for _, a := range allowed {
		if fmt.Sprint(a) == fmt.Sprint(v) {
			return true
		}
	}
	return false
}

func enumList(allowed []any) string {
	parts := make([]string, len(allowed))
	for i, a := range allowed {
		parts[i] = fmt.Sprintf("%q", fmt.Sprint(a))
	}
	return strings.Join(parts, ", ")
}
