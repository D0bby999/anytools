package worksheet

import (
	"fmt"
	"strings"
)

// up: docs/en/threads/part-5/after-90-days.md §2 (close the books), §3 (four
// destinations), §9 (three lines), §10 (quarterly review) and §11 (thirty-day
// handover), headed by the day-ninety review of docs/en/templates/90-day-cycle.md
// §7 (structure only; wording written fresh).
//
// §4 (transfer and handover) has no lines of its own in up: its one-condition
// transfer is the destinations table's "changed condition", so the outline is
// generated from §2, §3, §9, §10 and §11. The day-ninety review comes from a
// second file, which the generator cannot read into the same outline: it is
// an Added section, pinned by its own test (testdata/deviations.txt).
//
// A close may name the cycle it closes (Worksheet.CycleID, one close per
// cycle). The next cycle's page offers its continue and transfer rows for
// week 1's question (phase 10 requirement 5).

// Destinations, in up's order.
const (
	DestinationContinue = "continue"
	DestinationTransfer = "transfer"
	DestinationRepair   = "repair"
	DestinationStop     = "stop"
)

// CycleCloseKind is the kind's id.
const CycleCloseKind = "cycle_close"

var cycleClose = Kind{
	Kind: CycleCloseKind, Name: "Cycle close", Group: GroupProjects, Version: 1,
	Source: "docs/en/threads/part-5/after-90-days.md §2, §3, §9–§11; docs/en/templates/90-day-cycle.md §7",
	Summary: "The end of a ninety-day cycle, done in order: the day-ninety review, the books closed on " +
		"ability, artifact, cost and what is still unknown, one destination for every result, three " +
		"lines for the year ahead, the quarterly look at who you are becoming, and thirty days to " +
		"hand everything over before another cycle starts.",
	Attach:      AttachState,
	ClosesCycle: true,
	Reviews: []Review{
		{Key: "handover_end", Label: "End of the thirty-day handover", Days: 30},
	},
	Check: checkCycleClose,
	Sections: []Section{
		// 90-day-cycle.md §7
		{Key: "review", Title: "Day-ninety review", Added: true,
			Hint: "One line each. Write what happened, not what you hoped would happen.",
			Fields: []Field{
				{Key: "delivery", Label: "Final delivery", Type: Text},
				{Key: "changed", Label: "What really changed since the baseline", Type: Text},
				{Key: "recurring", Label: "Errors that still come back", Type: Text},
				{Key: "reader", Label: "What a real reader or user said", Type: Text},
				{Key: "cost", Label: "A cost that could not be kept up", Type: Text},
				{Key: "keep", Label: "One habit to keep next cycle", Type: Text},
				{Key: "stop", Label: "One entry point to stop next cycle", Type: Text},
			}},
		// after-90-days.md §2
		{Key: "books", Title: "Close the books",
			Hint: "Put the evidence side by side first: the day-one baseline, the last sample you finished " +
				"on your own, at least two pieces of real feedback, the error record and what it all cost. " +
				"Then keep the facts. For ability: what you now finish alone, and where you still need a " +
				"prompt. For the artifact: who saw, used or reviewed it, and which problem it solved. For " +
				"cost: time, money, sleep, relationships and chances spent. For the unknowns: which " +
				"samples are too small, and which causes you still cannot name. Hours logged and streaks " +
				"show that you were busy; on their own they do not show that anything transferred.",
			Fields: []Field{
				{Key: "ledger", Label: "The four columns", Type: Table, RowHeader: "Area",
					Rows: []Row{
						{Key: "ability", Label: "Ability"},
						{Key: "artifact", Label: "Artifact"},
						{Key: "cost", Label: "Cost"},
						{Key: "unknowns", Label: "Unknowns"},
					},
					Columns: []Field{
						{Key: "instead", Label: "Do not write this instead", Type: Label, Text: map[string]string{
							"ability":  "\u201cI know it now\u201d",
							"artifact": "\u201cI put a lot of work in\u201d",
							"cost":     "\u201cIt mattered, so the cost does not count\u201d",
							"unknowns": "\u201cKeep going and it will all become clear\u201d",
						}},
						{Key: "facts", Label: "Facts to keep", Type: Long},
					}},
				{Key: "bottleneck", Label: "What did I first take to be the main difficulty, and what turned out to be the real bottleneck?", Type: Long},
				{Key: "remains", Label: "Which improvement is still there once the material and the instant prompts are gone?", Type: Long},
				{Key: "conditions", Label: "Which result only shows up with a familiar task, a familiar tool or ideal conditions?", Type: Long},
				{Key: "users", Label: "Who actually used the work, and what do their actions and feedback show?", Type: Long},
				{Key: "costs", Label: "What did this progress cost, and which of those costs cannot go on?", Type: Long},
				{Key: "remove", Label: "If I started again today, which half of the activity would I drop?", Type: Long},
			}},
		// after-90-days.md §3, with §4's one-condition transfer.
		{Key: "destinations", Title: "One destination for every result",
			Hint: "Continuing is not the default, and stopping is not the failure. Continue when the result " +
				"is worth it, the evidence backs it and the cost can be carried: keep the main line and raise " +
				"one difficulty. Transfer when the base is there but needs a new situation: change the " +
				"audience, the topic, the tool or a constraint. Repair when the direction matters but the " +
				"system around it is damaged: lower the load and mend health, relationships or process " +
				"first. Stop when the value is weak, conditions have changed or the cost is above the " +
				"return: hand it over, keep the lesson and free the time. A stop is finished by three " +
				"actions: the grounds written down, the reusable material archived, and the people it " +
				"affects told.",
			Fields: []Field{
				{Key: "results", Label: "Results", Type: Table, MaxRows: 20,
					Columns: []Field{
						{Key: "result", Label: "Result", Type: Text},
						{Key: "destination", Label: "Destination", Type: Choice, Options: []string{
							DestinationContinue, DestinationTransfer, DestinationRepair, DestinationStop}},
						{Key: "next_step", Label: "Next step", Type: Text},
						{Key: "condition", Label: "Changed condition", Type: Text,
							Hint: "For a transfer: the one condition you change, such as the audience, the topic, " +
								"the tool or a constraint. Change one at a time, so you can see which part of " +
								"the ability came with you."},
						{Key: "basis", Label: "Stop: grounds written down", Type: Text},
						{Key: "archived", Label: "Stop: where reusable material is archived", Type: Text},
						{Key: "told", Label: "Stop: who was told", Type: Text},
					}},
			}},
		// after-90-days.md §9
		{Key: "three_lines", Title: "Three lines for the next year",
			Hint: "Keep three lines that help each other, so ability, work and life stop competing for " +
				"the same hours. Everything else goes on the later list: putting a wish there does not " +
				"make it unimportant, it only keeps it out of this year's commitments.",
			Fields: []Field{
				{Key: "ability", Label: "One ability: what do I want to finish more reliably with the tools and material closed?", Type: Text},
				{Key: "artifact", Label: "One artifact: what will a real person see, use or review before the year ends?", Type: Text},
				{Key: "life", Label: "One life condition: which physical, relational, financial or environmental condition must improve and stay protected?", Type: Text},
				{Key: "later", Label: "Later is still possible", Type: Long},
			}},
		// after-90-days.md §10
		{Key: "quarterly", Title: "Quarterly review",
			Hint: "Once a quarter, look past the output at the person doing the work. These do not add up " +
				"to a score.",
			Fields: []Field{
				{Key: "abilities", Label: "Four abilities", Type: Table, RowHeader: "Ability",
					Rows: []Row{
						{Key: "honesty", Label: "Honesty"},
						{Key: "responsibility", Label: "Responsibility"},
						{Key: "judgment", Label: "Judgment"},
						{Key: "return", Label: "Return"},
					},
					Columns: []Field{
						{Key: "question", Label: "Question", Type: Label, Text: map[string]string{
							"honesty":        "Can I tell fact, interpretation and wish apart more clearly than before?",
							"responsibility": "Have I seen what my choices did to other people, and carried my own share?",
							"judgment":       "Did new evidence actually change the plan, or did I only defend the first conclusion?",
							"return":         "Do I come back sooner after an interruption, with less shame?",
						}},
						{Key: "answer", Label: "Answer", Type: Long},
					}},
				{Key: "note", Label: "A note to myself in three months", Type: Long,
					Hint: "Facts, thanks and one reminder only, with no forecast of how far you will have come: " +
						"which cost not to forget, which people and duties to protect, and where to come " +
						"back to the next time the way disappears."},
			}},
		// after-90-days.md §11
		{Key: "handover", Title: "Thirty-day handover",
			Hint: "These thirty days are not a fourth sprint. They may be slower than the months before, " +
				"and some days should stay unclaimed. When they are over, decide whether to begin another " +
				"ninety days: continue, reduce, turn or stop.",
			Fields: []Field{
				{Key: "stages", Label: "Stages", Type: Table, RowHeader: "Days",
					Rows: []Row{
						{Key: "days_1_7", Label: "Days 1–7"},
						{Key: "days_8_14", Label: "Days 8–14"},
						{Key: "days_15_21", Label: "Days 15–21"},
						{Key: "days_22_30", Label: "Days 22–30"},
					},
					Columns: []Field{
						{Key: "action", Label: "Central action", Type: Label, Text: map[string]string{
							"days_1_7":   "Close the books and recover",
							"days_8_14":  "Transfer and hand over",
							"days_15_21": "Choose and stop",
							"days_22_30": "Set up the next season",
						}},
						{Key: "evidence", Label: "Evidence it is complete", Type: Label, Text: map[string]string{
							"days_1_7":   "Samples, feedback, costs and unknowns sit side by side",
							"days_8_14":  "One test in a new context is done, and someone else can follow or take over the work",
							"days_15_21": "Every result is heading to continue, transfer, repair or stop",
							"days_22_30": "One main line, three layers of boundaries and clear exit gates are written down",
						}},
						{Key: "done", Label: "Done", Type: YesNo},
						{Key: "where", Label: "Where", Type: Text},
					}},
			}},
	},
}

