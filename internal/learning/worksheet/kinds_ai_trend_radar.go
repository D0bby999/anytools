package worksheet

// Phase 2 of the private design notes: up's AI trend experiment,
// one capability taken from a signal to a decision (structure only; wording
// written fresh).
//
//   - docs/en/templates/ai-trend-radar.md, "Copyable Record": its five
//     numbered sections, read with the generator's -fenced mode
//     (-sections 3-7), and "Order of Judgment" in the hints;
//   - docs/en/threads/part-3/6-ai-trends-and-learning-roadmap.md, "Build a
//     Trend Radar First" and "Compare All Six Experiments the Same Way",
//     summarised in the hints and the decision's options.
//
// The primary source is required (phase 2 requirement 3): a decision on a
// trend, or a radar marked done, needs §1's source line (checkTrendSource).

// The trend radar's ids.
const (
	AITrendRadarKind = "ai_trend_radar"
	TrendSignal      = "signal"
	TrendSource      = "source"
	TrendDecision    = "decision"
)

var aiTrendRadar = Kind{
	Kind: AITrendRadarKind, Name: "AI trend radar", Group: GroupProjects, Version: 1,
	Source: "docs/en/templates/ai-trend-radar.md",
	Summary: "Take one AI capability from the signal you saw to a decision: the primary source and what it " +
		"really shows, the task it might help with, the smallest experiment against a manual baseline, " +
		"what it cost, and whether to continue, downgrade or stop.",
	Attach: AttachState,
	// up's last line: an owner and a review thirty days on, counted from
	// the day the decision is first made.
	Reviews: []Review{
		{Key: "thirty_day", Label: "Thirty-day review", Days: 30, From: Anchor{Section: TrendDecision, Field: TrendDecision}},
	},
	Check: checkTrendSource,
	Sections: []Section{
		// §1
		{Key: TrendSignal, Title: "Signal and evidence",
			Hint: "A signal means watch it, not adopt it. Tool access is not reliable completion, platform memory " +
				"is not a learning state you can carry, recognising an image is not understanding it, and a " +
				"demo score is not a stable deployment.",
			Fields: []Field{
				{Key: "trend", Label: "Trend or capability", Type: Text},
				{Key: TrendSource, Label: "Primary source, its date or version, and when I read it", Type: Text,
					Hint: "Required before a decision. A retelling or a product page is not the primary source."},
				{Key: "observed", Label: "What the source itself observes", Type: Long},
				{Key: "judgement", Label: "My conditional judgement or hypothesis about what comes next", Type: Text},
				{Key: "unknown", Label: "What is unknown, may change, or is not supported by the source", Type: Text},
			}},
		// §2
		{Key: "task", Title: "Real task",
			Hint: "No manual baseline, no inspectable result and no stop condition means no wider scope.",
			Fields: []Field{
				{Key: "user", Label: "Who, in what situation, and the action to complete", Type: Text},
				{Key: "bottleneck", Label: "The bottleneck today", Type: Text},
				{Key: "baseline", Label: "Manual baseline without the new capability: where it is, the time and the quality", Type: Text},
				{Key: "unsupported", Label: "Tasks or inputs it is not meant to handle", Type: Text},
			}},
		// §3
		{Key: "experiment", Title: "Smallest experiment",
			Fields: []Field{
				{Key: "change", Label: "The one thing changed this round", Type: Text},
				{Key: "setup", Label: "Model, version, region, prompt, materials, memory and tools", Type: Text},
				{Key: "modes", Label: "Input modes allowed", Type: Multi,
					Options: []string{"text", "audio", "image", "video", "mixed"}},
				{Key: "boundaries", Label: "Limits on data, copyright, privacy and permissions", Type: Text},
				{Key: "automation", Label: "Automation allowed", Type: Choice,
					Options: []string{"read-only", "draft", "reversible action", "irreversible action (approval required)"}},
				{Key: "cases", Label: "Cases: normal, missing, conflicting, outdated, failing and prompt injection", Type: Text},
				{Key: "sets", Label: "Development set, and a held-out set kept out of tuning", Type: Text},
			}},
		// §4
		{Key: "evidence", Title: "Evidence and cost",
			Hint: "Keep four samples: the manual baseline, the AI-assisted one, one made on your own with the tool " +
				"closed, and one under changed conditions. Check sources and permissions first, then the facts " +
				"and the task's outcome, and only then speed, style or price. Keep recognition errors apart from " +
				"knowledge errors.",
			Fields: []Field{
				{Key: "ai_sample", Label: "Where the AI sample is kept", Type: Text},
				{Key: "outcome", Label: "Tool calls, authorisation, and the final state of the environment", Type: Text},
				{Key: "independent", Label: "Independent sample made after closing the AI", Type: Text},
				{Key: "parallel", Label: "Parallel task, with the topic, audience, mode or tool changed", Type: Text},
				{Key: "accepted", Label: "Accepted on the first pass / accepted after human repair", Type: Text},
				{Key: "time", Label: "Total time: preparation, run, checking, rework and maintenance", Type: Text},
				{Key: "charges", Label: "Tool charges, device resources, and the value put on human time", Type: Text},
				{Key: "failures", Label: "Failures of source, recognition, fact, permission and safety", Type: Text},
			}},
		// §5
		{Key: TrendDecision, Title: "Decision and exit",
			Hint: "Continue when the hard gates pass, the independent or changed-condition sample improves and the " +
				"upkeep is acceptable. Downgrade when it helps but is too risky or costly: read-only, drafts, or a " +
				"person approves. Stop when sources cannot be checked, permissions cannot be held, the harm is " +
				"unacceptable, the cost passes its ceiling, or the manual baseline is better.",
			Fields: []Field{
				{Key: "gates", Label: "Did every hard gate pass? Where is the evidence?", Type: Text},
				{Key: TrendDecision, Label: "Decision", Type: Choice, Options: []string{"continue", "downgrade", "stop"}},
				{Key: "scope", Label: "Permitted scope, and when a person takes over", Type: Text},
				{Key: "retest", Label: "What triggers a retest after a model, material, tool or memory change", Type: Text},
				{Key: "fallback", Label: "A version to restore, a path without the tools, or a manual fallback", Type: Text},
				{Key: "portable", Label: "Can the work carry on after switching provider or session?", Type: Text},
				{Key: "owner", Label: "Owner and the thirty-day review date", Type: Text},
			}},
	},
}

// checkTrendSource refuses a decision, or a done radar, with no primary
// source in §1.
func checkTrendSource(a Answers, status string) error {
	if cellText(a[TrendSignal], TrendSource) != "" {
		return nil
	}
	if status == StatusDone || cellText(a[TrendDecision], TrendDecision) != "" {
		return &FieldError{Field: TrendSignal + "." + TrendSource,
			Reason: "name the primary source before deciding on a trend"}
	}
	return nil
}

func init() { register(aiTrendRadar) }
