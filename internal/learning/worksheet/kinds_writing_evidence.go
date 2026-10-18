package worksheet

// up: docs/en/templates/writing-evidence.md, §1–§11 (structure only; wording
// written fresh). Phase 4 of plans/260930-0915-up-methods.
//
// One difference from up, listed in testdata/deviations.txt: §2 holds the
// unaided draft itself, not only where it is kept, so the per-pass diagnosis
// (internal/capabilities/writingdiag) can quote it. The draft is a long field
// of up to 20,000 characters.
//
// The retests count from the day that draft is first saved: up's Days 3–7,
// Day 14 and Day 30 rows of §10, at +5, +14 and +30 (the plan's offsets for
// up's "Days 3–7" window).

// WritingEvidenceKind is the kind id the diagnosis accepts.
const WritingEvidenceKind = "writing_evidence"

// The draft the diagnosis reads, and the §6 table its passes follow.
const (
	WritingDraftSection  = "draft"
	WritingDraftField    = "draft"
	WritingTaskSection   = "task"
	WritingPassesSection = "passes"
	WritingPassesField   = "passes"
)

// WritingPasses are §6's five passes, in up's order: pass n is
// WritingPasses[n-1], a row key of the passes table.
var WritingPasses = []string{"task_fact", "structure", "sentence", "register", "delivery"}

