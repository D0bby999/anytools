package worksheet

// up: docs/en/templates/interview-evidence.md, §1–§11 (structure only;
// wording written fresh). Phase 8 of plans/260930-0915-up-methods.
//
// The retests count from §3's baseline date: the day-seven retest and the
// day-fourteen transfer, at +7 and +14, and §9's rows for them open on those
// dates (up's delay rule).
//
// One difference from up, listed in testdata/deviations.txt: §5's story bank
// is one free table of up to twelve stories, each row holding up's story
// lines beside the four columns of up's story table.

// InterviewEvidenceKind is the job-search English evidence card's id.
const InterviewEvidenceKind = "interview_evidence"

var interviewEvidence = Kind{
	Kind: InterviewEvidenceKind, Name: "Job-search English evidence", Group: GroupLanguage, Version: 1,
	Source: "docs/en/templates/interview-evidence.md",
	Summary: "For one real role and its hiring process: can you get your actual ability across in English? " +
		"An unscripted baseline, real stories, unfamiliar follow-ups, written updates, repair, and a retest two weeks on. " +
		"It says nothing about whether you will get the job.",
	Attach: AttachState,
	Reviews: []Review{
		{Key: "day_7", Label: "Day-seven retest", Days: 7, From: Anchor{Section: "baseline", Field: "date"}},
		{Key: "day_14", Label: "Day-fourteen transfer", Days: 14, From: Anchor{Section: "baseline", Field: "date"}},
	},
	RowReviews: []RowReview{
		{Section: "comparison", Field: "comparison", Row: "day_7", Review: "day_7"},
		{Section: "comparison", Field: "comparison", Row: "day_14", Review: "day_14"},
	},
	Sections: []Section{
		// §1
		{Key: "role", Title: "Role and process",
			Hint: "Job ads, recruiter emails, take-home tasks, company code, customer details and interview recordings can be confidential. Keep only what you have a right to use, and ask before you record anyone.",
			Fields: []Field{
				{Key: "role", Label: "Role title and public link", Type: Text},
				{Key: "deadline", Label: "Application deadline or interview date", Type: Date},
				{Key: "mode", Label: "Work mode", Type: Choice, Options: []string{"remote", "hybrid", "on-site"}},
				{Key: "zones", Label: "Main time zones and how the team works together", Type: Text},
				{Key: "stages", Label: "Interview stages known so far", Type: Text},
				{Key: "requirement", Label: "Language requirement as stated", Type: Text},
				{Key: "unknown", Label: "Hiring rules still unknown", Type: Text},
			}},
		// §2
		{Key: "language_map", Title: "Role language map",
			Fields: []Field{
				{Key: "map", Label: "Language map", Type: Table, MaxRows: 20, Columns: []Field{
					{Key: "fact", Label: "Fact about the role", Type: Text},
					{Key: "task", Label: "Language task", Type: Choice, Options: []string{
						"recruiter communication", "project explanation", "technical follow-up",
						"behavioural question", "async writing", "customer communication"}},
					{Key: "evidence", Label: "Evidence I have now", Type: Text},
					{Key: "risk", Label: "Risk", Type: Choice, Options: []string{"high", "medium", "low"}},
					{Key: "two_weeks", Label: "Can I build the evidence in two weeks?", Type: Text},
				}},
				{Key: "independent", Label: "What I can do on my own", Type: Text},
				{Key: "prepared", Label: "What I can do with preparation", Type: Text},
				{Key: "prompted", Label: "What depends on prompts or translation", Type: Text},
				{Key: "no_sample", Label: "What I have no sample of yet", Type: Text},
				{Key: "gap", Label: "The one highest-risk gap to repair", Type: Text},
			}},
		// §3
		{Key: "baseline", Title: "Complete baseline",
			Hint: "Do the whole sequence once, unscripted, before any practice. Its date sets the day-seven and day-fourteen retests.",
			Fields: []Field{
				{Key: "date", Label: "Date", Type: Date},
				{Key: "prep_time", Label: "Preparation time", Type: Text},
				{Key: "support", Label: "Support in view", Type: Choice, Options: []string{"none", "outline", "full script"}},
				{Key: "tools", Label: "Tools", Type: Choice, Other: true, Options: []string{"none", "dictionary", "captions", "AI"}},
				{Key: "location", Label: "Where the recording and text are kept", Type: Text},
				{Key: "stages", Label: "Stages", Type: Table, RowHeader: "Stage",
					Rows: []Row{
						{Key: "introduction", Label: "Introduction aimed at the role"},
						{Key: "project", Label: "Project explanation"},
						{Key: "follow_up", Label: "Unfamiliar follow-up"},
						{Key: "async", Label: "Written async update"},
						{Key: "repair", Label: "Repairing the conversation"},
					},
					Columns: []Field{
						{Key: "time", Label: "Time", Type: Label, Text: map[string]string{
							"introduction": "2 min",
							"project":      "5 min",
							"follow_up":    "3 questions",
							"async":        "20 min",
							"repair":       "1 case",
						}},
						{Key: "standard", Label: "Passes when", Type: Label, Text: map[string]string{
							"introduction": "Shows the work, the evidence for it and where you are heading",
							"project":      "Covers the context, your part, a trade-off, the result and an unknown",
							"follow_up":    "Each one is understood and answered, or clarified",
							"async":        "States progress, evidence, risk, next step and owner",
							"repair":       "Asks for a repeat, confirms, takes thinking time, or marks what is unknown",
						}},
						{Key: "result", Label: "Result on my own", Type: Text},
						{Key: "error", Label: "Main error", Type: Text},
					}},
			}},
		// §4
		{Key: "errors", Title: "Error map",
			Fields: []Field{
				{Key: "map", Label: "Errors", Type: Table, MaxRows: 30, Columns: []Field{
					{Key: "segment", Label: "Segment or question", Type: Text},
					{Key: "type", Label: "Type", Type: Choice, Options: []string{
						"content", "retrieval", "listening", "organisation", "interaction", "accuracy"}},
					{Key: "effect", Label: "Effect on the task", Type: Text},
					{Key: "next_test", Label: "What to test next", Type: Text},
				}},
				{Key: "not_english", Label: "The biggest problem that is not mainly about English", Type: Text},
				{Key: "meaning_error", Label: "A language error that keeps changing the key meaning", Type: Text},
				{Key: "repair", Label: "A repair move worth keeping", Type: Text},
			}},
		// §5: up's story lines and its story table, as one row per story.
		{Key: "stories", Title: "Real story bank",
			Hint: "Keep a few lines per story, not a script. A story is ready when it still answers the question after a follow-up you did not expect.",
			Fields: []Field{
				{Key: "stories", Label: "Stories", Type: Table, MaxRows: 12, Columns: []Field{
					{Key: "name", Label: "Story name", Type: Text},
					{Key: "situation", Label: "Situation and the task it called for", Type: Text},
					{Key: "responsibility", Label: "My own responsibility", Type: Text},
					{Key: "action", Label: "Key action and trade-off", Type: Text},
					{Key: "result", Label: "Result, cost and what is unknown", Type: Text},
					{Key: "change", Label: "What I would do differently now", Type: Text},
					{Key: "evidence", Label: "Evidence location", Type: Text},
					{Key: "answers", Label: "Questions it can answer", Type: Multi, Options: []string{
						"problem", "failure", "conflict", "decision", "feedback", "stopping"}},
					{Key: "holds", Label: "Still holds after an unfamiliar follow-up?", Type: Choice, Options: []string{"yes", "no"}},
					{Key: "checked", Label: "Fact and privacy check", Type: Text},
				}},
			}},
		// §6
		{Key: "repair", Title: "Listening and repair",
			Fields: []Field{
				{Key: "question", Label: "The question I did not understand, as it was asked", Type: Text},
				{Key: "asked", Label: "What I said to ask for a repeat or to confirm", Type: Text},
				{Key: "restated", Label: "What it meant once restated", Type: Text},
				{Key: "answer", Label: "My answer", Type: Text},
				{Key: "confirmed", Label: "How we checked we understood each other", Type: Text},
				{Key: "abilities", Label: "Repair abilities", Type: Table, RowHeader: "Ability",
					Rows: []Row{
						{Key: "repeat", Label: "Ask for one specific part again"},
						{Key: "scope", Label: "Confirm the scope"},
						{Key: "time", Label: "Ask for time to think"},
						{Key: "unknown", Label: "Admit an unknown and say how to check it"},
						{Key: "summary", Label: "Sum up what was agreed and the next step"},
					},
					Columns: []Field{
						{Key: "baseline", Label: "First version", Type: Score, ScoreLabels: interviewScoreLabels},
						{Key: "day_7", Label: "Day seven", Type: Score, ScoreLabels: interviewScoreLabels},
						{Key: "evidence", Label: "Evidence", Type: Text},
					}},
			}},
		// §7
		{Key: "async", Title: "Asynchronous writing sample",
			Hint: "Write the update, then give it to one reader and note how they read it back.",
			Fields: []Field{
				{Key: "context", Label: "Context", Type: Text},
				{Key: "completed", Label: "Done so far", Type: Text},
				{Key: "evidence", Label: "Evidence", Type: Text},
				{Key: "blocked", Label: "Blocked or at risk", Type: Text},
				{Key: "decision", Label: "Decision needed", Type: Text},
				{Key: "owner", Label: "Owner and next update", Type: Text},
				{Key: "reader_happened", Label: "Reader: what happened", Type: Text},
				{Key: "reader_decision", Label: "Reader: what needs a decision", Type: Text},
				{Key: "reader_next", Label: "Reader: who carries on, and when", Type: Text},
				{Key: "reader_guess", Label: "Reader: the sentence they had to guess at", Type: Text},
			}},
		// §8
		{Key: "ai", Title: "AI and integrity record",
			Hint: "Never make up experience, numbers or ownership, and never take hidden prompts during a live interview unless that is clearly allowed.",
			Fields: []Field{
				{Key: "tool", Label: "Tool and date", Type: Text},
				{Key: "role", Label: "The role it played", Type: Text},
				{Key: "own_first", Label: "My own version, done first", Type: Text},
				{Key: "problems", Label: "Three problems it raised", Type: Long},
				{Key: "feedback", Label: "Feedback I took or turned down, and why", Type: Long},
				{Key: "parallel", Label: "The parallel result after closing the tool", Type: Text},
				{Key: "disclosure", Label: "Stages where AI must be disclosed or is not allowed", Type: Text},
				{Key: "kept_out", Label: "Confidential or personal information I kept out", Type: Text},
			}},
		// §9
		{Key: "comparison", Title: "Fourteen-day comparison",
			Hint: "Compare only your own comparable tasks. The day-seven and day-fourteen rows open on their dates.",
			Fields: []Field{
				{Key: "comparison", Label: "Comparison", Type: Table, RowHeader: "When",
					Rows: []Row{
						{Key: "day_1", Label: "Day-one baseline"},
						{Key: "revision", Label: "Revision straight after"},
						{Key: "day_7", Label: "Day-seven retest"},
						{Key: "day_14", Label: "Day-fourteen transfer"},
					},
					Columns: []Field{
						{Key: "condition", Label: "Condition", Type: Label, Text: map[string]string{
							"day_1":    "Unscripted, no AI",
							"revision": "After seeing the feedback",
							"day_7":    "Parallel questions, the original answer out of sight",
							"day_14":   "A new interviewer, a new order, or a new role question",
						}},
						{Key: "completion", Label: "Task completion", Type: Score, ScoreLabels: interviewScoreLabels},
						{Key: "understanding", Label: "Understanding and repair", Type: Score, ScoreLabels: interviewScoreLabels},
						{Key: "organisation", Label: "Organisation and retrieval", Type: Score, ScoreLabels: interviewScoreLabels},
						{Key: "async", Label: "Async writing", Type: Score, ScoreLabels: interviewScoreLabels},
						{Key: "evidence", Label: "Evidence", Type: Text},
					}},
			}},
		// §10
		{Key: "gates", Title: "Gates for this role",
			Fields: []Field{
				{Key: "stories", Label: "At least three real stories still work when the question is worded differently", Type: Check},
				{Key: "stages", Label: "I can get through the recruiter screen, the project explanation and an unfamiliar follow-up", Type: Check},
				{Key: "clarify", Label: "When a question is unclear, I ask rather than guess", Type: Check},
				{Key: "meaning", Label: "My recurring language errors no longer change the key meaning", Type: Check},
				{Key: "async", Label: "I can write one usable async update", Type: Check},
				{Key: "boundaries", Label: "I know the rules on confidentiality, recording and AI", Type: Check},
				{Key: "unknowns", Label: "I can admit an unknown and say how I would check it", Type: Check},
				{Key: "setup", Label: "Equipment, time zone and interview setting are checked", Type: Check},
				{Key: "support", Label: "What the evidence supports now", Type: Choice, Options: []string{
					"apply and keep practising", "repair one high-risk gap", "defer this role"}},
				{Key: "evidence", Label: "Evidence", Type: Text},
				{Key: "open_conclusion", Label: "A conclusion I still cannot draw", Type: Text},
				{Key: "smallest_next", Label: "The smallest next task", Type: Text},
				{Key: "next_review", Label: "Next review date", Type: Date},
			}},
		// §11
		{Key: "after", Title: "After the interview",
			Fields: []Field{
				{Key: "questions", Label: "The questions actually asked", Type: Long},
				{Key: "understood", Label: "Evidence I understood them correctly", Type: Text},
				{Key: "clarification", Label: "A clarification that worked", Type: Text},
				{Key: "failed_story", Label: "A story that did not answer the question", Type: Text},
				{Key: "transferred", Label: "A structure that carried over", Type: Text},
				{Key: "not_english", Label: "A difficulty not mainly caused by English", Type: Text},
				{Key: "feedback", Label: "The recruiter's feedback, in their own words", Type: Long},
				{Key: "variable", Label: "One variable to change", Type: Text},
				{Key: "stop", Label: "Preparation to stop doing", Type: Text},
			}},
	},
}

// interviewScoreLabels are up's 0–2 anchors for §6 and §9, reworded.
var interviewScoreLabels = []string{"not done", "partly, or only with prompts", "done under the current condition"}

func init() { register(interviewEvidence) }
