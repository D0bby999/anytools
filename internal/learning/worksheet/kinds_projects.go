package worksheet

// Phase 8 of the private design notes: three of up's worksheets about
// turning learning into delivered work and reviewing it honestly (structure
// only; wording written fresh).
//
//   - artifact_brief       docs/en/templates/artifact-brief.md, §1–§5
//   - ai_case_review       docs/en/templates/ai-case-review.md
//   - ai_project_scorecard docs/en/templates/ai-project-scorecard.md
//
// The two AI templates are each one code block whose own headings are the
// sections; their outlines are read with the generator's -fenced mode.

// The artifact brief's ids the page relies on (artifact-extras.tsx): the
// quality gates whose empty evidence reads "unverified", and §5's delivery
// line, which schedules the parallel test and opens "Add to evidence".
const (
	ArtifactBriefKind    = "artifact_brief"
	ArtifactGatesSection = "gates"
	ArtifactGatesField   = "gates"
	ArtifactDelivery     = "delivery"
	ArtifactDeliveredOn  = "date_version"
)

// up: docs/en/templates/artifact-brief.md, §1–§5.
var artifactBrief = Kind{
	Kind: ArtifactBriefKind, Name: "Artifact brief", Group: GroupProjects, Version: 1,
	Source: "docs/en/templates/artifact-brief.md",
	Summary: "Set the edges of one thing you are making before it is finished: who it is for, what done means, " +
		"which versions to keep, how its quality is shown, and how it is handed over and rolled back.",
	Attach: AttachState,
	// up's closing rule for §5: a parallel test three to seven days after
	// delivery, counted from the day the delivery line is first filled.
	Reviews: []Review{
		{Key: "parallel_test", Label: "Parallel test after delivery", Days: 5,
			From: Anchor{Section: ArtifactDelivery, Field: ArtifactDeliveredOn}},
	},
	Sections: []Section{
		// §1
		{Key: "boundary", Title: "Artifact boundary",
			Hint: "It does not have to be finished on day one, but its edges do. Leave out passwords, client data, other people's information you have no right to, and personal details you do not need.",
			Fields: []Field{
				{Key: "name", Label: "Artifact name", Type: Text},
				{Key: "situation", Label: "Real situation", Type: Text},
				{Key: "audience", Label: "Audience or user", Type: Text},
				{Key: "problem", Label: "The one problem it solves", Type: Text},
				{Key: "inputs", Label: "Inputs and sources", Type: Text},
				{Key: "baseline", Label: "Where I start from", Type: Text},
				{Key: "assumptions", Label: "Key assumptions", Type: Text},
				{Key: "smallest", Label: "Smallest deliverable", Type: Text},
				{Key: "constraints", Label: "Format, time and other constraints", Type: Text},
				{Key: "acceptance", Label: "Acceptance criteria", Type: Long},
				{Key: "excluded", Label: "What it will not include", Type: Text},
				{Key: "first_deadline", Label: "First-version deadline", Type: Date},
				{Key: "feedback_from", Label: "Who gives feedback", Type: Text},
				{Key: "evidence", Label: "Evidence to keep", Type: Text},
				{Key: "shrink", Label: "How to cut it down, pause it or roll it back", Type: Text},
				{Key: "next_review", Label: "Next review date", Type: Date},
			}},
		// §2: up's table, read only. Nothing is added to it (red team AS-7).
		{Key: "versions", Title: "Four versions",
			Hint: "Keep each version as you finish it. The table says what finishes a version and what to keep from it.",
			Fields: []Field{
				{Key: "versions", Label: "Versions", Type: Table, RowHeader: "Version",
					Rows: []Row{
						{Key: "independent", Label: "Independent"},
						{Key: "structure", Label: "Structure"},
						{Key: "review", Label: "Review"},
						{Key: "delivery", Label: "Delivery"},
					},
					Columns: []Field{
						{Key: "condition", Label: "Done when", Type: Label, Text: map[string]string{
							"independent": "The smallest action is done with no answer key, and no AI writing it for you",
							"structure":   "The audience can find the problem, the conclusion and the next step",
							"review":      "A real reader, user or peer, or an AI reviewer given a set role, has reviewed it",
							"delivery":    "Someone else can start from it without you explaining it aloud",
						}},
						{Key: "keep", Label: "What to keep", Type: Label, Text: map[string]string{
							"independent": "The original file, the time it took, where you got stuck",
							"structure":   "What the restructuring changed, with facts and guesses marked",
							"review":      "The feedback, the kinds of error, and why each point was taken or turned down",
							"delivery":    "Version, limits, sources, known issues and the handover record",
						}},
					}},
			}},
		// §3
		{Key: ArtifactGatesSection, Title: "Quality gates",
			Fields: []Field{
				{Key: ArtifactGatesField, Label: "Quality gates", Type: Table, RowHeader: "Gate",
					Rows: []Row{
						{Key: "clear", Label: "Clear"},
						{Key: "accurate", Label: "Accurate"},
						{Key: "usable", Label: "Usable"},
						{Key: "maintainable", Label: "Maintainable"},
						{Key: "accountable", Label: "Accountable"},
					},
					Columns: []Field{
						{Key: "check", Label: "Check", Type: Label, Text: map[string]string{
							"clear":        "Does the audience know the problem, and what to do next?",
							"accurate":     "Does every fact, citation, piece of code and number lead back to a source or a test?",
							"usable":       "Does the main action work under the real constraints?",
							"maintainable": "Can someone see the version, the dependencies, the limits and the owner?",
							"accountable":  "Are privacy, copyright, permissions and the cost of a mistake dealt with?",
						}},
						// up, artifact-brief.md §3: a pass with no evidence is
						// written "unverified". The page shows that word on a
						// gate whose evidence location is empty.
						{Key: "evidence", Label: "Evidence location", Type: Text,
							Hint: "A gate with no evidence is unverified, whatever you think of it. Speed, word count and the number of features stand in for quality; they are not gates."},
						{Key: "owner", Label: "Owner/date", Type: Text},
					}},
			}},
		// §4
		{Key: "ai", Title: "AI and feedback record",
			Hint: "Keep your own version first. Then AI may diagnose, play the audience or set a parallel task; a person still checks the key facts, permissions, privacy, cost and who the author is.",
			Fields: []Field{
				{Key: "tool", Label: "AI or tool, and date", Type: Text},
				{Key: "allowed", Label: "What it was allowed to do", Type: Text},
				{Key: "kept", Label: "Judgements I kept for myself", Type: Text},
				{Key: "issues", Label: "The three issues it raised that matter most", Type: Long},
				{Key: "decisions", Label: "What I took or turned down, and why", Type: Long},
				{Key: "restated", Label: "The main point, as a real reader or user put it back", Type: Text},
				{Key: "repair", Label: "The most important repair", Type: Text},
			}},
		// §5
		{Key: ArtifactDelivery, Title: "Delivery and rollback",
			Hint: "Handing it over is not the end. A few days later run a parallel test: can someone else start on their own, what still needed explaining, and the one change for the next version. The retest is set five days after the delivery line is first filled.",
			Fields: []Field{
				{Key: "scope", Label: "Who receives it, and what they may do with it", Type: Text},
				{Key: ArtifactDeliveredOn, Label: "Delivery date and version", Type: Text},
				{Key: "instructions", Label: "Instructions", Type: Long},
				{Key: "limits", Label: "Known limits", Type: Text},
				{Key: "support", Label: "Support owner or contact", Type: Text},
				{Key: "cost", Label: "Cost, and how long it is kept", Type: Text},
				{Key: "trigger", Label: "What triggers a pause, a cut-down or a rollback", Type: Text},
				{Key: "notify", Label: "Who must be told after a problem", Type: Text},
				{Key: "next_review", Label: "Next review date", Type: Date},
			}},
	},
}

