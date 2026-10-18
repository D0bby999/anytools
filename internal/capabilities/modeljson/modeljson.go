// Package modeljson gets a JSON object back out of a model reply that was asked
// for JSON and is not obliged to have sent only that.
//
// Quiz wrote the scanner, mastery copied it with a note that a third caller
// would make it shared; solve and research are the third and fourth. One
// scanner means one set of edge cases to get right.
package modeljson

import "strings"

// Extract pulls the first JSON object out of a reply.
//
// Three shapes are handled because all three are what providers actually send
// when asked for JSON: a bare object; an object inside a ```json fence; and an
// object with a sentence in front of it ("Here is the plan:").
//
// The scan is brace-balanced and STRING-AWARE. A naive first-`{`-to-last-`}`
// slice breaks on a value that legitimately contains a brace — which LaTeX
// does constantly (`\frac{1}{2}`) — and an escape-blind scan breaks on `"\\"`
// at the end of a string.
func Extract(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if fenced, ok := insideFence(s); ok {
		s = fenced
	}

	start := strings.IndexByte(s, '{')
	if start < 0 {
		return "", false
	}

	depth := 0
	inString := false
	escaped := false
	for i := start; i < len(s); i++ {
		c := s[i]
		switch {
		case escaped:
			escaped = false
		case c == '\\' && inString:
			escaped = true
		case c == '"':
			inString = !inString
		case inString:
			// nothing structural inside a string
		case c == '{':
			depth++
		case c == '}':
			depth--
			if depth == 0 {
				return s[start : i+1], true
			}
		}
	}
	return "", false
}

// insideFence returns the body of the first ``` fence, if the reply is fenced.
func insideFence(s string) (string, bool) {
	open := strings.Index(s, "```")
	if open < 0 {
		return "", false
	}
	rest := s[open+3:]
	// Drop an optional language tag on the opening line.
	if nl := strings.IndexByte(rest, '\n'); nl >= 0 {
		first := strings.TrimSpace(rest[:nl])
		if first == "" || !strings.ContainsAny(first, "{[") {
			rest = rest[nl+1:]
		}
	}
	if close := strings.Index(rest, "```"); close >= 0 {
		return rest[:close], true
	}
	return rest, true
}
