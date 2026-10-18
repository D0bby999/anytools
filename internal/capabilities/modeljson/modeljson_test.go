package modeljson

import (
	"encoding/json"
	"testing"
)

func TestExtract(t *testing.T) {
	cases := map[string]string{
		"bare":     `{"a":1}`,
		"fenced":   "```json\n{\"a\":1}\n```",
		"preamble": "Here is the plan:\n{\"a\":1} thanks",
		"latex":    `{"a":"\\frac{1}{2} and }"}`,
		"escape":   `{"a":"ends with \\"}`,
	}
	for name, in := range cases {
		got, ok := Extract(in)
		if !ok {
			t.Errorf("%s: no object found in %q", name, in)
			continue
		}
		var v map[string]any
		if err := json.Unmarshal([]byte(got), &v); err != nil {
			t.Errorf("%s: %q does not decode: %v", name, got, err)
		}
	}
	if _, ok := Extract("no json here"); ok {
		t.Error("found an object in prose")
	}
	if _, ok := Extract(`{"unterminated": `); ok {
		t.Error("accepted an unterminated object")
	}
}
