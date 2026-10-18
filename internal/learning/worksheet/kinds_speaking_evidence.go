package worksheet

// up: docs/en/templates/speaking-evidence.md, §1–§10 (structure only; wording
// written fresh), plus the shadowing ladder from
// docs/en/threads/part-1/5-speaking.md §6, which the card does not contain
// (owner, 2026-10-01; testdata/deviations.txt).
//
// The card keeps raw recordings: three unscripted baselines, the shadowing
// levels and the delayed retests are `audio` cells holding the learner's own
// takes (recordings.go). Its retests count from the day the monologue
// baseline is first recorded, and each retest row opens on its date.

var speakingScores = []string{"not completed", "needs prompts or unstable", "completed under this condition"}

var speakingEvidence = Kind{
	Kind: "speaking_evidence", Name: "Speaking evidence", Group: GroupLanguage, Version: 1,
	Source: "docs/en/templates/speaking-evidence.md",
	Summary: "One real speaking situation, recorded as it is: three unscripted baselines, what listeners " +
		"actually took away, the few problems that cost them most, repair, and retests days later under " +
		"changed conditions.",
	Attach: AttachState,
	Reviews: []Review{
		// Counted from the day the monologue baseline is first recorded.
		{Key: "days_3_7", Label: "Days 3–7 retest", Days: 5, From: monologueTake},
		{Key: "day14", Label: "Day 14 retest", Days: 14, From: monologueTake},
		{Key: "day30", Label: "Day 30 retest", Days: 30, From: monologueTake},
	},
	RowReviews: []RowReview{
		{Section: "retests", Field: "retest", Row: "day3_7", Review: "days_3_7"},
		{Section: "retests", Field: "retest", Row: "day14", Review: "day14"},
		{Section: "retests", Field: "retest", Row: "day30", Review: "day30"},
	},
	Sections: []Section{
		// §1
		{Key: "task", Title: "Task, listener and boundary",
			Hint: "One real situation per card. Write what counts as done in terms of the listener — " +
				"they can say back the risk and the next step — not in terms of sounding fluent. " +
				"These takes stay private; use made-up details when a client, a relative or an " +
				"unreleased project would otherwise be on the recording.",
			Fields: []Field{
				{Key: "situation", Label: "Real situation", Type: Text},
				{Key: "task", Label: "Task", Type: Choice,
					Options: []string{"explain", "answer", "repair", "collaborate", "transfer"}},
				{Key: "listener", Label: "Listener and relationship", Type: Text},
				{Key: "listener_outcome", Label: "What the listener must know or do afterwards", Type: Text},
				{Key: "time_limit", Label: "Time limit", Type: Text},
				{Key: "allowed", Label: "Notes, retakes, captions, dictionary or AI allowed", Type: Text},
				{Key: "permission", Label: "Recording and upload permission", Type: Text},
				{Key: "keep_private", Label: "Content that must stay private", Type: Text},
			}},
		// §2
		{Key: "conditions", Title: "Reference variety and technical conditions",
			Hint: "When the device, the network or the listener's familiarity changes, part of any " +
				"difference in the result belongs to that change, not to your speaking.",
			Fields: []Field{
				{Key: "variety", Label: "Reference variety or audio source now", Type: Text},
				{Key: "why_fits", Label: "Why it fits", Type: Text},
				{Key: "recognise_only", Label: "Differences I only need to recognise, not imitate", Type: Text},
				{Key: "other_varieties", Label: "Other varieties added this cycle", Type: Text},
				{Key: "device", Label: "Device and microphone", Type: Text},
				{Key: "room", Label: "Network and room noise", Type: Text},
				{Key: "platform", Label: "Recording or call platform", Type: Text},
				{Key: "familiarity", Label: "Listener's familiarity with the topic and my accent", Type: Text},
			}},
		// §3
		{Key: "baselines", Title: "Three unscripted baselines",
			Hint: "Record before asking anyone, or any AI, for a script, and keep the take untouched: " +
				"pauses and background noise stay in. A baseline is what is left once the support is gone.",
			Fields: []Field{
				{Key: "samples", Label: "Baselines", Type: Table, RowHeader: "Sample",
					Rows: []Row{
						{Key: "monologue", Label: "90–120 second monologue"},
						{Key: "exchange", Label: "Five-turn exchange"},
						{Key: "repair", Label: "One interaction repair"},
					},
					Columns: []Field{
						{Key: "condition", Label: "Condition", Type: Label, Text: map[string]string{
							"monologue": "A real experience or problem, explained with no script",
							"exchange":  "At least one follow-up question you did not expect",
							"repair":    "Ask for a repeat, confirm the scope, rephrase or sum up",
						}},
						{Key: "recording", Label: "Recording", Type: Audio},
						{Key: "first_break", Label: "First break", Type: Text},
						{Key: "completed", Label: "Task completed?", Type: YesNo},
					}},
				{Key: "main_point", Label: "Main point in one sentence", Type: Text},
				{Key: "two_details", Label: "Two details the listener must hear", Type: Text},
				{Key: "critical", Label: "Critical number, time, owner or condition", Type: Text},
				{Key: "expected_misunderstanding", Label: "Where I most expect to be misunderstood", Type: Text},
			}},
		// §4, with the chapter's §4 distinction as its hint.
		{Key: "listeners", Title: "What the listener actually heard",
			Hint: "Play the recording to the listener before they see any transcript. Keep three things " +
				"apart. Accent is how different the speech sounds from what this listener is used to. " +
				"Intelligibility is how much of the wording and meaning they actually got back. " +
				"Comprehensibility is how hard they had to work for it — replaying, guessing, checking. " +
				"A noticeable accent can be easy to follow, and a polished one can still lose the task. " +
				"One reaction is not a verdict: use two listeners, another device or a new topic.",
			Fields: []Field{
				{Key: "heard", Label: "Listener retellings", Type: Table, RowHeader: "Listener or condition",
					Rows: []Row{
						{Key: "a", Label: "Listener A"},
						{Key: "b", Label: "Listener B or a new device"},
					},
					Columns: []Field{
						{Key: "gist", Label: "Retold gist", Type: Text},
						{Key: "details", Label: "Retold details", Type: Text},
						{Key: "replay", Label: "Guess or replay point", Type: Text},
						{Key: "next", Label: "Next response", Type: Text},
					}},
				{Key: "accent_ok", Label: "Noticeable accent that stayed intelligible", Type: Text},
				{Key: "meaning_lost", Label: "Where meaning was actually lost", Type: Text},
				{Key: "effort", Label: "Where it took effort but was not misunderstood", Type: Text},
				{Key: "bias", Label: "Familiarity or bias that may colour the feedback", Type: Text},
			}},
		// §5
		{Key: "problems", Title: "High-impact problem map",
			Hint: "Choose one to three. A difference that only marks your variety, your region or your " +
				"own voice, and costs the listener nothing, can be noted and left alone.",
			Fields: []Field{
				{Key: "map", Label: "Problems", Type: Table, MaxRows: 3,
					Columns: []Field{
						{Key: "segment", Label: "Segment or time", Type: Text},
						{Key: "may_hear", Label: "Listener may hear", Type: Text},
						{Key: "intended", Label: "Intended meaning", Type: Text},
						{Key: "type", Label: "Type", Type: Choice, Options: []string{
							"sound", "ending", "stress", "pause", "chunk", "grammar", "organisation"}},
						{Key: "impact", Label: "Task impact", Type: Choice, Options: []string{
							"meaning-changing", "task-blocking", "recurring", "effortful", "low-impact difference"}},
						{Key: "action", Label: "This cycle's action", Type: Text},
					}},
			}},
		// §6
		{Key: "chunks", Title: "From chunks to unfamiliar follow-ups",
			Hint: "If the fluency only exists inside a memorised script, memorise fewer whole sentences " +
				"and rebuild more from keywords, then answer follow-ups.",
			Fields: []Field{
				{Key: "chunks", Label: "Five replaceable chunks", Type: Long, Hint: "One per line."},
				{Key: "topic_variation", Label: "Topic variation", Type: Text},
				{Key: "position_variation", Label: "Position variation", Type: Text},
				{Key: "listener_variation", Label: "Listener variation", Type: Text},
				{Key: "follow_up", Label: "Unfamiliar follow-up", Type: Text},
				{Key: "unscripted", Label: "Unscripted answer", Type: Long},
			}},
		// The speaking chapter's §6: from imitation to generation.
		{Key: "shadowing", Title: "Shadowing ladder", Added: true,
			Hint: "Shadowing shows you sounds, rhythm and pauses, but someone else chose every word and " +
				"the order they come in. Take one piece of material up these five levels, from copying " +
				"it to producing it yourself.",
			Fields: []Field{
				{Key: "material", Label: "Material and its source", Type: Text},
				{Key: "ladder", Label: "Levels", Type: Table, RowHeader: "Level",
					Rows: []Row{
						{Key: "mark", Label: "1. Listen and mark"},
						{Key: "read", Label: "2. Read aloud"},
						{Key: "delayed", Label: "3. Delayed shadow"},
						{Key: "retell", Label: "4. Close and retell"},
						{Key: "follow_up", Label: "5. Answer an unfamiliar follow-up"},
					},
					Columns: []Field{
						{Key: "job", Label: "What this level asks", Type: Label, Text: map[string]string{
							"mark":      "Note the gist, the stressed words, the pauses and what you could not catch.",
							"read":      "Make the text clear; there is no need to copy every detail of the voice.",
							"delayed":   "Stay a little behind the audio and notice its rhythm without racing it.",
							"retell":    "Put the material away and keep its meaning in your own word order.",
							"follow_up": "Answer a question the material itself never gave you.",
						}},
						{Key: "recording", Label: "Recording", Type: Audio},
						{Key: "noticed", Label: "What I noticed", Type: Text},
						{Key: "held", Label: "Held", Type: YesNo},
					}},
				{Key: "keyword_1", Label: "Remembered keyword 1", Type: Text, ShowWhen: retellFailed,
					Hint: "Level four did not hold. More shadowing will not fix that: make the material " +
						"shorter, carry less information, and rebuild it from three keywords you still remember."},
				{Key: "keyword_2", Label: "Remembered keyword 2", Type: Text, ShowWhen: retellFailed},
				{Key: "keyword_3", Label: "Remembered keyword 3", Type: Text, ShowWhen: retellFailed},
			}},
		// §7
		{Key: "repair", Title: "Interaction repair",
			Hint: "Repair is part of speaking, not a penalty. What to train on is the misunderstanding " +
				"you did not notice, or the one you noticed and could not bring back on track.",
			Fields: []Field{
				{Key: "repairs", Label: "Breaks and repairs", Type: Table, MaxRows: 10,
					Columns: []Field{
						{Key: "break", Label: "Break", Type: Choice, Options: []string{
							"not heard", "scope unclear", "thinking needed", "expression failed", "agreement unstable"}},
						{Key: "noticed", Label: "How I noticed", Type: Text},
						{Key: "action", Label: "Repair action", Type: Text},
						{Key: "response", Label: "Listener response", Type: Text},
						{Key: "confirmed", Label: "How shared understanding was confirmed", Type: Text},
					}},
				{Key: "ask", Label: "My request to repeat or confirm", Type: Text},
				{Key: "rephrase", Label: "My rephrasing", Type: Text},
				{Key: "summary", Label: "My final summary of what we agreed", Type: Text},
				{Key: "next_change", Label: "If the repair failed, the one change for next time", Type: Text},
			}},
		// §8
		{Key: "feedback", Title: "Teacher, listener and AI feedback",
			Hint: "Recognition scores move with the microphone, the noise, the network, the model and the " +
				"accent. Treat them as hints, not results.",
			Fields: []Field{
				{Key: "reviewer", Label: "Reviewer, tool or model, with version and date", Type: Text},
				{Key: "input", Label: "Did it use the raw audio or a transcript?", Type: Text},
				{Key: "asr_errors", Label: "Speech-recognition transcript errors", Type: Text},
				{Key: "high_impact", Label: "Problems it marked as high impact", Type: Text},
				{Key: "separated", Label: "Did it keep accent, misunderstanding, effort, grammar, register and style apart?", Type: Text},
				{Key: "checked", Label: "Checked against dictionary audio, a teacher or a real listener", Type: Text},
				{Key: "accepted", Label: "What I accepted or rejected, and why", Type: Long},
			}},
		// §9
		{Key: "retests", Title: "Delayed retention and transfer",
			Hint: "Each row opens on its day, counted from the day the monologue baseline was recorded.",
			Fields: []Field{
				{Key: "retest", Label: "Retests", Type: Table, RowHeader: "Time",
					Rows: []Row{
						{Key: "day1", Label: "Day 1"},
						{Key: "day3_7", Label: "Days 3–7"},
						{Key: "day14", Label: "Day 14"},
						{Key: "day30", Label: "Day 30"},
					},
					Columns: []Field{
						{Key: "removed", Label: "What is removed", Type: Label, Text: map[string]string{
							"day1":   "Any script written by AI",
							"day3_7": "The old script and the model audio",
							"day14":  "The latest feedback",
							"day30":  "Every practice prompt",
						}},
						{Key: "condition", Label: "Changed condition", Type: Label, Text: map[string]string{
							"day1":   "The original situation; a first take and a retake",
							"day3_7": "A new topic or listener; 90–120 seconds and a follow-up",
							"day14":  "A new device, accent or time pressure; explain a collaboration or a decision",
							"day30":  "A real meeting, interview or conversation; the whole task",
						}},
						{Key: "recording", Label: "Output recording", Type: Audio},
						{Key: "output", Label: "Output", Type: Text},
						{Key: "listener", Label: "Listener result", Type: Text},
					}},
				{Key: "retrievable", Label: "What I could still retrieve after seven days", Type: Text},
				{Key: "failed_again", Label: "What failed again once conditions changed", Type: Text},
				{Key: "less_replay", Label: "Did the listener guess or replay less?", Type: Text},
				{Key: "next_variable", Label: "Next variable", Type: Text},
			}},
		// §10
		{Key: "score", Title: "Score and decide",
			Fields: []Field{
				{Key: "scores", Label: "Scores", Type: Table, RowHeader: "Item",
					Rows: []Row{
						{Key: "task", Label: "Completes the task and its main line"},
						{Key: "recovers", Label: "Listener recovers the critical information"},
						{Key: "no_replay", Label: "Understood without repeated guessing or replay"},
						{Key: "follow_up", Label: "Handles an unfamiliar follow-up"},
						{Key: "repair", Label: "Notices and repairs a break"},
						{Key: "transfer", Label: "Still completes it after the listener, device or topic changes"},
					},
					Columns: []Field{
						{Key: "day1", Label: "Day 1", Type: Score, ScoreLabels: speakingScores},
						{Key: "day7", Label: "Day 7", Type: Score, ScoreLabels: speakingScores},
						{Key: "day14", Label: "Day 14", Type: Score, ScoreLabels: speakingScores},
						{Key: "reason", Label: "Evidence reason", Type: Text},
					}},
				{Key: "supports", Label: "Current evidence supports", Type: Choice, Options: []string{
					"continue the same problem", "add variation", "move to another problem", "pause"}},
				{Key: "key_evidence", Label: "Most important evidence", Type: Text},
				{Key: "cannot_conclude", Label: "Conclusion I still cannot draw", Type: Text},
				{Key: "next_task", Label: "Smallest next task", Type: Text},
				{Key: "next_review", Label: "Next review date", Type: Date},
			}},
	},
}

// monologueTake is the monologue baseline's recording cell: the retests
// count from the day it is first filled.
var monologueTake = Anchor{Section: "baselines", Field: "samples", Row: "monologue", Column: "recording"}

// retellFailed shows the rebuild lines once level four is marked "not held".
var retellFailed = &Condition{Field: "ladder", Row: "retell", Column: "held", Equals: false}

func init() { register(speakingEvidence) }