// caseReviewSections are up's AI case review (docs/en/templates/
// ai-case-review.md): source and facts, judgement, result, transferable
// principles. The narrative case review starts from the same four
// (kinds_narrative_case_review.go), so each call returns a fresh copy.
func caseReviewSections() []Section {
	return []Section{
		{Key: "source", Title: "Source and facts",
			Hint: "Work only from the person's own public writing, official pages, or material you are allowed to use. A retelling by someone else cannot, on its own, prove a skill, an income or a project's effect.",
			Fields: []Field{
				{Key: "experience", Label: "Experience or project", Type: Text},
				{Key: "primary", Label: "Primary source, and when it was published", Type: Text},
				{Key: "checked_on", Label: "Date I read and checked it", Type: Date},
				{Key: "public", Label: "What may be made public", Type: Text},
				{Key: "redact", Label: "What must be removed or blurred", Type: Text},
			}},
		{Key: "judgement", Title: "Judgement",
			Fields: []Field{
				{Key: "problem", Label: "The problem at the time", Type: Text},
				{Key: "known", Label: "What was known then", Type: Long},
				{Key: "assumptions", Label: "Assumptions", Type: Text},
				{Key: "choice", Label: "The choice that was made", Type: Text},
			}},
		{Key: "result", Title: "Result",
			Fields: []Field{
				{Key: "happened", Label: "What happened", Type: Long},
				{Key: "evidence", Label: "Evidence location", Type: Text},
				{Key: "unknown", Label: "What is still unknown", Type: Text},
				{Key: "cost", Label: "Failure or cost", Type: Text},
			}},
		{Key: "principles", Title: "Transferable principles",
			Fields: []Field{
				{Key: "holds", Label: "A principle that still holds", Type: Text},
				{Key: "old_conditions", Label: "The part that relied on the conditions of the time", Type: Text},
				{Key: "exercise", Label: "A small exercise for a reader", Type: Text},
				{Key: "test", Label: "How to test it next", Type: Text},
			}},
	}
}

