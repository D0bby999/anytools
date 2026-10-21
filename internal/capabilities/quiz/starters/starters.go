// Package starters holds the exercise sets the quiz can add to a knowledge
// base (the private design notes, phase 4): today the
// Python set, eighteen exercises from Exercism's Python track (MIT), written
// by scripts/quizstarters with their instructions, stub, tests and example
// solution unchanged.
package starters

import (
	_ "embed"
	"encoding/json"
)

// Exercise is one exercise as the set holds it.
type Exercise struct {
	Slug         string `json:"slug"`
	Title        string `json:"title"`
	Module       string `json:"module"`
	Instructions string `json:"instructions"`
	Starter      string `json:"starter"`
	Tests        string `json:"tests"`
	Solution     string `json:"solution"`
	Credit       string `json:"credit"`
	Difficulty   int    `json:"difficulty"`
}

//go:embed python.json
var pythonJSON []byte

// Python is the Python set, easiest first.
func Python() []Exercise {
	var out []Exercise
	if err := json.Unmarshal(pythonJSON, &out); err != nil {
		panic("starters: python.json: " + err.Error())
	}
	return out
}
