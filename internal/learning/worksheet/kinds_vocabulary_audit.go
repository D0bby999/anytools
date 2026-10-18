package worksheet

// up: docs/en/templates/vocabulary-audit.md, §1–§11 (structure only; wording
// written fresh). plans/260930-0915-up-methods, phase 3.
//
// The vocabulary evidence card: one real task, a first encounter kept before
// any lookup, the decision queue for unknown items (the same five decisions
// the word picker offers, chapter §3), the dimensions of each valuable chunk,
// sources, unaided retrieval, a real reader's check, errors, AI use, the
// delayed retests and the scores. Rows of the §3 queue can also be copied in
// from Mastery → Vocabulary (POST /v1/worksheets/{id}/rows).
//
// The retests (§10) count from the first-encounter date the learner writes in
// §1, at +1, +5 (up's "days 3–7"), +14 and +30 days; each dated row of §10
// opens on its day.

// Row keys of the §10 retest table, shared with the kind's reviews.
const (
	vocabSameDay  = "same_day"
	vocabDay1     = "day_1"
	vocabDays3to7 = "days_3_7"
	vocabDay14    = "day_14"
	vocabDay30    = "day_30"
)

var vocabScoreLabels = []string{"no evidence yet", "needs a cue, or unstable", "on my own under these conditions"}

var vocabFirstEncounter = Anchor{Section: "task", Field: "first_encounter_date"}

