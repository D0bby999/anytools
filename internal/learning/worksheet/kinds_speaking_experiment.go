package worksheet

import "fmt"

// up: docs/en/threads/part-1/5-speaking.md, §11 "A Fourteen-Day Speaking
// Experiment" (structure only; wording written fresh). Owner, 2026-10-01.
//
// up's table is Day | Action | Evidence. Here the day is the row, the action
// and the evidence to keep are its read-only text, and the learner writes the
// evidence, keeps a recording on the days whose evidence is one (1, 4, 5, 7,
// 9, 11 and 12), and marks the day done. Each day's row opens on that day,
// counted from the day the first day is marked: day 7 cannot be filled on
// day 2.

var experimentDays = []struct{ key, action string }{
	{"day1", "Pick one real situation and record a monologue and a five-turn exchange. Keep: the raw audio, the conditions, what the listener retold."},
	{"day2", "Choose a reference variety and a reliable audio source. Keep: why you chose it, and the differences you will not imitate."},
	{"day3", "Find one pronunciation or rhythm problem that really costs the listener. Keep: the segment and what it does to the task."},
	{"day4", "Practise the contrast, then say it slowly, in a short sentence and in a sentence you have not seen. Keep: a recording of each."},
	{"day5", "Read the same material aloud, shadow it a little behind, then retell it from memory. Keep: where copying and producing differ."},
	{"day6", "Build five chunks you can swap in and out. Keep: three variations on the topic."},
	{"day7", "Drop the old script and do the first delayed retest. Keep: a 90–120 second recording on a new topic."},
	{"day8", "Ask a partner to cause one hearing or scope break. Keep: how you repaired it and how you confirmed it."},
	{"day9", "Change the listener or the device. Keep: the listener's retelling under the new conditions."},
	{"day10", "Listen to a variety of the language you do not know and retell it. Keep: the gist, the details and what you were unsure of."},
	{"day11", "Repair only the problem that still comes back. Keep: the third version, and the low-impact advice you set aside."},
	{"day12", "Have AI or a partner ask three follow-ups you did not expect. Keep: the unscripted answers and the transcript errors."},
	{"day13", "Explain a collaboration or a decision against the clock. Keep: the conclusion, who owns it and the next step."},
	{"day14", "Close every prompt, handle a new situation, and choose the next cycle. Keep: the evidence for keeping, adjusting or moving on."},
}

// The days whose evidence is a recording.
var experimentRecordedDays = []string{"day1", "day4", "day5", "day7", "day9", "day11", "day12"}

func speakingExperimentKind() Kind {
	rows := make([]Row, len(experimentDays))
	actions := make(map[string]string, len(experimentDays))
	var reviews []Review
	var rowReviews []RowReview
	for i, d := range experimentDays {
		rows[i] = Row{Key: d.key, Label: fmt.Sprintf("Day %d", i+1)}
		actions[d.key] = d.action
		if i == 0 {
			continue
		}
		reviews = append(reviews, Review{Key: d.key, Label: fmt.Sprintf("Day %d", i+1), Days: i, From: experimentStart})
		rowReviews = append(rowReviews, RowReview{Section: "days", Field: "plan", Row: d.key, Review: d.key})
	}
	// Day 5 is the shadowing ladder's material, read, shadowed and retold.
	rows[4].See = &SeeAlso{Kind: "speaking_evidence", Section: "shadowing"}

	return Kind{
		Kind: "speaking_experiment", Name: "14-day speaking experiment", Group: GroupLanguage, Version: 1,
		Source: "docs/en/threads/part-1/5-speaking.md",
		Summary: "Two weeks on one real speaking situation, a day at a time: baselines, one problem that " +
			"matters, shadowing turned into retelling, repair, changed listeners, and a decision on day 14.",
		Attach:     AttachState,
		Reviews:    reviews,
		RowReviews: rowReviews,
		Sections: []Section{
			{Key: "days", Title: "A fourteen-day speaking experiment",
				Hint: "Fourteen days is not a deadline for fluency. It asks something smaller: once the familiar " +
					"script is gone, the listener changes or a follow-up arrives, does this way of saying it " +
					"still work?",
				Fields: []Field{
					{Key: "plan", Label: "Days", Type: Table, RowHeader: "Day", Rows: rows,
						Columns: []Field{
							{Key: "action", Label: "Action and evidence to keep", Type: Label, Text: actions},
							{Key: "evidence", Label: "Evidence", Type: Text},
							{Key: "recording", Label: "Recording", Type: Audio, ForRows: experimentRecordedDays},
							{Key: "done", Label: "Done", Type: YesNo},
						}},
					{Key: "decision", Label: "Day 14 decision", Type: Choice,
						Options: []string{"keep", "adjust", "move on"}},
				}},
		},
	}
}

// experimentStart is day 1's "done" cell: every later day counts from the
// day it is first marked.
var experimentStart = Anchor{Section: "days", Field: "plan", Row: "day1", Column: "done"}

func init() { register(speakingExperimentKind()) }
