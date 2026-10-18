package worksheet

import "sync"

// example is the engine's own kind: every field type, following
// testdata/example.md the way a real kind follows its up file. It is not one
// of up's templates and is never registered in production: the engine's
// tests register it, and a development server does (wire_worksheet.go) so
// the form can be tried by hand before any real kind lands.
var example = Kind{
	Kind: "example", Name: "Example", Group: GroupLanguage, Version: 1,
	Source:  "internal/learning/worksheet/testdata/example.md",
	Summary: "The engine's fixture.", Attach: AttachState,
	Reviews:    []Review{{Key: "day7", Label: "Day 7 retest", Days: 7}},
	RowReviews: []RowReview{{Section: "retest", Field: "timeline", Row: "day7", Review: "day7"}},
	Sections: []Section{
		{Key: "boundary", Title: "Boundary", Hint: "What you will try, and under which conditions.", Fields: []Field{
			{Key: "task", Label: "Task", Type: Text},
			{Key: "situation", Label: "Situation", Type: Long},
			{Key: "context", Label: "Context", Type: Choice, Options: []string{"work", "study"}, Other: true},
			{Key: "help", Label: "Help used", Type: Multi, Options: []string{"dictionary", "captions", "AI"}},
			{Key: "confidence", Label: "Confidence", Type: Score,
				ScoreLabels: []string{"not done", "partial or prompted", "on my own"}},
			{Key: "ready", Label: "Ready to share?", Type: YesNo},
			{Key: "review_on", Label: "Review date", Type: Date},
		}},
		{Key: "before", Title: "Before you start", Fields: []Field{
			{Key: "saved", Label: "The first version is saved", Type: Check},
			{Key: "no_key", Label: "No answer key is open", Type: Check},
		}},
		{Key: "retest", Title: "Retest", Fields: []Field{
			{Key: "timeline", Label: "Timeline", Type: Table, RowHeader: "Time",
				Rows: []Row{{Key: "day0", Label: "Day 0"}, {Key: "day7", Label: "Day 7"}},
				Columns: []Field{
					{Key: "removed", Label: "What is removed", Type: Label,
						Text: map[string]string{"day0": "Nothing", "day7": "Captions"}},
					{Key: "barrier", Label: "Barrier", Type: Choice, RowOptions: map[string][]string{
						"day0": {"sound", "speed"}, "day7": {"words", "structure", "layout"}}},
					{Key: "result", Label: "Result", Type: Long},
					{Key: "score", Label: "Score", Type: Score},
				}},
		}},
		{Key: "log", Title: "Log", Fields: []Field{
			{Key: "entries", Label: "Entries", Type: Table, MaxRows: 10, Columns: []Field{
				{Key: "date", Label: "Date", Type: Date},
				{Key: "note", Label: "Note", Type: Long},
			}},
		}},
	},
}

var exampleOnce sync.Once

// RegisterExample registers the example kind, once however often it is
// called.
func RegisterExample() { exampleOnce.Do(func() { register(example) }) }
