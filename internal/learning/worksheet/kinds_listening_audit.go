package worksheet

import (
	"fmt"
	"regexp"
)

// up: docs/en/templates/listening-audit.md, §1–§10 (structure only; wording
// written fresh), with the listening chapter's dictation table
// (docs/en/threads/part-1/3-listening.md §7) under §7, and the delayed-shadow
// line kept as a recording (owner, 2026-10-01; testdata/deviations.txt).
//
// The card is attached to the video it audits. The video page reads its
// scaffold ladder (§5) to decide whether the transcript is on screen
// (ui/web/app/lib/ladder.ts); that is a page behaviour, and nothing here
// knows about it. The retests count from the day the no-caption first pass is
// first written down, and each retest row opens on its date.

var listeningAudit = Kind{
	Kind: "listening_audit", Name: "Listening audit", Group: GroupLanguage, Version: 1,
	Source: "docs/en/templates/listening-audit.md",
	Summary: "One video, listened to properly: a first pass with no captions, a map of where meaning " +
		"was lost and why, a ladder of support that is taken away again, dictation of the segments " +
		"that matter, and retests days later on new material.",
	Attach:        AttachDocument,
	DocumentKinds: []string{"youtube", "media"}, // media: up-methods phase 15
	Reviews: []Review{
		// Counted from the day the first pass's gist is first written.
		{Key: "days_3_7", Label: "Days 3–7 retest", Days: 5, From: firstPass},
		{Key: "day_14", Label: "Day 14 retest", Days: 14, From: firstPass},
		{Key: "day_30", Label: "Day 30 retest", Days: 30, From: firstPass},
	},
	RowReviews: []RowReview{
		{Section: "retests", Field: "retest", Row: "days_3_7", Review: "days_3_7"},
		{Section: "retests", Field: "retest", Row: "day_14", Review: "day_14"},
		{Section: "retests", Field: "retest", Row: "day_30", Review: "day_30"},
	},
	Check: checkListeningTimes,
	Sections: []Section{
		// §1
		{Key: "task", Title: "Task and real-world boundary",
			Hint: "Practice may take the supports away; a real task should keep the confirmations it " +
				"needs to be safe. Leave out passwords, client details and any recording you were not " +
				"allowed to keep.",
			Fields: []Field{
				{Key: "situation", Label: "Real situation", Type: Text},
				{Key: "task", Label: "Task", Type: Choice,
					Options: []string{"gist", "detail", "relationship", "action", "interaction", "transfer"}},
				{Key: "afterwards", Label: "What I must answer, decide or do afterwards", Type: Text},
				{Key: "standard", Label: "Completion standard", Type: Text},
				{Key: "allowed", Label: "Confirmation, captions and written support allowed in the real task", Type: Text},
				{Key: "permission", Label: "Permission to record, upload, transcribe and share", Type: Text},
			}},
		// §2
		{Key: "material", Title: "Material and conditions",
			Hint: "A different video is not yet a comparable test. Keep the task and the rough difficulty " +
				"close, so a change in the result says something about your listening.",
			Fields: []Field{
				{Key: "main_source", Label: "Main source: title, origin and date accessed", Type: Text},
				{Key: "parallel_source", Label: "Parallel source: title, origin and date accessed", Type: Text},
				{Key: "segment_length", Label: "Segment length", Type: Text},
				{Key: "transcript", Label: "Reliable English transcript", Type: Choice,
					Options: []string{"human", "automatic, needs checking", "none"}},
				{Key: "familiarity", Label: "How familiar the topic, speaker and accent are", Type: Text},
				{Key: "environment", Label: "Device, network and room noise", Type: Text},
				{Key: "retention", Label: "Copyright and what I may keep", Type: Text},
				{Key: "why_return", Label: "Why I will come back to it in the next seven days", Type: Text},
				{Key: "conditions", Label: "Conditions compared", Type: Table, RowHeader: "Condition",
					Rows: []Row{
						{Key: "task", Label: "Task and difficulty"},
						{Key: "density", Label: "Length and information density"},
						{Key: "transcript", Label: "Transcript quality"},
						{Key: "familiarity", Label: "Speaker and accent familiarity"},
						{Key: "device", Label: "Device and environment"},
					},
					Columns: []Field{
						{Key: "main", Label: "Main source", Type: Text},
						{Key: "parallel", Label: "Parallel source", Type: Text},
						{Key: "comparable", Label: "Comparable?", Type: YesNo},
					}},
			}},
		// §3
		{Key: "first_pass", Title: "First pass, no captions",
			Hint: "Write this before any replay or caption check, and leave it as it is afterwards: " +
				"it is what every later pass is compared with.",
			Fields: []Field{
				{Key: "permission", Label: "Allowed on the first pass", Type: Multi,
					Options: []string{"pause", "speed", "captions", "notes", "replay"}},
				{Key: "gist", Label: "Gist in one sentence", Type: Text},
				{Key: "details", Label: "Three details I am sure of", Type: Text},
				{Key: "stance", Label: "The speaker's stance or purpose", Type: Text},
				{Key: "critical", Label: "Critical number, time, person or condition", Type: Text},
				{Key: "uncertain", Label: "Timestamps I am unsure about", Type: Text},
				{Key: "action", Label: "What I would do based on what I heard", Type: Text},
				{Key: "location", Label: "Where the first-pass answer is kept", Type: Text},
			}},
		// §4
		{Key: "errors", Title: "Six-layer error map",
			Hint: "Not every miss is \"I did not understand\". For each place it went wrong, say which " +
				"layer stopped you and what it cost the task.",
			Fields: []Field{
				{Key: "map", Label: "Error map", Type: Table, MaxRows: 30,
					Columns: []Field{
						{Key: "timestamp", Label: "Timestamp", Type: Text, Hint: "MM:SS or H:MM:SS"},
						{Key: "heard", Label: "I thought I heard", Type: Text},
						{Key: "reliable", Label: "Reliable content", Type: Text},
						{Key: "layer", Label: "Barrier layer", Type: Choice, Options: []string{
							"technical", "unknown language", "known but not heard", "structure and reference",
							"background and inference", "attention and capacity"}},
						{Key: "impact", Label: "Task impact", Type: Choice, Options: []string{
							"meaning-changing", "task-blocking", "recurring", "effortful", "low-impact"}},
						{Key: "action", Label: "This cycle's action", Type: Text},
					}},
				{Key: "top_problems", Label: "The one to three problems that cost the task most", Type: Text},
				{Key: "low_impact", Label: "Missing words that cost little, left for now", Type: Text},
				{Key: "device_effects", Label: "Device or tiredness effects that are not my listening", Type: Text},
			}},
		// §5
		{Key: "ladder", Title: "Scaffold ladder",
			Hint: "Support goes up one rung at a time and comes down again. On this video's page the " +
				"transcript stays out of sight for stages 1 and 2, comes back at stage 3, and goes " +
				"away again for stage 5.",
			Fields: []Field{
				{Key: "stages", Label: "Stages", Type: Table, RowHeader: "Stage",
					Rows: []Row{
						{Key: "stage1", Label: "1"},
						{Key: "stage2", Label: "2"},
						{Key: "stage3", Label: "3"},
						{Key: "stage4", Label: "4"},
						{Key: "stage5", Label: "5"},
						{Key: "stage6", Label: "6"},
					},
					Columns: []Field{
						{Key: "action", Label: "Action", Type: Label, Text: map[string]string{
							"stage1": "Listen once with no captions",
							"stage2": "Replay only the 5–20 second segment that went wrong",
							"stage3": "Open the English transcript to check boundaries and structure",
							"stage4": "Look up the least you need: a definition, background or a translation",
							"stage5": "Close the text and listen again at normal speed",
							"stage6": "Three to seven days later, drop the old support and retest on parallel material",
						}},
						{Key: "visible", Label: "What became visible", Type: Text},
						{Key: "unproven", Label: "What is still unproven", Type: Text},
					}},
				{Key: "caption_errors", Label: "Errors in the automatic captions", Type: Text},
				{Key: "translation_helped", Label: "What the translation helped with", Type: Text},
				{Key: "still_triggered", Label: "Meaning that still came through once the text was closed", Type: Text},
				{Key: "caption_only", Label: "Segments I understood only while the captions were on", Type: Text},
			}},
		// §6
		{Key: "passes", Title: "Five passes, five kinds of evidence",
			Hint: "The number of plays is not a result. Each pass should give a new judgement, or show " +
				"that it is time to stop repeating.",
			Fields: []Field{
				{Key: "passes", Label: "Passes", Type: Table, RowHeader: "Pass",
					Rows: []Row{
						{Key: "pass1", Label: "1"},
						{Key: "pass2", Label: "2"},
						{Key: "pass3", Label: "3"},
						{Key: "pass4", Label: "4"},
						{Key: "pass5", Label: "5"},
					},
					Columns: []Field{
						{Key: "question", Label: "Question", Type: Label, Text: map[string]string{
							"pass1": "What did I expect, and what did I get back?",
							"pass2": "Where exactly did it differ?",
							"pass3": "What did the least support explain?",
							"pass4": "Does the sound carry the meaning once support is gone?",
							"pass5": "Can I rebuild it and act on it?",
						}},
						{Key: "output", Label: "Output", Type: Label, Text: map[string]string{
							"pass1": "The raw gist and details",
							"pass2": "Timestamp and barrier layer",
							"pass3": "What I misheard, the transcript, and why",
							"pass4": "A replay with no text",
							"pass5": "A retelling, a process, a decision or a handover",
						}},
						{Key: "result", Label: "Result", Type: Text},
					}},
			}},
		// §7, with the chapter's §7 dictation table.
		{Key: "segment", Title: "From dictation and shadowing to your own words",
			Hint: "If the shadowing runs smoothly but the retelling comes out empty, copy less and " +
				"rebuild more from keywords. If every word is written correctly and the gist is still " +
				"missing, go back to the structure and how the parts relate. While you write the " +
				"retelling, this page puts the transcript away.",
			Fields: []Field{
				{Key: "start", Label: "High-impact segment: start", Type: Text,
					Hint: "MM:SS or H:MM:SS. Choose 5–20 seconds that change the task."},
				{Key: "end", Label: "High-impact segment: end", Type: Text, Hint: "MM:SS or H:MM:SS"},
				{Key: "dictation", Label: "My dictation", Type: Long},
				{Key: "transcript", Label: "Reliable transcript", Type: Long},
				{Key: "difference", Label: "Where it differs", Type: Multi,
					Options: []string{"boundary", "ending", "reduction", "stress"}},
				{Key: "shadow", Label: "Delayed-shadow recording", Type: Audio,
					Hint: "Play the segment and speak along a little behind it."},
				{Key: "keywords", Label: "Three keywords", Type: Text},
				{Key: "retelling", Label: "Retelling with the text closed", Type: Long},
				{Key: "changed", Label: "Explanation after changing one fact or position", Type: Long},
				{Key: "follow_up", Label: "An unfamiliar follow-up, and my answer", Type: Long},
				{Key: "dictation_table", Label: "Dictation of critical segments", Type: Table, MaxRows: 10,
					Hint: "Only segments that change the task: a number, a negation, a condition, an owner, " +
						"a name, a step, or a chunk you keep mishearing.",
					Columns: []Field{
						{Key: "candidate", Label: "What I heard", Type: Text},
						{Key: "reliable", Label: "Reliable transcript", Type: Text},
						{Key: "cause", Label: "Cause of the difference", Type: Choice, Options: []string{
							"unknown", "segmentation", "reduction", "ending", "attention"}},
						{Key: "retest", Label: "Retest in a new sentence", Type: Text},
					}},
			}},
		// §8
		{Key: "feedback", Title: "AI, teacher and real-task feedback",
			Hint: "An AI or an automatic transcript offers candidates. What was actually said is settled " +
				"against the recording, not by the tool.",
			Fields: []Field{
				{Key: "reviewer", Label: "Tool, reviewer or model, with version and date", Type: Text},
				{Key: "input", Label: "Did it use the raw audio, an automatic transcript or my own?", Type: Text},
				{Key: "category", Label: "The error category it proposed", Type: Text},
				{Key: "invented", Label: "Did it make up wording, background or the speaker's intent?", Type: Text},
				{Key: "teacher", Label: "Teacher or peer check", Type: Text},
				{Key: "real_result", Label: "What happened in the real task: response, action or repair", Type: Text},
				{Key: "accepted", Label: "What I accepted or rejected, and why", Type: Long},
			}},
		// §9
		{Key: "retests", Title: "Delayed retention and transfer",
			Hint: "Each row opens on its day, counted from the day the first pass was written.",
			Fields: []Field{
				{Key: "retest", Label: "Retests", Type: Table, RowHeader: "Time",
					Rows: []Row{
						{Key: "day_1", Label: "Day 1"},
						{Key: "days_3_7", Label: "Days 3–7"},
						{Key: "day_14", Label: "Day 14"},
						{Key: "day_30", Label: "Day 30"},
					},
					Columns: []Field{
						{Key: "removed", Label: "What is removed", Type: Label, Text: map[string]string{
							"day_1":    "Full captions",
							"days_3_7": "The old notes and the transcript",
							"day_14":   "The latest feedback",
							"day_30":   "Every practice prompt",
						}},
						{Key: "condition", Label: "Changed condition", Type: Label, Text: map[string]string{
							"day_1":    "The main source; a first pass and the meaning rebuilt",
							"days_3_7": "The parallel source; gist, detail and action",
							"day_14":   "A new speaker, accent or device; a retelling and an unfamiliar follow-up",
							"day_30":   "A real meeting, course or conversation; the whole task",
						}},
						{Key: "output", Label: "Output", Type: Text},
						{Key: "result", Label: "Result", Type: Text},
					}},
				{Key: "method_kept", Label: "A method I could still use after seven days", Type: Text},
				{Key: "barrier_returned", Label: "A barrier that came back when the material changed", Type: Text},
				{Key: "dependence", Label: "Do I lean less on full captions or translation?", Type: Text},
				{Key: "repair", Label: "Can I ask for a repeat, confirm and hold on to what was agreed more reliably?", Type: Text},
				{Key: "next_variable", Label: "One variable for the next cycle", Type: Text},
			}},
		// §10
		{Key: "score", Title: "Score and decide",
			Fields: []Field{
				{Key: "scores", Label: "Scores", Type: Table, RowHeader: "Item",
					Rows: []Row{
						{Key: "main_line", Label: "Keeps the first pass's main line"},
						{Key: "details", Label: "Recovers critical details and relationships"},
						{Key: "layer", Label: "Locates the barrier layer"},
						{Key: "captions_closed", Label: "Understands once the captions are closed"},
						{Key: "act", Label: "Rebuilds, responds or acts"},
						{Key: "transfer", Label: "Still completes it after the material, speaker or device changes"},
					},
					Columns: []Field{
						{Key: "day1", Label: "Day 1", Type: Score, ScoreLabels: listeningScores},
						{Key: "day7", Label: "Day 7", Type: Score, ScoreLabels: listeningScores},
						{Key: "day14", Label: "Day 14", Type: Score, ScoreLabels: listeningScores},
						{Key: "reason", Label: "Evidence reason", Type: Text},
					}},
				{Key: "supports", Label: "Current evidence supports", Type: Choice, Options: []string{
					"continue the main source", "downgrade to extensive listening", "replace the source",
					"move to another problem"}},
				{Key: "key_evidence", Label: "Most important evidence", Type: Text},
				{Key: "cannot_conclude", Label: "Conclusion I still cannot draw", Type: Text},
				{Key: "next_task", Label: "Smallest next task", Type: Text},
				{Key: "next_review", Label: "Next review date", Type: Date},
			}},
	},
}

