package worksheet

// Phase 2 of the private design notes: up's consistency plan, one
// action experiment with an end date (structure only; wording written fresh).
//
//   - docs/en/templates/consistency-plan.md, "Copyable Template": its heading
//     lines and its seven sections, read with the generator's -fenced mode
//     (-sections 2-9);
//   - docs/en/threads/practice/discipline-and-consistency.md, "First Find
//     Where the Process Breaks": the troubleshooting table, summarised in
//     the goal section's hint.
//
// up's heading has three lines. "Updated" is the worksheet's own updated
// date, so its place is taken by the cycle's second date: "Cycle: from to"
// is two dates, which also lets the cycle review fall due on the last day.
// Three fields for up's three lines, so the counts match and no deviation
// line is needed.
//
// Opened from a learning state, "Three versions" may start from the state's
// next task (standard) and its minimum version (minimum): the new-worksheet
// page shows both and the learner confirms (ui/web/app/lib/consistency-plan.ts).
// The bad-day contract's ask_for_help_when is private and is never read here.

// The consistency plan's ids the page relies on.
const (
	ConsistencyPlanKind = "consistency_plan"
	// The three versions table and the rows a learning state prefills.
	ConsistencyVersions       = "versions"
	ConsistencyVersionsTable  = "versions"
	ConsistencyMinimum        = "minimum"
	ConsistencyStandard       = "standard"
	ConsistencyVersionsAction = "action"
)

