package worksheet

// up: docs/en/templates/reading-evidence.md, §1–§11 (structure only; wording
// written fresh), plus the five passes from docs/en/threads/part-1/4-reading.md
// §4, placed after the first pass (phase 5 requirement 1; testdata/deviations.txt).
// The barrier layers' next steps are the chapter's §3, written fresh.
//
// The card is attached to the document being read: an upload, a web page or
// a page of a crawled site or repository. Not a YouTube video, which the
// listening audit covers. Its retests count from the day the first pass's
// gist is first written, and each retest row opens on its date.

var readingScores = []string{"not completed", "needs prompts or unstable", "completed under this condition"}

// Barrier layers, in the chapter's order (§3). The reader's "Mark a barrier"
// asks for one of these.
const (
	LayerVocabulary = "vocabulary and grammar"
	LayerStructure  = "structure and reference"
	LayerBackground = "background and schema"
	LayerArgument   = "argument and evidence"
	LayerLayout     = "layout and technical"
	LayerAttention  = "attention and capacity"
)

var readingEvidence = Kind{
	Kind: "reading_evidence", Name: "Reading evidence", Group: GroupLanguage, Version: 1,
	Source: "docs/en/templates/reading-evidence.md",
	Summary: "One text read as evidence, not as pages turned: an untouched first pass, five passes that " +
		"each do one job, where and why you got stuck, the author's claims kept apart from your own, " +
		"and retests days later on a different source.",
	Attach:        AttachDocument,
	DocumentKinds: []string{"upload", "drive", "web", "site_page", "repo_file"},
	Reviews: []Review{
		// Counted from the day the first pass's gist is first written.
		{Key: "days_3_7", Label: "Days 3–7 retest", Days: 5, From: firstPassGist},
		{Key: "day14", Label: "Day 14 retest", Days: 14, From: firstPassGist},
		{Key: "day30", Label: "Day 30 retest", Days: 30, From: firstPassGist},
	},
	RowReviews: []RowReview{
		{Section: "retests", Field: "retest", Row: "day3_7", Review: "days_3_7"},
		{Section: "retests", Field: "retest", Row: "day14", Review: "day14"},
		{Section: "retests", Field: "retest", Row: "day30", Review: "day30"},
	},
	Sections: []Section{
		// §1
		{Key: "task", Title: "Task, reader and boundary",
			Hint: "Say what will be true once the reading is done — you can run the smallest example on " +
				"this version, you can tell a colleague what to decide — rather than just \"finished\". " +
				"Leave passwords, client data and other people's details out of this card.",
			Fields: []Field{
				{Key: "situation", Label: "Real situation", Type: Text},
				{Key: "task", Label: "Task", Type: Choice, Options: []string{
					"locate information", "follow an argument", "read documentation",
					"build stamina", "synthesise sources", "support a decision"}},
				{Key: "who", Label: "Who has to know, decide, act or carry on after the reading?", Type: Text},
				{Key: "completion", Label: "Completion standard", Type: Text},
				{Key: "time_limit", Label: "Time limit", Type: Text},
				{Key: "allowed", Label: "Dictionary, translation, search, notes or AI allowed", Type: Text},
				{Key: "boundary", Label: "Copyright, privacy and retention boundary", Type: Text},
			}},
		// §2
		{Key: "source", Title: "Source and version",
			Hint: "Pages change, go behind a paywall or vanish. Keep enough to cite and find the text " +
				"again; do not copy a whole article you have no permission to keep.",
			Fields: []Field{
				{Key: "sources", Label: "Sources", Type: Table, RowHeader: "Item",
					Rows: []Row{
						{Key: "author_title", Label: "Author or maintainer, title, link"},
						{Key: "edition", Label: "Edition, publication date or version"},
						{Key: "access", Label: "Access date and length"},
						{Key: "position", Label: "Author's or institution's position or interest"},
						{Key: "reuse", Label: "Quotation, image, code and copyright boundary"},
						{Key: "topic", Label: "Topic, genre and difficulty"},
					},
					Columns: []Field{
						{Key: "main", Label: "Main source", Type: Text},
						{Key: "parallel", Label: "Parallel source", Type: Text},
						{Key: "comparable", Label: "Comparable?", Type: Text},
					}},
			}},
		// §3
		{Key: "first_pass", Title: "Unpolished first pass",
			Hint: "Write this before you look anything up or ask for an explanation, and leave it as it " +
				"is afterwards. A clean translation written later is not a first pass.",
			Fields: []Field{
				{Key: "conditions", Label: "First-pass conditions", Type: Text},
				{Key: "time", Label: "First-pass time", Type: Text},
				{Key: "looked_up", Label: "Did I look up every word?", Type: YesNo},
				{Key: "gist", Label: "One-sentence gist", Type: Text},
				{Key: "movement", Label: "How the text moves", Type: Text},
				{Key: "details", Label: "Three details I am sure of", Type: Long},
				{Key: "wants", Label: "What the author or maintainer wants me to believe or do", Type: Text},
				{Key: "unresolved", Label: "One point I have not resolved", Type: Text},
				{Key: "action", Label: "What I would do on this understanding", Type: Text},
			}},
		// The reading chapter's §4: five passes, each with its own job.
		{Key: "passes", Title: "Five passes", Added: true,
			Hint: "Rereading the same way ten times teaches less than five readings that each ask a " +
				"different question. Do them in order and mark each one done when its output is written.",
			Fields: []Field{
				{Key: "passes", Label: "Passes", Type: Table, RowHeader: "Pass",
					Rows: []Row{
						{Key: "orient", Label: "1. Orient"},
						{Key: "structure", Label: "2. Map the structure"},
						{Key: "evidence", Label: "3. Verify key evidence"},
						{Key: "rebuild", Label: "4. Rebuild with tools closed"},
						{Key: "task", Label: "5. Move into a task"},
					},
					Columns: []Field{
						{Key: "job", Label: "What this pass does", Type: Label, Text: map[string]string{
							"orient": "Guess the real problem from the title, version, contents, figures and " +
								"opening. Read once against a timer, look nothing up, and write the gist.",
							"structure": "Name what each paragraph does — background, problem, claim, reason, " +
								"example, limit, action, conclusion. In a long sentence, find its subject, main " +
								"verb, condition and turn before translating any of it.",
							"evidence": "Look up only what recurs, what the field depends on, what the reasoning " +
								"hangs on or what would change your action. Note where it sits, where the " +
								"definition came from and how you read it. A translated paragraph is not a check.",
							"rebuild": "With the text and the dictionary out of sight, rebuild it in five " +
								"sentences: problem, claim, evidence, limit, next action. Add one inference the " +
								"source supports and one case that could break it.",
							"task": "Put the reading to work: answer the question, run the smallest example, " +
								"write the confirmation, compare it with another source, explain it to someone, " +
								"or ask the next question that cuts the uncertainty.",
						}},
						{Key: "output", Label: "Output", Type: Long},
						{Key: "done", Label: "Done", Type: YesNo},
					}},
			}},
		// §4, with the chapter's §3 next steps as the layers' hints.
		{Key: "barriers", Title: "Six-layer barrier map",
			Hint: "If nearly every sentence stops the gist, pick an easier parallel text or learn the " +
				"field's set phrases first. Starting lower does not mean aiming lower.",
			Fields: []Field{
				{Key: "map", Label: "Barriers", Type: Table, MaxRows: 30,
					Columns: []Field{
						{Key: "page", Label: "Paragraph or page", Type: Text},
						{Key: "stuck", Label: "Where I got stuck", Type: Text},
						{Key: "layer", Label: "Barrier layer", Type: Choice,
							Options: []string{LayerVocabulary, LayerStructure, LayerBackground,
								LayerArgument, LayerLayout, LayerAttention},
							OptionHints: map[string]string{
								LayerVocabulary: "Look up only the least you need to go on, then take the word " +
									"or pattern to your vocabulary or grammar evidence.",
								LayerStructure: "Find the sentence's core, what each pronoun points back to, " +
									"and how its parts are joined.",
								LayerBackground: "Sketch a small map of the missing background from a source " +
									"you trust, then come back to the text.",
								LayerArgument: "Lay out the claims in the claim map below and go back to " +
									"where each one sits in the source.",
								LayerLayout: "Change the format, zoom in, look for the current version, or " +
									"write the defect down.",
								LayerAttention: "Take a shorter section, do fewer things at once, or move " +
									"the reading to a time of day when you have more in reserve.",
							}},
						{Key: "impact", Label: "Task impact", Type: Choice, Options: []string{
							"meaning-changing", "task-blocking", "recurring", "effortful", "low-impact"}},
						{Key: "action", Label: "This cycle's action", Type: Text},
					}},
				{Key: "top", Label: "The one to three barriers that most affect the task", Type: Text},
				{Key: "skip", Label: "Low-impact words or sentences I am skipping for now", Type: Text},
				{Key: "conditions", Label: "Device, version, fatigue or surroundings that may have played a part", Type: Text},
			}},
		// §5
		{Key: "claims", Title: "Claims, evidence and limits",
			Hint: "What the author says and whether you agree are two separate questions. On health, law, " +
				"money or technical safety, check a primary source or someone qualified.",
			Fields: []Field{
				{Key: "map", Label: "Claim map", Type: Table, MaxRows: 30,
					Columns: []Field{
						{Key: "page", Label: "Paragraph or page", Type: Text},
						{Key: "function", Label: "Function", Type: Text},
						{Key: "claim", Label: "Author's claim", Type: Text},
						{Key: "evidence", Label: "Evidence or example in the source", Type: Text},
						{Key: "limit", Label: "Limit, counterexample or unknown", Type: Text},
					}},
				{Key: "facts", Label: "Facts stated outright", Type: Long},
				{Key: "inference", Label: "Inferences the source supports", Type: Long},
				{Key: "judgment", Label: "My own judgment or association", Type: Long},
				{Key: "missing", Label: "Evidence still missing", Type: Text},
				{Key: "would_change", Label: "What new evidence would change my judgment", Type: Text},
			}},
		// §6
		{Key: "facts", Title: "Technical documentation fact card",
			Hint: "For an API, an SDK, a migration guide, command help, an error reference or a README. " +
				"Seeing the page is not knowing it: run, reason through or reproduce one small fact.",
			Fields: []Field{
				{Key: "goal_version", Label: "Goal and the version it applies to", Type: Text},
				{Key: "prerequisites", Label: "Prerequisites, permissions and environment", Type: Text},
				{Key: "minimum_input", Label: "Minimum input", Type: Text},
				{Key: "expected", Label: "Expected output", Type: Text},
				{Key: "actual", Label: "Actual output", Type: Text},
				{Key: "defaults", Label: "Defaults, ranges, order or side effects", Type: Text},
				{Key: "failure", Label: "Failure condition or error", Type: Text},
				{Key: "stated_limit", Label: "Limit the source states outright", Type: Text},
				{Key: "inferring", Label: "What I am still inferring", Type: Text},
				{Key: "next_test", Label: "Smallest next test", Type: Text},
			}},
		// §7
		{Key: "words", Title: "Unknown words, word families and translation",
			Hint: "How many words you did not know says how well this text fits you now, not what your " +
				"level is. Knowing a word's family helps you guess, but a related form is not yours to " +
				"use until you have used it.",
			Fields: []Field{
				{Key: "table", Label: "Words", Type: Table, MaxRows: 50,
					Columns: []Field{
						{Key: "word", Label: "Word or expression", Type: Text},
						{Key: "role", Label: "Role in the task", Type: Choice, Options: []string{
							"core", "recurring", "technical", "low-impact"}},
						{Key: "checked", Label: "Definition, family or collocation checked", Type: Text},
						{Key: "location", Label: "Source location", Type: Text},
						{Key: "explainable", Label: "Can I explain it with tools closed?", Type: YesNo},
					}},
				{Key: "background", Label: "Background the translation filled in for me", Type: Text},
				{Key: "hidden", Label: "English structure, stance or hedge the translation may hide", Type: Text},
				{Key: "not_checked", Label: "A word I chose not to check yet", Type: Text},
			}},
		// §8
		{Key: "output", Title: "Compare sources and deliver an output",
			Hint: "Reading is tested by what it lets you do next: a reader, a piece of code, a decision " +
				"or the next task should be able to check it.",
			Fields: []Field{
				{Key: "question", Label: "Shared question", Type: Text},
				{Key: "source_a", Label: "Definition, date and evidence in source A", Type: Text},
				{Key: "source_b", Label: "Definition, date and evidence in source B", Type: Text},
				{Key: "omitted", Label: "Evidence left out, or an institution's interest", Type: Text},
				{Key: "fact_or_value", Label: "Which differences are about facts, and which about values?", Type: Text},
				{Key: "deliveries", Label: "Outputs", Type: Table, MaxRows: 10,
					Columns: []Field{
						{Key: "output", Label: "Output", Type: Choice, Options: []string{
							"confirmation", "minimum test", "explanation", "decision memo", "handover"}},
						{Key: "audience", Label: "Audience", Type: Text},
						{Key: "delivered", Label: "What I delivered", Type: Text},
						{Key: "response", Label: "Audience response", Type: Text},
						{Key: "traceable", Label: "Basis traceable?", Type: YesNo},
					}},
			}},
		// §9
		{Key: "tools", Title: "Tools and feedback",
			Hint: "An AI can pull out candidate terms, ask about structure and set parallel tasks, but it " +
				"can also make up a summary, a citation, background or what the author meant. Keep the " +
				"first pass before you ask it to find evidence.",
			Fields: []Field{
				{Key: "tool", Label: "Tool or reviewer, with version and date", Type: Text},
				{Key: "saw", Label: "Did it see the source, my first pass or my summary?", Type: Text},
				{Key: "missed", Label: "Places in the source it says I missed", Type: Text},
				{Key: "confused", Label: "Did it mix up fact, inference and style?", Type: Text},
				{Key: "checked", Label: "Teacher, peer or primary-source check", Type: Text},
				{Key: "accepted", Label: "What I accepted or rejected, and why", Type: Long},
			}},
		// §10
		{Key: "retests", Title: "Delayed retention and transfer",
			Hint: "Each row opens on its day, counted from the day you wrote the first pass's gist.",
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
							"day1":   "Any full translation or AI summary",
							"day3_7": "Your old notes and the dictionary",
							"day14":  "The latest feedback",
							"day30":  "Every prompt",
						}},
						{Key: "condition", Label: "Changed condition", Type: Label, Text: map[string]string{
							"day1":   "The main source",
							"day3_7": "A parallel source",
							"day14":  "A new topic or genre",
							"day30":  "A real document, report or handover",
						}},
						{Key: "output", Label: "Output", Type: Label, Text: map[string]string{
							"day1":   "The first pass and a five-sentence rebuild",
							"day3_7": "Gist, evidence and inference",
							"day14":  "An explanation, a test or a decision memo",
							"day30":  "The whole delivery",
						}},
						{Key: "result", Label: "Result", Type: Long},
					}},
				{Key: "kept", Label: "The method I can still use after seven days", Type: Text},
				{Key: "returned", Label: "The barrier that came back when the source changed", Type: Text},
				{Key: "less_dependence", Label: "Did I lean less on word-by-word translation or summaries?", Type: Text},
				{Key: "unstable", Label: "Which follow-up action is still unstable?", Type: Text},
				{Key: "next_variable", Label: "One variable for the next cycle", Type: Text},
			}},
		// §11
		{Key: "score", Title: "Score and decide",
			Fields: []Field{
				{Key: "scores", Label: "Scores", Type: Table, RowHeader: "Item",
					Rows: []Row{
						{Key: "main_line", Label: "Keeps the first pass's main line"},
						{Key: "separates", Label: "Keeps claim, evidence and inference apart"},
						{Key: "layer", Label: "Places the barrier's layer and picks an action"},
						{Key: "verifies", Label: "Verifies a technical fact or a source location"},
						{Key: "rebuilds", Label: "Rebuilds it with tools closed"},
						{Key: "transfers", Label: "Still delivers when the source, topic or genre changes"},
					},
					Columns: []Field{
						{Key: "day1", Label: "Day 1", Type: Score, ScoreLabels: readingScores},
						{Key: "day7", Label: "Day 7", Type: Score, ScoreLabels: readingScores},
						{Key: "day14", Label: "Day 14", Type: Score, ScoreLabels: readingScores},
						{Key: "reason", Label: "Evidence reason", Type: Text},
					}},
				{Key: "supports", Label: "Current evidence supports", Type: Choice, Options: []string{
					"continue the main source", "drop to extensive reading", "replace the source",
					"move to another problem"}},
				{Key: "key_evidence", Label: "Most important evidence", Type: Text},
				{Key: "cannot_conclude", Label: "Conclusion I still cannot draw", Type: Text},
				{Key: "next_task", Label: "Smallest next task", Type: Text},
				{Key: "next_review", Label: "Next review date", Type: Date},
			}},
	},
}

// firstPassGist is the first pass's one-sentence gist: the retests count
// from the day it is first written.
var firstPassGist = Anchor{Section: "first_pass", Field: "gist"}

func init() { register(readingEvidence) }
