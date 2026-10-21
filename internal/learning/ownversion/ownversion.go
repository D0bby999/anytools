// Package ownversion is "write your own version first" (the private design notes, phase 11).
//
// Source: up, docs/en/threads/part-3/3-attention-and-judgment.md §3 ("Leave
// Your Version Before Using AI"), and docs/en/threads/part-1/7-ai.md §1. Before
// asking, the learner writes three lines: what they understand now, what they
// are least sure of, and what result would show they have learned it. After the
// answer, they close it and retell without prompts.
//
// The lines travel on the user message's attachments as
// {"own_version": {...}}; the retell on the answer's as {"retell": {...}}. A
// chat message's attachments default to the array '[]', so every reader here
// accepts both shapes.
package ownversion

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

// MaxLine caps each of the three lines; MaxRetell caps a retell. Both are in
// characters, as the browser counts them.
const (
	MaxLine   = 500
	MaxRetell = 4000
)

// Heading introduces the lines inside the learner's message to the model.
const Heading = "The learner's own attempt, written before asking"

// Lines are the three lines, in up's order.
type Lines struct {
	Understanding string `json:"understanding"`
	Uncertain     string `json:"uncertain"`
	Proof         string `json:"proof"`
}

// ErrInvalid is a set of lines that is not three 1–500 character answers.
var ErrInvalid = errors.New("own_version needs all three lines, each 1–500 characters")

// Normalize trims the lines and checks each is 1–MaxLine characters.
func (l Lines) Normalize() (Lines, error) {
	out := Lines{
		Understanding: strings.TrimSpace(l.Understanding),
		Uncertain:     strings.TrimSpace(l.Uncertain),
		Proof:         strings.TrimSpace(l.Proof),
	}
	for _, s := range []string{out.Understanding, out.Uncertain, out.Proof} {
		if n := utf8.RuneCountInString(s); n == 0 || n > MaxLine {
			return Lines{}, ErrInvalid
		}
	}
	return out, nil
}

// Empty reports whether nothing was written in any line. An all-blank object
// is the same as none at all.
func (l Lines) Empty() bool {
	return strings.TrimSpace(l.Understanding) == "" &&
		strings.TrimSpace(l.Uncertain) == "" &&
		strings.TrimSpace(l.Proof) == ""
}

// Refusal is why a request's lines were refused; the code is the API's.
type Refusal struct {
	Message string
	Code    string
}

// Check applies the rule both Solve and chat enforce. With the setting on, the
// three lines are required; with it off they are optional, and kept when sent.
// Lines that were sent must be complete either way. It returns the normalized
// lines, or nil when none were sent.
func Check(required bool, sent *Lines) (*Lines, *Refusal) {
	if sent == nil || sent.Empty() {
		if required {
			return nil, &Refusal{
				"write your own version first: what you understand, what you are least sure of, and what would show you have learned it",
				"own_version_required"}
		}
		return nil, nil
	}
	l, err := sent.Normalize()
	if err != nil {
		return nil, &Refusal{ErrInvalid.Error(), "own_version_invalid"}
	}
	return &l, nil
}

// Render is the block the model reads after the learner's question. They are
// the learner's own words, like the question, so no envelope applies.
func (l Lines) Render() string {
	var b strings.Builder
	b.WriteString(Heading + ":\n")
	b.WriteString("- What I understand now: " + l.Understanding + "\n")
	b.WriteString("- What I am least sure of: " + l.Uncertain + "\n")
	b.WriteString("- What would show I have learned it: " + l.Proof)
	return b.String()
}

// WithQuestion is a learner's message as the model reads it: the question,
// then the lines when there are any.
func WithQuestion(question string, l *Lines) string {
	if l == nil {
		return question
	}
	return question + "\n\n" + l.Render()
}

// Attachments is a user message's attachments when it carries the lines.
func Attachments(l Lines) []byte {
	raw, _ := json.Marshal(map[string]any{"own_version": l})
	return raw
}

// FromAttachments reads the lines a stored message carries, or nil. An array
// (the default '[]') or any other shape carries none.
func FromAttachments(raw []byte) *Lines {
	var att struct {
		OwnVersion *Lines `json:"own_version"`
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '{' || json.Unmarshal(raw, &att) != nil || att.OwnVersion == nil {
		return nil
	}
	if l, err := att.OwnVersion.Normalize(); err == nil {
		return &l
	}
	return nil
}

// Retell is what a "Close it and retell" save stores on the answer.
type Retell struct {
	Text      string `json:"text"`
	WrittenAt string `json:"written_at"`
}

// NormalizeRetell trims a retell and checks it is 1–MaxRetell characters.
func NormalizeRetell(text string) (string, bool) {
	text = strings.TrimSpace(text)
	n := utf8.RuneCountInString(text)
	return text, n > 0 && n <= MaxRetell
}