var writingEvidence = Kind{
	Kind: WritingEvidenceKind, Name: "Writing evidence", Group: GroupLanguage, Version: 1,
	Source: "docs/en/templates/writing-evidence.md",
	Summary: "One real piece of writing, start to finish: your own first draft, the facts behind it, " +
		"five revision passes, what readers and tools changed, and whether it still holds up weeks later.",
	Attach: AttachState,
	// §10's retests, counted from the day the unaided draft is first saved.
	Reviews: []Review{
		{Key: "days_3_7", Label: "Parallel text (days 3–7)", Days: 5, From: Anchor{Section: WritingDraftSection, Field: WritingDraftField}},
		{Key: "day_14", Label: "New audience (day 14)", Days: 14, From: Anchor{Section: WritingDraftSection, Field: WritingDraftField}},
		{Key: "day_30", Label: "Real delivery (day 30)", Days: 30, From: Anchor{Section: WritingDraftSection, Field: WritingDraftField}},
	},
	RowReviews: []RowReview{
		{Section: "retest", Field: "timeline", Row: "days_3_7", Review: "days_3_7"},
		{Section: "retest", Field: "timeline", Row: "day_14", Review: "day_14"},
		{Section: "retest", Field: "timeline", Row: "day_30", Review: "day_30"},
	},
	Sections: []Section{
		// §1
		{Key: WritingTaskSection, Title: "Task, reader and responsibility",
			Hint: "Name the real piece of writing and who answers for it. Where a school, client or employer forbids help, their rule wins.",
			Fields: []Field{
				{Key: "situation", Label: "Real situation", Type: Text},
				{Key: "task", Label: "Task", Type: Choice,
					Options: []string{"explain", "request", "status", "decide", "narrate", "reflect", "hand over"}},
				{Key: "audience", Label: "Audience and relationship", Type: Text},
				{Key: "reader_outcome", Label: "What should the reader understand, decide or do afterwards?", Type: Text},
				{Key: "genre", Label: "Genre, length and deadline", Type: Text},
				{Key: "done_when", Label: "Completion standard", Type: Text},
				{Key: "help_allowed", Label: "Help allowed (dictionary, translation, search, AI, people)", Type: Text},
				{Key: "boundary", Label: "Confidentiality, copyright, privacy and authorship limits", Type: Text},
				{Key: "owner", Label: "Final accountable owner", Type: Text},
			}},
		// §2
		{Key: WritingDraftSection, Title: "Unaided draft",
			Hint: "Paste the draft as you first wrote it, before any translated sentence or AI prose. Its rough spots are the baseline every later pass is measured against.",
			Fields: []Field{
				{Key: WritingDraftField, Label: "The draft", Type: Long, MaxLen: MaxLongCeiling},
				{Key: "location", Label: "Where the raw draft is kept", Type: Text},
				{Key: "first_version", Label: "First version: time and length", Type: Text},
				{Key: "inputs", Label: "Outline or sources allowed", Type: Text},
				{Key: "remember", Label: "The one sentence the reader should remember", Type: Text},
				{Key: "weakest_fact", Label: "The fact I trust least", Type: Text},
				{Key: "hidden_gap", Label: "The gap polished prose would most likely hide", Type: Text},
				{Key: "expected_action", Label: "What I expect the reader to do after the first version", Type: Text},
			}},
		// §3
		{Key: "facts", Title: "Facts and responsibility",
			Hint: "One row per claim the text rests on, so fact, source and inference stay apart.",
			Fields: []Field{
				{Key: "ledger", Label: "Fact ledger", Type: Table, MaxRows: 30, Columns: []Field{
					{Key: "claim", Label: "Claim or content", Type: Text},
					{Key: "type", Label: "Type", Type: Choice,
						Options: []string{"fact", "number", "quotation", "experience", "inference", "advice", "other-person data"}},
					{Key: "source", Label: "Source, version and location", Type: Text},
					{Key: "checked_on", Label: "Check date", Type: Date},
					{Key: "confidence", Label: "Confidence", Type: Text},
					{Key: "publishable", Label: "Publishable?", Type: YesNo},
					{Key: "changes_it", Label: "What would change it?", Type: Text},
				}},
				{Key: "learned_later", Label: "What I knew then, and what I learned later", Type: Long},
				{Key: "permission", Label: "Third-party content that needs permission", Type: Text},
				{Key: "unverifiable", Label: "What still cannot be verified", Type: Text},
				{Key: "remove", Label: "What to remove or anonymise before delivery", Type: Text},
			}},
		// §4
		{Key: "skeleton", Title: "Document skeleton",
			Hint: "The bones of the text, written as plain lines, then what each paragraph is for.",
			Fields: []Field{
				{Key: "problem", Label: "The problem the reader faces", Type: Text},
				{Key: "answer", Label: "Direct answer", Type: Text},
				{Key: "support_1", Label: "Support 1", Type: Text},
				{Key: "support_2", Label: "Support 2", Type: Text},
				{Key: "example", Label: "A concrete example or the minimum fact", Type: Text},
				{Key: "limit", Label: "Limit, counterexample or unknown", Type: Text},
				{Key: "next_step", Label: "The reader's next step", Type: Text},
				{Key: "paragraphs", Label: "Paragraphs", Type: Table, MaxRows: 30, Columns: []Field{
					{Key: "paragraph", Label: "Paragraph", Type: Text},
					{Key: "function", Label: "Function", Type: Choice, Options: []string{
						"context", "problem", "claim", "reason", "evidence", "example",
						"turn", "limit", "request", "decision", "handover"}},
					{Key: "keep", Label: "Must keep", Type: Text},
					{Key: "move", Label: "Delete or move", Type: Text},
					{Key: "reason", Label: "Reason", Type: Text},
				}},
			}},
		// §5
		{Key: "translation", Title: "Translation and meaning",
			Hint: "Natural, fluent and faithful are three separate judgements; the final author says which one gave way, and why.",
			Fields: []Field{
				{Key: "changes", Label: "Meaning changes", Type: Table, MaxRows: 30, Columns: []Field{
					{Key: "meaning", Label: "What I mean", Type: Text},
					{Key: "first_draft", Label: "My first English draft", Type: Text},
					{Key: "candidate", Label: "Translation or tool candidate", Type: Text},
					{Key: "decision", Label: "Final decision", Type: Text},
					{Key: "reason", Label: "Reason", Type: Text},
				}},
				{Key: "agent", Label: "Did the agent or the responsibility change?", Type: Text},
				{Key: "certainty", Label: "Was certainty made stronger or weaker?", Type: Text},
				{Key: "scope", Label: "Did the scope of a negation or condition change?", Type: Text},
				{Key: "tone", Label: "Does the tone fit the relationship?", Type: Text},
				{Key: "term", Label: "A term with no equivalent across institutions or cultures", Type: Text},
				{Key: "glossary", Label: "Glossary and reviewer", Type: Text},
			}},
		// §6
		{Key: WritingPassesSection, Title: "Five revision passes",
			Hint: "Each pass asks one question of the whole text. Record only the one to three changes that matter most to the result — before, after, and why.",
			Fields: []Field{
				{Key: WritingPassesField, Label: "Passes", Type: Table, RowHeader: "Pass",
					Rows: []Row{
						{Key: "task_fact", Label: "Task and fact"},
						{Key: "structure", Label: "Structure and evidence"},
						{Key: "sentence", Label: "Sentence and meaning"},
						{Key: "register", Label: "Register and voice"},
						{Key: "delivery", Label: "Delivery and boundary"},
					},
					Columns: []Field{
						{Key: "problem", Label: "Main problem", Type: Text},
						{Key: "before", Label: "Before", Type: Long},
						{Key: "after", Label: "After", Type: Long},
						{Key: "why", Label: "Why it changes the task result", Type: Long},
					}},
				{Key: "necessary", Label: "A correction that was necessary", Type: Text},
				{Key: "ambiguity", Label: "An ambiguity repaired", Type: Text},
				{Key: "register", Label: "The register chosen", Type: Text},
				{Key: "voice", Label: "Personal voice kept", Type: Text},
				{Key: "rejected", Label: "A change I rejected because I could not explain it", Type: Text},
			}},
		// §7
		{Key: "feedback", Title: "Feedback uptake",
			Hint: "Ask the reader to retell the text before they comment. A comment counts as taken up when it shows in a new, parallel text, not only in this one.",
			Fields: []Field{
				{Key: "retold", Label: "The point the reader retold", Type: Text},
				{Key: "heard", Label: "Evidence and limits the reader heard", Type: Text},
				{Key: "next_step", Label: "The next step the reader understood", Type: Text},
				{Key: "guessing", Label: "Where the reader had to guess", Type: Text},
				{Key: "items", Label: "Feedback", Type: Table, MaxRows: 30, Columns: []Field{
					{Key: "feedback", Label: "Feedback", Type: Text},
					{Key: "source", Label: "Source or relationship", Type: Choice,
						Options: []string{"real reader", "peer", "teacher", "editor", "AI"}},
					{Key: "category", Label: "Category", Type: Choice,
						Options: []string{"correction", "ambiguity", "structure", "evidence", "register", "style"}},
					{Key: "decision", Label: "Decision", Type: Choice,
						Options: []string{"accept", "partly", "reject", "defer"}},
					{Key: "reason", Label: "Reason", Type: Text},
					{Key: "parallel", Label: "Used in a parallel text?", Type: YesNo},
				}},
			}},
		// §8
		{Key: "ai", Title: "AI and automated tools",
			Hint: "What a model offers is a candidate. Authorship and the final responsibility stay with you.",
			Fields: []Field{
				{Key: "tool", Label: "Tool, model, version and date", Type: Text},
				{Key: "before_use", Label: "Draft and sources that existed before use", Type: Text},
				{Key: "request", Label: "Request", Type: Multi, Other: true, Options: []string{
					"diagnosis", "reader simulation", "fact candidate", "correction",
					"version comparison", "counterexample"}},
				{Key: "generated", Label: "What the model generated or rewrote", Type: Text},
				{Key: "invented", Label: "Facts, quotations or sources it may have invented", Type: Text},
				{Key: "verification", Label: "My item-by-item verification", Type: Long},
				{Key: "accepted", Label: "What I accepted or rejected, and why", Type: Long},
				{Key: "disclosure", Label: "Disclosure owed to a school, client, employer or reader", Type: Text},
				{Key: "parallel", Label: "A parallel task done after closing the tool", Type: Text},
			}},
		// §9
		{Key: "delivery", Title: "Asynchronous delivery check",
			Hint: "Read the text as someone who cannot ask you anything.",
			Fields: []Field{
				{Key: "checks", Label: "Delivery check", Type: Table, RowHeader: "Check",
					Rows: []Row{
						{Key: "conclusion", Label: "One-sentence conclusion or subject"},
						{Key: "done", Label: "Work completed, and where its evidence is"},
						{Key: "risk", Label: "Risks, blocks and unknowns"},
						{Key: "decides", Label: "Who decides what, by when"},
						{Key: "next", Label: "Next step, owner and checkpoint"},
						{Key: "silence", Label: "What happens if nobody responds"},
						{Key: "rollback", Label: "Failure, stop and rollback"},
						{Key: "links", Label: "Links, attachments and permissions"},
					},
					Columns: []Field{
						{Key: "content", Label: "Content", Type: Text},
						{Key: "accepted", Label: "Accepted?", Type: YesNo},
					}},
				{Key: "continue", Label: "Can the reader carry on without another meeting?", Type: Text},
				{Key: "response", Label: "What the reader actually did or answered", Type: Text},
				{Key: "oral_gap", Label: "A gap that still needed explaining aloud", Type: Text},
			}},
		// §10
		{Key: "retest", Title: "Delayed retention and transfer",
			Hint: "A better old draft does not show the skill moved. Each later row opens on its date and asks for a new text under a harder condition.",
			Fields: []Field{
				{Key: "timeline", Label: "Retests", Type: Table, RowHeader: "Time",
					Rows: []Row{
						{Key: "day_1", Label: "Day 1"},
						{Key: "days_3_7", Label: "Days 3–7"},
						{Key: "day_14", Label: "Day 14"},
						{Key: "day_30", Label: "Day 30"},
					},
					Columns: []Field{
						{Key: "removed", Label: "What is removed", Type: Label, Text: map[string]string{
							"day_1":    "No prose written by AI",
							"days_3_7": "Earlier sentences and comments",
							"day_14":   "Recent feedback and translations",
							"day_30":   "Every practice prompt",
						}},
						{Key: "changed", Label: "Changed condition", Type: Label, Text: map[string]string{
							"day_1":    "The original task",
							"days_3_7": "A new topic in the same genre",
							"day_14":   "A new audience for the same information",
							"day_30":   "A real email, report, application or handover",
						}},
						{Key: "output", Label: "Output", Type: Label, Text: map[string]string{
							"day_1":    "Draft and delivered version",
							"days_3_7": "A parallel text",
							"day_14":   "The same content in another register",
							"day_30":   "A complete delivery",
						}},
						{Key: "result", Label: "Result", Type: Long},
					}},
				{Key: "after_week", Label: "Structure and judgement still there after seven days", Type: Text},
				{Key: "returned", Label: "A problem that came back with a new topic", Type: Text},
				{Key: "dependence", Label: "Did reliance on whole-sentence translation or full rewrites drop?", Type: Text},
				{Key: "less_guessing", Label: "Did the reader have to guess less?", Type: Text},
				{Key: "next_variable", Label: "One variable for the next cycle", Type: Text},
			}},
		// §11
		{Key: "sign", Title: "Score and sign-off",
			Fields: []Field{
				{Key: "scores", Label: "Scores", Type: Table, RowHeader: "Item",
					Rows: []Row{
						{Key: "independent", Label: "Leave an independent draft"},
						{Key: "clear", Label: "Make the task, the reader and the next step clear"},
						{Key: "separate", Label: "Keep fact, source and inference apart"},
						{Key: "support", Label: "Back the conclusion with structure and evidence"},
						{Key: "explain", Label: "Explain what translation, AI and feedback changed"},
						{Key: "async", Label: "Let a reader who cannot ask carry on or roll back"},
						{Key: "transfer", Label: "Deliver after the topic, audience or genre changes"},
					},
					Columns: []Field{
						{Key: "day_1", Label: "Day 1", Type: Score, ScoreLabels: writingScoreLabels},
						{Key: "day_7", Label: "Day 7", Type: Score, ScoreLabels: writingScoreLabels},
						{Key: "day_14", Label: "Day 14", Type: Score, ScoreLabels: writingScoreLabels},
						{Key: "reason", Label: "Evidence for the score", Type: Text},
					}},
				{Key: "verdict", Label: "Current version", Type: Choice,
					Options: []string{"willing to sign", "needs verification", "narrow scope", "do not deliver"}},
				{Key: "evidence", Label: "The most important evidence", Type: Text},
				{Key: "open_conclusion", Label: "A conclusion I still cannot draw", Type: Text},
				{Key: "smallest_next", Label: "The smallest next task", Type: Text},
				{Key: "next_review", Label: "Next review date", Type: Date},
			}},
	},
}

// writingScoreLabels are up's 0–2 anchors for §11, reworded.
var writingScoreLabels = []string{"not done", "only with prompts, or unsteady", "done under the current condition"}

func init() { register(writingEvidence) }