var vocabularyAudit = Kind{
	Kind: "vocabulary_audit", Name: "Vocabulary evidence", Group: GroupLanguage, Version: 1,
	Source: "docs/en/templates/vocabulary-audit.md",
	Summary: "One real task: what you understood before looking anything up, which unknown words you " +
		"skip, infer, look up, learn or check with an expert, and whether the ones you learned come back " +
		"without prompts days later.",
	Attach: AttachState,
	Reviews: []Review{
		{Key: vocabDay1, Label: "Day 1 retest", Days: 1, From: vocabFirstEncounter},
		{Key: vocabDays3to7, Label: "Days 3–7 retest", Days: 5, From: vocabFirstEncounter},
		{Key: vocabDay14, Label: "Day 14 retest", Days: 14, From: vocabFirstEncounter},
		{Key: vocabDay30, Label: "Day 30 retest", Days: 30, From: vocabFirstEncounter},
	},
	RowReviews: []RowReview{
		{Section: "retest", Field: "timeline", Row: vocabDay1, Review: vocabDay1},
		{Section: "retest", Field: "timeline", Row: vocabDays3to7, Review: vocabDays3to7},
		{Section: "retest", Field: "timeline", Row: vocabDay14, Review: vocabDay14},
		{Section: "retest", Field: "timeline", Row: vocabDay30, Review: vocabDay30},
	},
	Sections: []Section{
		// §1
		{Key: "task", Title: "The task and its conditions",
			Hint: "The goal is to understand, choose and retrieve words under these conditions, not to add as many as possible. " +
				"Leave out passwords, client records, unpublished work, exam answers and anything private about other people.",
			Fields: []Field{
				{Key: "situation", Label: "Real situation and audience", Type: Text},
				{Key: "task", Label: "Task", Type: Choice, Options: []string{"listen", "read", "speak", "write", "exam", "hand over"}},
				{Key: "material", Label: "Material, version and source", Type: Text},
				{Key: "outcome", Label: "What should someone else understand, decide or finish?", Type: Long},
				{Key: "limit", Label: "Time and length limit", Type: Text},
				{Key: "permitted", Label: "Help allowed (captions, dictionary, translation, search, AI, people)", Type: Text},
				{Key: "boundary", Label: "Privacy, copyright, confidentiality, exam and expert limits", Type: Long},
				{Key: "first_encounter_date", Label: "First-encounter date", Type: Date,
					Hint: "The retests below are counted from this date."},
				{Key: "parallel_date", Label: "Parallel-task date", Type: Date},
			}},
		// §2
		{Key: "first", Title: "First encounter, before any lookup",
			Hint: "Check first whether the barrier is really a word: sound, sentence structure, background, layout or attention can break a sentence too.",
			Fields: []Field{
				{Key: "time", Label: "Start and end time", Type: Text},
				{Key: "gist", Label: "Gist, relationships and next step before looking anything up", Type: Long},
				{Key: "confident", Label: "Details understood with confidence", Type: Long},
				{Key: "guessed", Label: "Places where you had to guess", Type: Long},
				{Key: "stopped", Label: "Sentence or timestamp where the meaning stopped", Type: Text},
				{Key: "tried", Label: "Sense or expression you tried then", Type: Text},
				{Key: "raw", Label: "Where the raw retelling, recording, cloze or draft is kept", Type: Text},
				{Key: "completed", Label: "Did it complete the real task?", Type: Choice, Options: []string{"yes", "partly", "no"}},
			}},
		// §3
		{Key: "queue", Title: "Decision queue for unknown items",
			Hint: "Not every unknown word deserves review. Take only five to eight chunks into deliberate learning in one cycle.",
			Fields: []Field{
				{Key: "items", Label: "Unknown items", Type: Table, MaxRows: 30, Columns: []Field{
					{Key: "item", Label: "Word or chunk", Type: Text},
					{Key: "impact", Label: "Task impact", Type: Choice, Options: []string{"blocking", "important", "minor", "none"}},
					{Key: "decision", Label: "Decision", Type: Choice, Options: []string{"skip", "infer", "quick lookup", "learn", "expert check"}},
					{Key: "basis", Label: "Basis at the time", Type: Text},
					{Key: "next", Label: "Next check", Type: Text},
				}},
				{Key: "learn", Label: "Five to eight chunks for deliberate learning", Type: Long},
				{Key: "skip", Label: "Items to skip, and why", Type: Long},
				{Key: "expert", Label: "Items that need a primary source or an expert", Type: Long},
				{Key: "deferred", Label: "Items put off for lack of capacity", Type: Long},
			}},
		// §4
		{Key: "chunk", Title: "Eight dimensions of a valuable chunk",
			Hint: "One chunk per card. Keep only what changes how you understand or use it in this task; a whole dictionary page does not belong here.",
			Fields: []Field{
				{Key: "chunk", Label: "Word or chunk", Type: Text},
				{Key: "function", Label: "What it does in the task", Type: Text},
				{Key: "form", Label: "Form, inflection and derivation", Type: Text},
				{Key: "sound", Label: "Sound, stress and connected speech", Type: Text},
				{Key: "sense", Label: "Current sense, in your own words", Type: Long},
				{Key: "collocation", Label: "Usual collocation or sentence slot", Type: Text},
				{Key: "grammar", Label: "Grammatical behaviour", Type: Text},
				{Key: "register", Label: "Register, politeness, stance and identity", Type: Text},
				{Key: "concept", Label: "Concept, referent, version or domain limit", Type: Long},
				{Key: "retrieval", Label: "Retrieval time now, and the cue it still needs", Type: Text},
				{Key: "contrast", Label: "One near-synonym or counterexample, and the difference", Type: Long},
			}},
		// §5
		{Key: "verify", Title: "Sense, collocation and source",
			Hint: "What an AI suggests is a candidate, not a source. Neither frequency nor a confident tone settles a high-risk term.",
			Fields: []Field{
				{Key: "checks", Label: "Checks", Type: Table, RowHeader: "Item to check",
					Rows: []Row{
						{Key: "sense", Label: "Sense"},
						{Key: "pronunciation", Label: "Pronunciation"},
						{Key: "collocation", Label: "Collocation"},
						{Key: "register", Label: "Register"},
						{Key: "concept", Label: "Technical or institutional concept"},
					},
					Columns: []Field{
						{Key: "candidate", Label: "My candidate", Type: Text},
						{Key: "source", Label: "Source, version, location", Type: Text},
						{Key: "result", Label: "Result", Type: Text},
						{Key: "unknown", Label: "Still unknown", Type: Text},
					}},
				{Key: "why_source", Label: "Why this dictionary or corpus fits the task", Type: Long},
				{Key: "primary", Label: "Primary document, standard or code location", Type: Text},
				{Key: "checked_on", Label: "Check date", Type: Date},
				{Key: "decider", Label: "Who decides a high-risk term", Type: Text},
				{Key: "change", Label: "What evidence would change the decision", Type: Long},
			}},
		// §6
		{Key: "retrieval", Title: "Unaided retrieval",
			Hint: "Reproducing the whole source sentence is not transfer.",
			Fields: []Field{
				{Key: "cue", Label: "Real intention or situational cue", Type: Text},
				{Key: "allowed", Label: "Prompt allowed on the first attempt", Type: Text},
				{Key: "removed", Label: "Prompt removed next time", Type: Text},
				{Key: "target", Label: "Target retrieval time", Type: Text},
				{Key: "speaking", Label: "Speaking task", Type: Long},
				{Key: "writing", Label: "Writing task", Type: Long},
				{Key: "vary", Label: "Person, time, topic, tone or mode to change", Type: Text},
				{Key: "attempts", Label: "Attempts", Type: Table, RowHeader: "Attempt",
					Rows: []Row{
						{Key: "original", Label: "Original context"},
						{Key: "changed", Label: "Changed context"},
						{Key: "real", Label: "Real task"},
					},
					Columns: []Field{
						{Key: "condition", Label: "Condition", Type: Label, Text: map[string]string{
							"original": "Answer hidden",
							"changed":  "Source sentence removed",
							"real":     "A real audience and consequence",
						}},
						{Key: "expression", Label: "What you actually said or wrote", Type: Text},
						{Key: "time", Label: "Retrieval time", Type: Text},
						{Key: "result", Label: "Result", Type: Text},
					}},
			}},
		// §7
		{Key: "reader", Title: "A real reader or listener checks it",
			Fields: []Field{
				{Key: "retold", Label: "The meaning as the reader or listener retold it", Type: Long},
				{Key: "heard", Label: "Relationship, certainty and next step they took from it", Type: Long},
				{Key: "guessed", Label: "Where they had to guess or ask", Type: Long},
				{Key: "changed", Label: "Did the word choice change a fact or a responsibility?", Type: YesNo},
				{Key: "completed", Label: "Task completed?", Type: Choice, Options: []string{"yes", "partly", "no"}},
				{Key: "response", Label: "The real response or result", Type: Long},
				{Key: "feedback", Label: "Feedback", Type: Table, MaxRows: 20, Columns: []Field{
					{Key: "feedback", Label: "Feedback", Type: Text},
					{Key: "type", Label: "Type", Type: Choice, Options: []string{"necessary repair", "acceptable variant", "register", "style"}},
					{Key: "decision", Label: "Decision", Type: Choice, Options: []string{"accept", "partly", "reject", "defer"}},
					{Key: "reason", Label: "Reason", Type: Text},
					{Key: "parallel", Label: "Used in a parallel task?", Type: YesNo},
				}},
			}},
		// §8
		{Key: "errors", Title: "Errors and the smallest repair",
			Fields: []Field{
				{Key: "errors", Label: "Errors", Type: Table, MaxRows: 30, Columns: []Field{
					{Key: "sample", Label: "Error sample", Type: Text},
					{Key: "type", Label: "Type", Type: Choice, Options: []string{
						"form", "sound", "sense", "collocation", "grammar", "register", "slow retrieval", "transfer"}},
					{Key: "gap", Label: "Likely gap", Type: Text},
					{Key: "change", Label: "Change only this", Type: Text},
					{Key: "retest", Label: "Retest condition", Type: Text},
				}},
				{Key: "card_only", Label: "Chunks right on cards but missed in the task", Type: Long},
				{Key: "heard_only", Label: "Chunks heard but not written", Type: Long},
				{Key: "read_only", Label: "Chunks read but not heard", Type: Long},
				{Key: "variation", Label: "Acceptable variation marked as an error", Type: Long},
				{Key: "split", Label: "Items that need a split card, less volume or more background", Type: Long},
			}},
		// §9
		{Key: "ai", Title: "AI and tool use",
			Fields: []Field{
				{Key: "tool", Label: "Tool, model, version and date", Type: Text},
				{Key: "before", Label: "The first encounter and the candidate you had before using it", Type: Long},
				{Key: "request", Label: "Request", Type: Multi, Other: true, Options: []string{
					"sense contrast", "collocation candidate", "cloze", "counterexample",
					"audience simulation", "error classification", "parallel task"}},
				{Key: "scope", Label: "What the model generated or rewrote", Type: Long},
				{Key: "risk", Label: "What may be invented or out of date", Type: Long},
				{Key: "checked", Label: "Dictionary, corpus, primary source or human check", Type: Long},
				{Key: "decided", Label: "What you accepted, rejected or put off, and why", Type: Long},
				{Key: "after", Label: "Retrieval task after closing the tool", Type: Text},
			}},
		// §10
		{Key: "retest", Title: "Delayed retention and transfer",
			Hint: "Each dated row opens on its day, counted from the first-encounter date.",
			Fields: []Field{
				{Key: "timeline", Label: "Retests", Type: Table, RowHeader: "Time",
					Rows: []Row{
						{Key: vocabSameDay, Label: "Same day"},
						{Key: vocabDay1, Label: "Day 1"},
						{Key: vocabDays3to7, Label: "Days 3–7"},
						{Key: vocabDay14, Label: "Day 14"},
						{Key: vocabDay30, Label: "Day 30"},
					},
					Columns: []Field{
						{Key: "remove", Label: "Remove", Type: Label, Text: map[string]string{
							vocabSameDay: "The answer and the gloss", vocabDay1: "The source sentence",
							vocabDays3to7: "The recent cue", vocabDay14: "Old cards and feedback",
							vocabDay30: "Every practice prompt",
						}},
						{Key: "change", Label: "Change", Type: Label, Text: map[string]string{
							vocabSameDay: "Same topic", vocabDay1: "The sentence and the people",
							vocabDays3to7: "The mode or the audience", vocabDay14: "A new topic, the same task",
							vocabDay30: "Real material and a real consequence",
						}},
						{Key: "output", Label: "Output", Type: Label, Text: map[string]string{
							vocabSameDay: "Recall in context", vocabDay1: "Spoken or written retrieval",
							vocabDays3to7: "A parallel input or output", vocabDay14: "Timed real output",
							vocabDay30: "Full delivery",
						}},
						{Key: "result", Label: "Result", Type: Long},
					}},
				{Key: "still", Label: "Chunks still retrieved in time", Type: Long},
				{Key: "original_only", Label: "Chunks that worked only in the original item", Type: Long},
				{Key: "frequent", Label: "The error that came back most", Type: Long},
				{Key: "less_rework", Label: "Did the real task need less guessing or rework?", Type: Long},
			}},
		// §11
		{Key: "score", Title: "Scores, and what to keep",
			Fields: []Field{
				{Key: "scores", Label: "Scores", Type: Table, RowHeader: "Item",
					Rows: []Row{
						{Key: "recognise", Label: "Recognise it in sound and text"},
						{Key: "judge", Label: "Judge the current sense and the task impact"},
						{Key: "use", Label: "Use a fitting collocation, form and register"},
						{Key: "retrieve", Label: "Retrieve it without prompts, in time"},
						{Key: "deliver", Label: "Get the intended meaning to a reader or listener"},
						{Key: "transfer", Label: "Transfer it after the topic, audience or mode changes"},
					},
					Columns: []Field{
						{Key: "same_day", Label: "Same day", Type: Score, ScoreLabels: vocabScoreLabels},
						{Key: "day_7", Label: "Day 7", Type: Score, ScoreLabels: vocabScoreLabels},
						{Key: "day_14", Label: "Day 14", Type: Score, ScoreLabels: vocabScoreLabels},
						{Key: "reason", Label: "Evidence for the score", Type: Text},
					}},
				{Key: "keep", Label: "Chunks to keep learning, and why", Type: Long},
				{Key: "split", Label: "Chunks that need a split or a new cue", Type: Long},
				{Key: "archive", Label: "Chunks to archive", Type: Long},
				{Key: "expert", Label: "Chunks that need an expert's check", Type: Long},
				{Key: "change", Label: "One condition to change next cycle", Type: Text},
				{Key: "next_review", Label: "Next review date", Type: Date},
			}},
	},
}

func init() { register(vocabularyAudit) }
