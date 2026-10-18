package worksheet

// englishDiagnostic follows up's English diagnostic one section to one
// (docs/en/templates/english-diagnostic.md §1–§9 and §2A, at f13ff2d), plus the CEFR self-check
// from docs/en/threads/part-1/0-cefr.md ("A1-C2: What Can I Do?", "Four-skill
// Evidence", "Turn a Level into a Goal", "Carry the Self-check into the Next
// Cycle"), placed before §9 at the owner's request. Structure only: every
// label, hint and option text here is written fresh.
//
// Where it differs from the generated outline, testdata/deviations.txt says
// why: §1's three date lines are the kind's Reviews, §3 gains the date they
// count from, §4's scoring meanings are column help, and the CEFR section is
// added. Section numbers here are up's; the harness counts §2A as its third
// section, so deviations.txt names up's §3 and §4 as §4 and §5.
//
// Version 2 (plans/261017-1828-up-f13ff2d-upgrade, phase 0) adds §2A. A
// version 1 worksheet keeps every answer where it was; its §2A is empty.
var englishDiagnostic = Kind{
	Kind: "english_diagnostic", Name: "English diagnostic", Group: GroupLanguage, Version: 2,
	Source: "docs/en/templates/english-diagnostic.md",
	Summary: "A first, unpolished baseline in listening, reading, speaking and writing on one real topic: " +
		"scores with their evidence, one barrier per skill, one repair, and retests on day 7, day 30 and week 12. " +
		"It points to the next action; it does not hand out a level.",
	Attach: AttachState,
	// up's §1 "Day-7 parallel-task date", "Day-30 retest date" and "Week-12
	// real-task date", counted from the day §3 records the first version.
	Reviews: []Review{
		{Key: "day7", Label: "Day 7: parallel task", Days: 7, From: diagnosticAnchor},
		{Key: "day30", Label: "Day 30: retest", Days: 30, From: diagnosticAnchor},
		{Key: "week12", Label: "Week 12: real task", Days: 84, From: diagnosticAnchor},
	},
	// §7's dated rows open on their review's day (up's delay rule).
	RowReviews: []RowReview{
		{Section: "retest", Field: "timeline", Row: "day7", Review: "day7"},
		{Section: "retest", Field: "timeline", Row: "day30", Review: "day30"},
		{Section: "retest", Field: "timeline", Row: "week12", Review: "week12"},
	},
	Sections: []Section{
		// §1 Define the Diagnostic Boundary.
		{Key: "boundary", Title: "Diagnostic boundary",
			Hint: "Pick one real topic and keep time, difficulty and the standard for \"done\" close enough across the four skills to compare. " +
				"The day-7, day-30 and week-12 dates are counted from the first-version date under \"First version and its conditions\" and appear under Reviews.",
			Fields: []Field{
				{Key: "context", Label: "Real context", Type: Choice,
					Options: []string{"work", "study", "job search", "life"}, Other: true},
				{Key: "topic", Label: "Real topic", Type: Text},
				{Key: "audience", Label: "Audience or conversation partner", Type: Text},
				{Key: "delivery", Label: "Smallest delivery shared by the four skills", Type: Text},
				{Key: "dates", Label: "Start and end dates", Type: Text},
				{Key: "material", Label: "Material, version and source", Type: Text},
				{Key: "limits", Label: "Shared limits (time, device, setting)", Type: Text},
				{Key: "help", Label: "Help allowed: dictionary, captions, translation, search, AI, people", Type: Text},
				{Key: "boundary", Label: "Privacy, copyright, exam and expert-responsibility limits", Type: Text},
			}},
		// §2 Four First-version Tasks: help only, nothing stored.
		{Key: "tasks", Title: "Four first-version tasks",
			Hint: "Do each first version without looking anything up or letting AI answer or rewrite it. Finish first, then mark where you needed help.",
			Fields: []Field{
				{Key: "tasks", Label: "First-version tasks", Type: Table, RowHeader: "Skill", Rows: diagnosticSkills,
					Columns: []Field{
						{Key: "suggested", Label: "Suggested first version", Type: Label, Text: map[string]string{
							"listening": "Listen once to a real clip of 2–4 minutes",
							"reading":   "Read a real text of 600–1000 words",
							"speaking":  "Record a two-minute explanation, story or process without a script",
							"writing":   "Write 180–250 words in 20 minutes: an email, an explanation or an argument",
						}},
						{Key: "minimum", Label: "Minimum delivery", Type: Label, Text: map[string]string{
							"listening": "The main point, three details you are sure of, who does what next, and a 60-second retelling",
							"reading":   "The main line in five lines, one place that supports it, and one challenge or open question",
							"speaking":  "A listener can repeat the purpose, the key facts and the next step",
							"writing":   "The reader knows the conclusion, its support, its limits and what to do",
						}},
					}},
			}},
		// §2A Record Collaboration Dimensions When Needed (added at f13ff2d;
		// docs/en/threads/part-1/0-cefr.md, "Do Not Let a Four-skill Average
		// Hide Collaboration"). up's third column states what the evidence
		// should show; it is the end of each row's read-only sample text, and
		// the learner writes where the evidence is and what happened.
		{Key: "collaboration", Title: "Collaboration dimensions",
			Hint: "Optional. Use it when your goal involves working with people at a distance, talking with customers, " +
				"discussing in class or learning together at home. These are kinds of task, not extra levels, and they need not be " +
				"retested every cycle: keep evidence when one of them changes a real outcome.",
			Fields: []Field{
				{Key: "dimensions", Label: "Collaboration samples", Type: Table, RowHeader: "Task dimension",
					Rows: []Row{
						{Key: "mediation", Label: "Mediation and retelling"},
						{Key: "online", Label: "Online interaction"},
						{Key: "repair", Label: "Repairing misunderstanding"},
					},
					Hint: "When one of these is a high-stakes part of the role, a speaking or writing score does not stand in for it. " +
						"Keep the sample, what the audience said and the next parallel task together.",
					Columns: []Field{
						{Key: "sample", Label: "10–15 minute sample", Type: Label, Text: map[string]string{
							"mediation": "Read two short texts that take different positions, then explain each one's claim, how they differ and what is still unknown. " +
								"It worked when the listener can tell the sources apart from your retelling and from your own inference.",
							"online": "Write one progress update, one blocker and the next step, clear enough for the other person to carry on without a meeting. " +
								"It worked when they know who owns the next step, when it happens and what is still missing.",
							"repair": "Ask a clarifying question, then restate what you both now understand and what is still open. " +
								"It worked when the other person confirms your restatement and the next action rests on it, not on a guess.",
						}},
						{Key: "evidence", Label: "Evidence location and result", Type: Long},
					}},
			}},
		// §3 Preserve the First Version and Conditions.
		{Key: "first_version", Title: "First version and its conditions", Fields: []Field{
			{Key: "first_version_on", Label: "First version recorded on", Type: Date,
				Hint: "The three reviews are counted from this date."},
			{Key: "versions", Label: "First versions", Type: Table, RowHeader: "Skill", Rows: diagnosticSkills,
				Columns: []Field{
					{Key: "location", Label: "Where the first version is kept", Type: Text},
					{Key: "start_end", Label: "Start/end", Type: Text},
					{Key: "tools", Label: "Tools and cues", Type: Text},
					{Key: "completed", Label: "Completed?", Type: YesNo},
					{Key: "uncertainty", Label: "Main uncertainty", Type: Text},
				}},
			{Key: "explain", Label: "What I can still explain on my own", Type: Long},
			{Key: "change", Label: "The condition I would most like to change", Type: Long},
			{Key: "cannot_support", Label: "What this first version cannot show", Type: Long},
		}},
		// §4 Score Impact, Not Feeling. up's "Scoring Meaning" list is each
		// score column's help.
		{Key: "scores", Title: "Scores: effect, not feeling",
			Hint: "Score each from 0 to 2 — " + diagnosticAnchors + " — and give every number a place where its evidence can be found.",
			Fields: []Field{
				{Key: "scores", Label: "Scores", Type: Table, RowHeader: "Skill", Rows: diagnosticSkills,
					Hint: "A total only compares you with yourself over time. It says nothing about personality, intelligence or who to hire.",
					Columns: []Field{
						diagnosticScore("task", "Task completion",
							"Did the information and the intention get through, so the work can go on?"),
						diagnosticScore("comprehensibility", "Comprehensibility",
							"Could a real reader or listener follow without a lot of guessing?"),
						diagnosticScore("accuracy", "Accuracy/range",
							"Did words, grammar, pronunciation, spelling and detail carry the task?"),
						diagnosticScore("organisation", "Organisation/fluency",
							"Did the order, the pauses or the layout get in the way?"),
						diagnosticScore("independence", "Independence/transfer",
							"Does it still work once recent cues are gone and one condition changes?"),
						{Key: "reason", Label: "Evidence reason", Type: Text},
					}},
			}},
		// §5 Choose One Primary Barrier per Skill. The evidence card is a
		// button that opens the matching worksheet (diagnostic-extras.tsx).
		{Key: "barriers", Title: "One primary barrier per skill",
			Hint: "A barrier you cannot tie to a sample or a timestamp is a guess, not a finding yet.",
			Fields: []Field{
				{Key: "barriers", Label: "Primary barriers", Type: Table, RowHeader: "Skill", Rows: diagnosticSkills,
					Columns: []Field{
						{Key: "barrier", Label: "Primary barrier", Type: Choice, RowOptions: map[string][]string{
							"listening": {"vocabulary", "sound", "syntax", "background", "attention", "device"},
							"reading":   {"vocabulary", "structure", "background", "evidence", "layout", "capacity"},
							"speaking":  {"chunks", "pronunciation", "organisation", "interaction", "register", "follow-up"},
							"writing":   {"task", "fact", "structure", "sentence", "register", "delivery"},
						}},
						{Key: "sample", Label: "Sample/timestamp", Type: Text},
						{Key: "impact", Label: "Effect on the task", Type: Text},
						{Key: "repair", Label: "Smallest next repair", Type: Text},
						{Key: "card", Label: "Evidence card", Type: Label, Text: map[string]string{
							"listening": "Listening evidence",
							"reading":   "Reading evidence",
							"speaking":  "Speaking evidence",
							"writing":   "Writing evidence",
						}},
					}},
			}},
		// §6 Design One Targeted Repair.
		{Key: "repair", Title: "One targeted repair",
			Hint: "Protect meaning and task completion first, then facts and structure, then the words, grammar, sounds or tone that change the result.",
			Fields: []Field{
				{Key: "barrier", Label: "The barrier I will repair", Type: Text},
				{Key: "action", Label: "Repair action (25–45 minutes)", Type: Long},
				{Key: "material", Label: "Material and source", Type: Text},
				{Key: "scaffold", Label: "Smallest scaffold allowed", Type: Text},
				{Key: "standard", Label: "Acceptance standard", Type: Text},
				{Key: "samples", Label: "Before and after samples to keep", Type: Text},
				{Key: "feedback", Label: "Feedback that would change the plan", Type: Long},
			}},
		// §7 Delayed Retest and Transfer.
		{Key: "retest", Title: "Delayed retest and transfer",
			Hint: "The Day 7, Day 30 and Week 12 rows open on their review dates.",
			Fields: []Field{
				{Key: "timeline", Label: "Retests", Type: Table, RowHeader: "Time",
					Rows: []Row{{Key: "day1", Label: "Day 1"}, {Key: "day7", Label: "Day 7"},
						{Key: "day30", Label: "Day 30"}, {Key: "week12", Label: "Week 12"}},
					Columns: []Field{
						{Key: "remove", Label: "Remove", Type: Label, Text: map[string]string{
							"day1":   "The answers seen after the first version",
							"day7":   "Recent cues and sentences you reused",
							"day30":  "The tool conversation and its comments",
							"week12": "The old task and its score",
						}},
						{Key: "change", Label: "Change", Type: Label, Text: map[string]string{
							"day1":   "Nothing: the first version's conditions",
							"day7":   "A parallel topic or a different audience",
							"day30":  "A real source, or time pressure",
							"week12": "The role, course or part of life you are aiming at",
						}},
						{Key: "output", Label: "Output", Type: Label, Text: map[string]string{
							"day1":   "A repaired version",
							"day7":   "The same kind of task",
							"day30":  "One real delivery",
							"week12": "A complete task",
						}},
						{Key: "result", Label: "Result/evidence", Type: Long},
					}},
				{Key: "day7_alone", Label: "What I can still do on my own on day 7", Type: Long},
				{Key: "day30_error", Label: "The error still coming back on day 30", Type: Long},
				{Key: "familiar_only", Label: "The skill that only worked on a familiar topic", Type: Long},
				{Key: "extra_time", Label: "Where more time would change the most in my life", Type: Long},
				{Key: "cannot_prove", Label: "What this retest cannot prove", Type: Long},
			}},
		// §8 Record AI, Translation, and Human Feedback.
		{Key: "feedback", Title: "AI, translation and human feedback",
			Hint: "A model answer, a speech-recognition score or a polished final text does not prove ability on its own. Important judgements go back to the original material, the real response and a named person accountable for them.",
			Fields: []Field{
				{Key: "tool", Label: "Tool, model, version and date", Type: Text},
				{Key: "before", Label: "Samples that existed before the tool", Type: Text},
				{Key: "did", Label: "What it did", Type: Multi,
					Options: []string{"diagnosis", "questions", "counterexample", "transcript", "feedback"}, Other: true},
				{Key: "scope", Label: "What it generated or rewrote", Type: Text},
				{Key: "check", Label: "Checked against a source, dictionary, teacher, peer or real audience", Type: Text},
				{Key: "decisions", Label: "Suggestions accepted, rejected or deferred, and why", Type: Long},
				{Key: "independent", Label: "A sample made on my own after closing the tool", Type: Text},
				{Key: "disclosure", Label: "Disclosure a school, client, employer or exam requires", Type: Text},
			}},
		// docs/en/threads/part-1/0-cefr.md. Rating the skills one by one, never
		// averaged, is the chapter's "rate each skill separately"
		// (docs/threads/part-1/0-cefr.md, after the four-skill table).
		{Key: "cefr", Title: "CEFR self-check", Added: true,
			Hint: "A level is a coordinate for one kind of task under certain conditions, not a verdict on you. " +
				"Place each skill on its own: when they differ, they stay different, and nothing here is averaged.",
			Fields: []Field{
				{Key: "levels", Label: "Where each skill is today", Type: Table, RowHeader: "Skill", Rows: diagnosticSkills,
					Columns: []Field{
						{Key: "level", Label: "Level", Type: Choice,
							Options: []string{"A1", "A2", "B1", "B2", "C1", "C2", "not sure"},
							// The Council of Europe's global scale (CEFR 3.3), summarised fresh.
							Hint: "A1: follows and uses everyday phrases about immediate needs, when the other person speaks slowly and helps.\n" +
								"A2: manages short, routine exchanges on familiar things such as family, shopping, the local area and work.\n" +
								"B1: gets the main points on familiar matters, copes with most travel situations, and gives brief reasons for plans and views.\n" +
								"B2: follows the main ideas of complex texts, including specialist ones in their own field, holds a conversation at a natural pace, and explains a view on a current issue.\n" +
								"C1: understands long, demanding texts and what they imply, and uses the language flexibly for social, study and work purposes.\n" +
								"C2: understands almost everything with ease, pulls several sources into one coherent account, and conveys fine shades of meaning."},
					}},
				// "Turn a Level into a Goal": its five parts.
				{Key: "goal_context", Label: "Goal: context", Type: Text},
				{Key: "goal_task", Label: "Goal: task", Type: Text},
				{Key: "goal_threshold", Label: "Goal: quality threshold", Type: Text},
				{Key: "goal_deadline", Label: "Goal: deadline", Type: Date},
				{Key: "goal_evidence", Label: "Goal: evidence", Type: Text},
				// "Carry the Self-check into the Next Cycle": its four steps.
				{Key: "baseline_saved", Label: "Today's baseline is kept, not replaced by the revised version", Type: Check},
				{Key: "immediate_recorded", Label: "Performance right after practice is noted, with the help it had", Type: Check},
				{Key: "delayed_retest", Label: "Retested after seven days, with the recent prompts removed", Type: Check},
				{Key: "transfer_check", Label: "Transfer checked after thirty or ninety days, with a new topic, audience or task", Type: Check},
			}},
		// §9 Decide the Next Cycle.
		{Key: "next", Title: "Next cycle", Fields: []Field{
			{Key: "direction", Label: "Current direction per component (not a fixed level)", Type: Text},
			{Key: "strongest", Label: "Strongest real evidence", Type: Text},
			{Key: "weakest", Label: "Weakest evidence with the largest effect on my life", Type: Text},
			{Key: "continue", Label: "Continue", Type: Text},
			{Key: "downgrade", Label: "Downgrade", Type: Text},
			{Key: "change", Label: "Variable to change", Type: Text},
			{Key: "pause", Label: "Pause or ask for help", Type: Text},
			{Key: "next_task", Label: "Smallest next task", Type: Text},
			{Key: "next_review", Label: "Next review date", Type: Date},
		}},
	},
}

// diagnosticAnchor is §3's first-version date.
var diagnosticAnchor = Anchor{Section: "first_version", Field: "first_version_on"}

// diagnosticSkills are the rows of every per-skill table, in up's order.
var diagnosticSkills = []Row{
	{Key: "listening", Label: "Listening"},
	{Key: "reading", Label: "Reading"},
	{Key: "speaking", Label: "Speaking"},
	{Key: "writing", Label: "Writing"},
}

// diagnosticAnchors are up's three score anchors. They are the section's
// help rather than each cell's labels: twenty cells of a 4×5 table would
// repeat them sixty times.
const diagnosticAnchors = "0: no evidence, or not finished; 1: partly, with cues, or unsteady; 2: on your own under today's conditions"

// diagnosticScore is one of §4's 0–2 columns; its help is up's meaning of
// that column.
func diagnosticScore(key, label, hint string) Field {
	return Field{Key: key, Label: label, Type: Score, Hint: hint}
}

func init() { register(englishDiagnostic) }
