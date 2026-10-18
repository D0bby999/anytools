// Package worksheettest holds worksheet kinds for tests in other packages.
//
// It is an ordinary package, not a _test.go file, so that the internal/app
// and internal/store/pg test binaries can link it: importing it registers the
// kinds below. Production code never imports it, so these kinds never exist
// outside a test (red team AS-2: phase 0 needs a private kind to prove AC3
// before any real private kind lands).
package worksheettest

import (
	"encoding/json"
	"fmt"

	"github.com/D0bby999/anytools/internal/learning/worksheet"
)

// The fixture kinds.
const (
	// Private is a private kind attachable to a learning state, with every
	// field type that can hold text.
	Private = "fixture_private"
	// State is a non-private kind attachable to a learning state, with a
	// creation-anchored review and a dated row (up's delay rule), a review
	// counted from a field's first fill, and one counted from a written date.
	State = "fixture_state"
	// Document is a non-private kind that must be attached to an uploaded or
	// YouTube document.
	Document = "fixture_document"
)

func init() {
	worksheet.Register(worksheet.Kind{
		Kind: Private, Name: "Fixture: private", Group: worksheet.GroupLife, Version: 1,
		Source: "test fixture", Summary: "A private worksheet for tests.",
		Private: true, Attach: worksheet.AttachState,
		Sections: []worksheet.Section{
			{Key: "facts", Title: "Facts", Fields: []worksheet.Field{
				{Key: "line", Label: "One line", Type: worksheet.Text},
				{Key: "prose", Label: "Prose", Type: worksheet.Long},
				{Key: "mode", Label: "Mode", Type: worksheet.Choice, Options: []string{"safety", "rebuilding"}, Other: true},
			}},
			{Key: "log", Title: "Log", Fields: []worksheet.Field{
				{Key: "rows", Label: "Rows", Type: worksheet.Table, MaxRows: 3, Columns: []worksheet.Field{
					{Key: "fact", Label: "Fact", Type: worksheet.Text},
					{Key: "note", Label: "Note", Type: worksheet.Long},
				}},
			}},
		},
	})
	worksheet.Register(worksheet.Kind{
		Kind: State, Name: "Fixture: state", Group: worksheet.GroupProjects, Version: 1,
		Source: "test fixture", Summary: "A worksheet on a learning state, for tests.",
		Attach: worksheet.AttachState,
		Reviews: []worksheet.Review{
			{Key: "day7", Label: "Day 7 retest", Days: 7},
			{Key: "after_delivery", Label: "Three days after delivery", Days: 3,
				From: worksheet.Anchor{Section: "plan", Field: "delivered"}},
			{Key: "chosen", Label: "Review date", Days: 0,
				From: worksheet.Anchor{Section: "plan", Field: "review_on"}},
		},
		RowReviews: []worksheet.RowReview{{Section: "retest", Field: "timeline", Row: "day7", Review: "day7"}},
		Sections: []worksheet.Section{
			{Key: "plan", Title: "Plan", Fields: []worksheet.Field{
				{Key: "task", Label: "Task", Type: worksheet.Text},
				{Key: "delivered", Label: "Delivered", Type: worksheet.Text},
				{Key: "review_on", Label: "Review on", Type: worksheet.Date},
			}},
			{Key: "retest", Title: "Retest", Fields: []worksheet.Field{
				{Key: "timeline", Label: "Timeline", Type: worksheet.Table, RowHeader: "When",
					Rows: []worksheet.Row{{Key: "day0", Label: "Day 0"}, {Key: "day7", Label: "Day 7"}},
					Columns: []worksheet.Field{
						{Key: "result", Label: "Result", Type: worksheet.Text},
						{Key: "score", Label: "Score", Type: worksheet.Score},
					}},
			}},
			{Key: "notes", Title: "Notes", Fields: []worksheet.Field{
				{Key: "free", Label: "Free rows", Type: worksheet.Table, MaxRows: 2, Columns: []worksheet.Field{
					{Key: "text", Label: "Text", Type: worksheet.Text},
				}},
			}},
		},
	})
	worksheet.Register(worksheet.Kind{
		Kind: Document, Name: "Fixture: document", Group: worksheet.GroupLanguage, Version: 1,
		Source: "test fixture", Summary: "A worksheet on a document, for tests.",
		Attach: worksheet.AttachDocument, DocumentKinds: []string{"upload", "youtube"},
		Sections: []worksheet.Section{
			{Key: "pass", Title: "Pass", Fields: []worksheet.Field{
				{Key: "note", Label: "Note", Type: worksheet.Long},
			}},
		},
	})
}

// Fill returns answers for every section of k with marker written into every
// field that holds text: text and long fields, choices that accept "other",
// and the text and long cells of one row of every table. It is how the
// privacy test proves a private worksheet's words go nowhere.
func Fill(k *worksheet.Kind, marker string) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for _, s := range k.Sections {
		fields := map[string]any{}
		for _, f := range s.Fields {
			switch f.Type {
			case worksheet.Text, worksheet.Long:
				fields[f.Key] = fmt.Sprintf("%s %s", marker, f.Key)
			case worksheet.Choice:
				if f.Other {
					fields[f.Key] = fmt.Sprintf("%s %s", marker, f.Key)
				} else if len(f.Options) > 0 {
					fields[f.Key] = f.Options[0]
				}
			case worksheet.Table:
				cells := map[string]any{}
				for _, c := range f.Columns {
					if c.Type == worksheet.Text || c.Type == worksheet.Long {
						cells[c.Key] = fmt.Sprintf("%s %s.%s", marker, f.Key, c.Key)
					}
				}
				row := ""
				if len(f.Rows) > 0 {
					row = f.Rows[0].Key
				}
				fields[f.Key] = []any{map[string]any{"row": row, "cells": cells}}
			}
		}
		raw, _ := json.Marshal(fields)
		out[s.Key] = raw
	}
	return out
}
