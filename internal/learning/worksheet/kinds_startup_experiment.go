package worksheet

// Phase 2 of the private design notes: up's startup experiment
// card, one business assumption tested within an effort limit (structure
// only; wording written fresh).
//
//   - docs/en/templates/startup-experiment.md, "Copy the Blank Card": one
//     code block with no headings of its own (-sections 1);
//   - docs/en/threads/practice/customer-discovery.md §1–§6 and
//     docs/en/threads/practice/sustainable-business.md §3 and §7,
//     summarised in the hints.
//
// The card's blank-line groups become sections that continue the first
// (Section.Continues), so the harness counts them as up's one section:
// assumption, alternatives, counterevidence, manual pilot, effort limit,
// result and the bounded conclusion. up's "complete before starting" and
// "complete after ending" markers are the hints of the first and the result.
// The main assumption line is up's fifth, after the alternatives; it heads
// the card here, in the section named for it.

// StartupExperimentKind is the kind's id.
const StartupExperimentKind = "startup_experiment"

var startupExperiment = Kind{
	Kind: StartupExperimentKind, Name: "Startup experiment", Group: GroupProjects, Version: 1,
	Source: "docs/en/templates/startup-experiment.md",
	Summary: "Test one business assumption before putting in more effort: who has the task and what they use " +
		"now, the strongest case against you, a manual pilot inside a time and cash limit, the conditions " +
		"decided in advance, and a conclusion that claims no more than the evidence.",
	Attach: AttachState,
	Reviews: []Review{
		{Key: "next_review", Label: "Next review", Days: 0, From: Anchor{Section: "conclusion", Field: "next_review"}},
	},
	Sections: []Section{
		{Key: "assumption", Title: "Assumption",
			Hint: "Fill everything down to the effort limit before you contact anyone. Narrow the idea to one " +
				"person and one task, and keep the user, the person who decides to adopt and the person who pays " +
				"apart: they are often not the same. Test one main assumption; questions outside it go on a list, " +
				"not into this card.",
			Fields: []Field{
				{Key: "name", Label: "Experiment name or identifier", Type: Text},
				{Key: "owner", Label: "Owner, start and end dates", Type: Text},
				{Key: "informs", Label: "The next decision this experiment informs", Type: Text},
				{Key: "users", Label: "Target users and their specific task", Type: Text},
				{Key: "roles", Label: "User / who decides to adopt / who pays", Type: Text},
				{Key: "recent", Label: "Evidence the task happened recently", Type: Text},
				{Key: "assumption", Label: "Main assumption: one statement that could be shown wrong", Type: Text},
			}},
		{Key: "alternatives", Title: "Alternatives", Continues: true,
			Hint: "Alternatives are more than rival products: doing it by hand, outsourcing, doing less, waiting, " +
				"or not doing it at all. For each, note the result, the time, the spending and who would have to " +
				"change their habits.",
			Fields: []Field{
				{Key: "alternatives", Label: "What people use now, and what it costs them", Type: Long},
			}},
		{Key: "counterevidence", Title: "Counterevidence", Continues: true,
			Hint: "Look for people for whom the current way is good enough, or who only need help in a busy " +
				"season. They are not people who fail to understand the idea.",
			Fields: []Field{
				{Key: "counter", Label: "The strongest counterexample or other explanation", Type: Long},
			}},
		{Key: "pilot", Title: "Manual pilot", Continues: true,
			Hint: "Deliver a narrow service by hand before automating anything, and say which parts a person does. " +
				"Ask about what people did last time, not whether they would buy. Friends are easier to reach: " +
				"label them, and record invitations, refusals and silence, which is not a yes.",
			Fields: []Field{
				{Key: "channel", Label: "Contact channel and who qualifies", Type: Text},
				{Key: "planned", Label: "Planned invitations / interviews / pilots", Type: Text},
				{Key: "bias", Label: "Possible recruitment bias, such as friends or volunteers", Type: Text},
				{Key: "deliverables", Label: "What the pilot delivers, and what it leaves out", Type: Text},
				{Key: "terms", Label: "Price, revision scope, delivery and how it is accepted", Type: Text},
				{Key: "split", Label: "What people do and what tools do", Type: Text},
				{Key: "consent", Label: "Permission for materials, consent to record, retention and deletion", Type: Text},
			}},
		{Key: "limits", Title: "Effort limit", Continues: true,
			Hint: "Count your own hours too: recruiting, talking, preparing, producing, revising and support. Time " +
				"you save that becomes extra checking for the user is not a saving. The conditions below are " +
				"written now, before any result, and the limit is when the round stops.",
			Fields: []Field{
				{Key: "baseline", Label: "The old process's baseline: quality, time on both sides, spending", Type: Text},
				{Key: "behaviour", Label: "The behaviour to record as evidence, and where it is kept", Type: Text},
				{Key: "continue_if", Label: "Conditions for continuing, set in advance", Type: Text},
				{Key: "adjust_if", Label: "Conditions for adjusting, set in advance", Type: Text},
				{Key: "stop_if", Label: "Conditions for stopping or pausing, set in advance", Type: Text},
				{Key: "limit", Label: "Time limit / cash limit / deadline", Type: Text},
				{Key: "stopper", Label: "Who can stop it, and how unfinished commitments are handled", Type: Text},
			}},
		{Key: "result", Title: "Result", Continues: true,
			Hint: "Fill this after the round ends. Keep only anonymous summaries here; contact details and receipts " +
				"belong somewhere restricted. Separate what people said, what they did, and what you make of it.",
			Fields: []Field{
				{Key: "counts", Label: "Invitations / responses / interviews / quotes / payments / acceptances", Type: Text},
				{Key: "observed", Label: "What users did (anonymous ID, date, evidence summary)", Type: Long},
				{Key: "refusals", Label: "Counterexamples, refusals and withdrawals, with their reasons", Type: Text},
				{Key: "money", Label: "Quotes, payments received, refunds and spending", Type: Text},
				{Key: "hours", Label: "All hours: recruiting, talking, preparing, producing, revising, support", Type: Text},
				{Key: "comparison", Label: "The old and new process compared, and what still cannot be compared", Type: Text},
				{Key: "departures", Label: "Where the round departed from the plan, and why", Type: Text},
			}},
		{Key: "conclusion", Title: "Bounded conclusion", Continues: true,
			Hint: "Claim only what this round shows: an early payment signal is not a validated product. Continue " +
				"when the conditions were met inside the limit; adjust one main thing when a need is there but a " +
				"process, scope or price assumption failed; stop or pause when the core conditions failed or the " +
				"limit was reached, and settle what you promised. Too few observations means not enough evidence, " +
				"which is neither success nor failure.",
			Fields: []Field{
				{Key: "supports", Label: "What the evidence supports, and what it does not", Type: Long},
				{Key: "decision", Label: "Decision", Type: Choice,
					Options: []string{"continue", "adjust", "stop", "insufficient evidence, pause"}},
				{Key: "reason", Label: "Why", Type: Text},
				{Key: "commitments", Label: "Unfinished commitments, and who is responsible", Type: Text},
				{Key: "change", Label: "The one main change for the next round", Type: Text},
				{Key: "would_change", Label: "What new fact would change this judgement", Type: Text},
				{Key: "next_review", Label: "Next review date", Type: Date},
			}},
	},
}

func init() { register(startupExperiment) }