// up: docs/en/templates/ai-case-review.md (the whole template).
var aiCaseReview = Kind{
	Kind: "ai_case_review", Name: "AI case review", Group: GroupProjects, Version: 1,
	Source: "docs/en/templates/ai-case-review.md",
	Summary: "Take one AI story apart: the facts and where they come from, the judgement made at the time, " +
		"what actually happened, and which principle still carries over — so a single story does not turn into a recipe.",
	Attach:   AttachNone,
	Sections: caseReviewSections(),
}

// up: docs/en/templates/ai-project-scorecard.md (the whole template).
var aiProjectScorecard = Kind{
	Kind: "ai_project_scorecard", Name: "AI project scorecard", Group: GroupProjects, Version: 1,
	Source: "docs/en/templates/ai-project-scorecard.md",
	Summary: "Score one release or pilot of an AI project on quality, time, rework, cost, safety, user feedback " +
		"and whether it can be rolled back, rather than on how fast it was generated.",
	Attach: AttachState,
	Sections: []Section{
		// The template's header lines and its metrics table.
		{Key: "scorecard", Title: "Scorecard",
			Hint: "Fill it in after each release or pilot. Every number should lead back to a test, a ledger, a feedback record or an operations log.",
			Fields: []Field{
				{Key: "project", Label: "Project and version", Type: Text},
				{Key: "owner", Label: "Owner", Type: Text},
				{Key: "user", Label: "User and situation", Type: Text},
				{Key: "conditions", Label: "Test conditions and sample scope", Type: Text},
				{Key: "locations", Label: "Where the baseline, the assisted run and the delayed independent retest are kept", Type: Text},
				{Key: "metrics", Label: "Metrics", Type: Table, RowHeader: "Metric",
					Rows: []Row{
						{Key: "completion", Label: "Task completion"},
						{Key: "first_pass", Label: "Accepted on the first pass"},
						{Key: "latency", Label: "Latency, average and high percentile"},
						{Key: "human_time", Label: "Human time and rework"},
						{Key: "cost", Label: "Model and infrastructure cost"},
						{Key: "delayed", Label: "Delayed independent performance"},
						{Key: "security", Label: "Security and privacy issues"},
						{Key: "feedback", Label: "User feedback"},
					},
					Columns: []Field{
						{Key: "result", Label: "This result", Type: Text},
						{Key: "evidence", Label: "Evidence location", Type: Text},
						{Key: "change", Label: "Versus last time", Type: Text},
					}},
			}},
		{Key: "gates", Title: "Gates",
			Fields: []Field{
				{Key: "facts", Label: "Facts and sources checked", Type: YesNo},
				{Key: "tests", Label: "Tests and edge cases covered", Type: YesNo},
				{Key: "permissions", Label: "Permissions and data scope confirmed", Type: YesNo},
				{Key: "rollback", Label: "The pause, cut-down or rollback path works", Type: YesNo},
				{Key: "explain", Label: "The owner can explain the key decisions without the chat", Type: YesNo},
			}},
		{Key: "release", Title: "Release gates",
			Fields: []Field{
				{Key: "release", Label: "Release gates", Type: Table, RowHeader: "Gate",
					Rows: []Row{
						{Key: "requirements", Label: "Requirements and acceptance criteria"},
						{Key: "samples", Label: "Real samples and boundary tests"},
						{Key: "privacy", Label: "Permissions, privacy and retention"},
						{Key: "cost", Label: "Cost ceiling and monitoring"},
						{Key: "rollback", Label: "Pause, cut-down, rollback and notice"},
					},
					Columns: []Field{
						{Key: "evidence", Label: "Evidence location", Type: Text},
						{Key: "owner", Label: "Owner", Type: Text},
						{Key: "date", Label: "Date", Type: Date},
						{Key: "pass", Label: "Pass", Type: YesNo},
					}},
			}},
		{Key: "decision", Title: "Decision",
			Fields: []Field{
				{Key: "keep", Label: "Keep", Type: Text},
				{Key: "adjust", Label: "Adjust", Type: Text},
				{Key: "stop", Label: "Stop", Type: Text},
				{Key: "next", Label: "The smallest next experiment", Type: Text},
			}},
	},
}

func init() {
	register(artifactBrief)
	register(aiCaseReview)
	register(aiProjectScorecard)
}