// up's 0–2 anchors for the listening card's scores.
var listeningScores = []string{"not completed", "needs prompts or unstable", "completed under this condition"}

// firstPass is the no-caption first pass's gist: the retests count from the
// day it is first written.
var firstPass = Anchor{Section: "first_pass", Field: "gist"}

// A moment in the video, as the page writes it and the player seeks to it:
// MM:SS (minutes may run past 59) or H:MM:SS.
var videoClock = regexp.MustCompile(`^(\d{1,3}:[0-5]\d|\d{1,2}:[0-5]\d:[0-5]\d)$`)

// checkListeningTimes refuses a timestamp the page could not seek to: the
// error map's timestamps and the segment's start and end.
func checkListeningTimes(a Answers, _ string) error {
	for i, row := range tableRows(a["errors"]["map"]) {
		if err := checkClock(fmt.Sprintf("errors.map[%d].timestamp", i), row["timestamp"]); err != nil {
			return err
		}
	}
	for _, key := range []string{"start", "end"} {
		if err := checkClock("segment."+key, a["segment"][key]); err != nil {
			return err
		}
	}
	return nil
}

func checkClock(path string, v any) error {
	s, _ := v.(string)
	if s == "" || videoClock.MatchString(s) {
		return nil
	}
	return &FieldError{Field: path, Reason: "a time in the video is MM:SS or H:MM:SS"}
}

func init() { register(listeningAudit) }
