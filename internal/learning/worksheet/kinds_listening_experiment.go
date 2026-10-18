package worksheet

import "fmt"

// up: docs/en/threads/part-1/3-listening.md, §12 "A Fourteen-Day Listening
// Experiment" (structure only; wording written fresh). Owner, 2026-10-01.
//
// up's table is Day | Action | Evidence. Here the day is the row, the action
// and the evidence to keep are its read-only text, and the learner writes the
// evidence, marks the day done, and on day 5 keeps the delayed-shadow
// recording. The experiment is attached to its main source, a video. Each
// day's row opens on that day, counted from the day the first day is marked:
// day 5 cannot be filled on day 2.

var listeningDays = []string{
	"Choose a real task and a main source, and listen once with no captions. Keep: the raw gist, details, timestamps and conditions.",
	"Build the six-layer error map. Keep: the one to three barriers that cost the task most.",
	"Open the least transcript support on the critical segments. Keep: what you misheard, the transcript, the cause and a new sentence.",
	"Close the text and rebuild the meaning. Keep: a retelling, a process or the result of an action.",
	"Dictate a segment that matters and shadow it a little behind. Keep: where the boundaries and the rhythm differ.",
	"Answer one follow-up you did not expect. Keep: understanding that nothing gave you in advance.",
	"Close the old notes and retest on parallel material. Keep: gist, detail and error categories, side by side.",
	"Keep the topic, change the speaker. Keep: what familiarity changed.",
	"Keep the speaker, change the topic. Keep: what background knowledge changed.",
	"Add one English variety you do not know. Keep: what you recovered and what you were unsure of.",
	"Repair only the barrier that still comes back. Keep: a third problem segment.",
	"Have AI or a peer slip in a caption error or a follow-up. Keep: how you checked it, and why you rejected it.",
	"Finish an action or a handover against the clock. Keep: the decision, who owns it and the next step.",
	"Close every prompt, do a new task, and choose the next cycle. Keep: the evidence for keeping, downgrading or replacing.",
}

func listeningExperimentKind() Kind {
	rows := make([]Row, len(listeningDays))
	actions := make(map[string]string, len(listeningDays))
	var reviews []Review
	var rowReviews []RowReview
	for i, action := range listeningDays {
		key := fmt.Sprintf("day%d", i+1)
		rows[i] = Row{Key: key, Label: fmt.Sprintf("Day %d", i+1)}
		actions[key] = action
		if i == 0 {
			continue
		}
		reviews = append(reviews, Review{Key: key, Label: fmt.Sprintf("Day %d", i+1), Days: i, From: listeningStart})
		rowReviews = append(rowReviews, RowReview{Section: "days", Field: "plan", Row: key, Review: key})
	}
	// Day 5's segment, dictation and shadow are recorded in the video's
	// listening audit, §7.
	rows[4].See = &SeeAlso{Kind: "listening_audit", Section: "segment"}

	return Kind{
		Kind: "listening_experiment", Name: "14-day listening experiment", Group: GroupLanguage, Version: 1,
		Source: "docs/en/threads/part-1/3-listening.md",
		Summary: "Two weeks on one main source, a day at a time: a first pass with no captions, the " +
			"barriers that matter, support added and taken away, dictation and shadowing, changed " +
			"speakers and topics, and a decision on day 14.",
		Attach:        AttachDocument,
		DocumentKinds: []string{"youtube", "media"}, // media: up-methods phase 15
		Reviews:       reviews,
		RowReviews:    rowReviews,
		Sections: []Section{
			{Key: "days", Title: "A fourteen-day listening experiment",
				Hint: "Fourteen days is not a deadline for understanding native speakers. It asks whether, " +
					"once the supports are gone and the material or the speaker changes, the key meaning " +
					"still comes through and you take the right action more reliably than on day 1.",
				Fields: []Field{
					{Key: "plan", Label: "Days", Type: Table, RowHeader: "Day", Rows: rows,
						Columns: []Field{
							{Key: "action", Label: "Action and evidence to keep", Type: Label, Text: actions},
							{Key: "evidence", Label: "Evidence", Type: Text},
							{Key: "done", Label: "Done", Type: YesNo},
							{Key: "recording", Label: "Delayed-shadow recording", Type: Audio, ForRows: []string{"day5"}},
						}},
					{Key: "decision", Label: "Day 14 decision", Type: Choice,
						Options: []string{"keep", "downgrade", "replace"}},
				}},
		},
	}
}

// listeningStart is day 1's "done" cell: every later day counts from the day
// it is first marked.
var listeningStart = Anchor{Section: "days", Field: "plan", Row: "day1", Column: "done"}

func init() { register(listeningExperimentKind()) }