// stopActions are the three actions a stop needs (§3), with what the row
// says is missing.
var stopActions = []struct{ key, name string }{
	{"basis", "the grounds"},
	{"archived", "where the material is archived"},
	{"told", "who was told"},
}

// MissingStopActions names the stop actions a destinations row still lacks,
// in up's order; empty for a row that is not a stop.
func MissingStopActions(cells map[string]any) []string {
	if cellText(cells, "destination") != DestinationStop {
		return nil
	}
	var missing []string
	for _, a := range stopActions {
		if cellText(cells, a.key) == "" {
			missing = append(missing, a.name)
		}
	}
	return missing
}

// checkCycleClose is up's two rules for a destination. A transfer changes one
// condition, so it names it, always. A stop is only finished by its three
// actions, so a close holding an unfinished stop cannot be marked done; while
// it is open the row may be filled in over several days.
func checkCycleClose(a Answers, status string) error {
	for i, row := range tableRows(a["destinations"]["results"]) {
		if cellText(row, "destination") == DestinationTransfer && cellText(row, "condition") == "" {
			return &FieldError{Field: fmt.Sprintf("destinations.results[%d].condition", i),
				Reason: "a transfer changes one condition: name it"}
		}
		if status != StatusDone {
			continue
		}
		if missing := MissingStopActions(row); len(missing) > 0 {
			return &FieldError{Field: fmt.Sprintf("destinations.results[%d]", i),
				Reason: "a stop is finished by three actions before the close is done; still missing: " +
					strings.Join(missing, ", ")}
		}
	}
	return nil
}

func cellText(cells map[string]any, key string) string {
	s, _ := cells[key].(string)
	return strings.TrimSpace(s)
}

func init() { register(cycleClose) }