var consistencyPlan = Kind{
	Kind: ConsistencyPlanKind, Name: "Consistency plan", Group: GroupProjects, Version: 1,
	Source: "docs/en/templates/consistency-plan.md",
	Summary: "One change to how you keep going, tried for one cycle with an end date: what it should show, " +
		"the time you really have, how a session starts, a minimum, standard and extended version, how " +
		"to restart after a break, and what decides whether it continues.",
	Attach: AttachState,
	// The cycle review is due on the cycle's last day, and follows that
	// date if the learner moves it.
	Reviews: []Review{
		{Key: "cycle_review", Label: "Cycle review", Days: 0, From: Anchor{Section: "cycle", Field: "to"}},
	},
	Sections: []Section{
		// The template's heading lines.
		{Key: "cycle", Title: "Cycle",
			Hint: "One experiment, one cycle. It sits beside your rhythm ledger rather than replacing it: point to " +
				"the ledger's records instead of copying them, and take the conclusion back there when the cycle " +
				"ends. Write only what you actually know; leave the rest to be checked.",
			Fields: []Field{
				{Key: "from", Label: "Cycle starts", Type: Date},
				{Key: "to", Label: "Cycle ends", Type: Date,
					Hint: "The cycle review falls due on this day."},
				{Key: "review", Label: "Review date, or what brings the review forward", Type: Text},
			}},
		// §1
		{Key: "goal", Title: "Goal and evidence",
			Hint: "Start from a recent record and find the step that goes missing between the plan and the " +
				"work, rather than calling it procrastination. Other demands keep taking the slot: check whether " +
				"that time is really yours. You sit down not knowing what to do: save the file and first action " +
				"beforehand. Work never ends: shrink it to one recording, test or question. Plans pile up: finish " +
				"one task you already have. Lots of work, unclear effect: compare an earlier output against the " +
				"same criteria. A break makes you want to repay everything: drop what has expired. It runs on " +
				"overtime or broken promises: cut the scope, renegotiate or pause. These are causes to test, not " +
				"verdicts on you; pick one for this cycle.",
			Fields: []Field{
				{Key: "why_now", Label: "Why this is worth doing now", Type: Text},
				{Key: "outcome", Label: "The one outcome for this cycle", Type: Text},
				{Key: "baseline", Label: "Where I start, and where the sample is kept", Type: Text},
				{Key: "acceptance", Label: "Acceptance criteria someone could observe or check", Type: Long},
				{Key: "out_of_scope", Label: "Deliberately left out of this cycle", Type: Text},
			}},
		// §2
		{Key: "budget", Title: "Realistic budget",
			Fields: []Field{
				{Key: "responsibilities", Label: "Work, care and other responsibilities already in place", Type: Text},
				{Key: "windows", Label: "The windows I really have, and the total time for the cycle", Type: Text},
				{Key: "split", Label: "Time for preparing, doing and getting feedback", Type: Text},
				{Key: "buffer", Label: "A buffer window, if there is one", Type: Text},
				{Key: "protected", Label: "Time or resources I will not take from elsewhere", Type: Text},
				{Key: "uncertain", Label: "What needs someone's agreement, or is still uncertain", Type: Text},
			}},
		// §3
		{Key: "start", Title: "Starting point",
			Fields: []Field{
				{Key: "after", Label: "After which event I start", Type: Text},
				{Key: "where", Label: "Where I sit, and the file or resource I open", Type: Text},
				{Key: "first", Label: "The one action I do first", Type: Text},
				{Key: "obstacle", Label: "The main obstacle, and the one change for this cycle", Type: Text},
				{Key: "reachable", Label: "Contacts or alerts that must stay reachable", Type: Text},
				{Key: "save_next", Label: "The next step I save before I stop", Type: Text},
			}},
		// §4
		{Key: ConsistencyVersions, Title: "Three versions",
			Hint: "The minimum keeps the thread on a short day; it does not replace the full practice. " +
				"The extended version is optional and has its own stop.",
			Fields: []Field{
				{Key: ConsistencyVersionsTable, Label: "Versions", Type: Table, RowHeader: "Version",
					Rows: []Row{
						{Key: ConsistencyMinimum, Label: "Minimum"},
						{Key: ConsistencyStandard, Label: "Standard"},
						{Key: "extended", Label: "Extended (optional)"},
					},
					Columns: []Field{
						{Key: "when", Label: "When to use it", Type: Text},
						{Key: ConsistencyVersionsAction, Label: "Action, and when to stop", Type: Long},
						{Key: "save", Label: "What to save", Type: Text},
					}},
				{Key: "irreplaceable", Label: "Practice or checks the minimum version cannot stand in for", Type: Text},
				{Key: "max_session", Label: "Longest single session", Type: Text},
				{Key: "reduce_when", Label: "When I reduce the load", Type: Text},
				{Key: "pause_when", Label: "When I pause", Type: Text},
			}},
		// §5
		{Key: "restart", Title: "Restart after an interruption",
			Hint: "Start again from today's facts, not from a debt of missed sessions.",
			Fields: []Field{
				{Key: "state_files", Label: "State file and the latest places the work is kept", Type: Text},
				{Key: "reassess", Label: "How I check what I can still do when I first come back", Type: Text},
				{Key: "first_task", Label: "The first bounded task after the break", Type: Text},
				{Key: "next_check", Label: "When, or on what condition, I check again", Type: Text},
				{Key: "deadline", Label: "If a deadline is hit: how the scope changes, or what I negotiate", Type: Text},
			}},
		// §6
		{Key: "log", Title: "Cycle log",
			Hint: "One row per session, including the short and the missed ones.",
			Fields: []Field{
				{Key: "entries", Label: "Sessions", Type: Table, MaxRows: 60,
					Columns: []Field{
						{Key: "date", Label: "Date", Type: Date},
						{Key: "planned", Label: "Planned action", Type: Text},
						{Key: "output", Label: "What I actually produced, and where", Type: Text},
						{Key: "obstacle", Label: "Obstacle or cost", Type: Text},
						{Key: "next", Label: "Next step", Type: Text},
					}},
			}},
		// §7
		{Key: "review", Title: "Cycle review",
			Hint: "The plan is not evidence that it worked; the records are. Keep only the changes that " +
				"proved useful, and take the conclusion back to your ledger or weekly review.",
			Fields: []Field{
				{Key: "changed", Label: "What changed from the baseline, with the evidence", Type: Long},
				{Key: "not_yet", Label: "What I still cannot explain or finish on my own", Type: Text},
				{Key: "cost", Label: "Did it go over the budget or push other responsibilities aside?", Type: Text},
				{Key: "continue_if", Label: "What would make me continue", Type: Text},
				{Key: "change_if", Label: "What would make me change the method", Type: Text},
				{Key: "stop_if", Label: "What would make me pause or stop", Type: Text},
				{Key: "decision", Label: "My decision for this cycle, and why", Type: Long},
				{Key: "one_change", Label: "The one change for the next cycle", Type: Text},
			}},
	},
}

func init() { register(consistencyPlan) }
