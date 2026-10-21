package worksheet

// up: docs/en/templates/life-practice-toolkit.md at f13ff2d, §1–§4 and §6
// (structure only; wording written fresh). the private design notes,
// phase 9. At f13ff2d up inserted §5, the care and shared responsibility
// card, so the weekly review moved from §5 to §6 with its fields unchanged
// (the private design notes, phase 0).
//
// up's life practice toolkit: four worksheets and five weekly questions for
// the moments when a choice, attention, a relationship or tiredness gets out
// of hand. Every one is private (plan principle 5): its answers never reach a
// model, it is refused as evidence, and Home counts it without a title. The
// warnings that open up's file are the private notice the page shows
// (ui/web/app/components/worksheet/private-note.tsx), not fields.
//
// up writes each worksheet as one code block. Where the block has its own
// sub-headings ("After the conversation:", "Support agreement:") or blank-line
// groups, the kind splits it into sections that continue the first, so the
// form saves a part at a time; the AC1 harness counts them as one.

// lifeSource is the one up file all five kinds follow.
const lifeSource = "docs/en/templates/life-practice-toolkit.md"

// up: life-practice-toolkit.md §1 "Decision Brief". The chapter it links,
// docs/en/threads/part-2/decision.md, carries the rules: separate facts from
// interpretation, price each option in money, health and relationships, and
// set gates that stop an experiment before it grows.
var choiceBrief = Kind{
	Kind: "choice_brief", Name: "Choice brief", Group: GroupLife, Version: 1,
	Source: lifeSource + " §1 Decision Brief",
	Summary: "For a choice that matters: what you know and what you only think, what each option costs, " +
		"the smallest test that could tell you more, when to stop it, and who decides.",
	Private: true,
	Attach:  AttachNone,
	Reviews: []Review{
		// up: "Review date:", the date the learner writes.
		{Key: "review", Label: "Review date", Days: 0, From: Anchor{Section: "roles", Field: "review_date"}},
	},
	Sections: []Section{
		{Key: "problem", Title: "The problem", Fields: []Field{
			{Key: "problem", Label: "Problem to solve", Type: Long},
			{Key: "deadline", Label: "Decide by", Type: Date},
		}},
		{Key: "facts", Title: "What you know", Continues: true,
			Hint: "Keep what you checked apart from what you make of it.",
			Fields: []Field{
				{Key: "facts", Label: "Known facts, and where each comes from", Type: Long},
				{Key: "interpretation", Label: "How I read them", Type: Long},
				{Key: "unknown", Label: "Still unknown", Type: Long},
				{Key: "problem_type", Label: "Kind of problem", Type: Choice,
					Options: []string{"missing information", "uncertain outcome", "values in conflict", "defending who I am"}},
				{Key: "values", Label: "Values and limits I will not trade", Type: Long},
			}},
		{Key: "options", Title: "The options", Continues: true, Fields: []Field{
			{Key: "option_a", Label: "Option A", Type: Long},
			{Key: "option_b", Label: "Option B", Type: Long},
			{Key: "do_nothing", Label: "Do nothing for now", Type: Long},
		}},
		{Key: "costs", Title: "What each option costs", Continues: true,
			Hint: "One line per question, covering every option above.",
			Fields: []Field{
				{Key: "benefits", Label: "What each option gains", Type: Long},
				{Key: "money", Label: "What each option costs in money", Type: Long},
				{Key: "health", Label: "What each option costs in health", Type: Long},
				{Key: "relationships", Label: "What each does to relationships and responsibilities", Type: Long},
				{Key: "reversible", Label: "What can be undone", Type: Long},
			}},
		{Key: "gates", Title: "The smallest test and its gates", Continues: true,
			Hint: "Decide now what makes you stop, while you are calm.",
			Fields: []Field{
				{Key: "experiment", Label: "Smallest experiment", Type: Long},
				{Key: "evidence_gate", Label: "Evidence gate and when to look", Type: Text},
				{Key: "cost_gate", Label: "Cost gate", Type: Text},
				{Key: "safety_gate", Label: "Safety gate", Type: Text},
				{Key: "responsibility_gate", Label: "Responsibility gate", Type: Text},
				{Key: "on_trigger", Label: "When a gate is crossed", Type: Choice,
					Options: []string{"pause", "stop", "roll back", "escalate for help"}},
				{Key: "overturn", Label: "What evidence would change this choice", Type: Long},
			}},
		{Key: "roles", Title: "Who proposes, decides, carries and reviews", Continues: true, Fields: []Field{
			{Key: "proposer", Label: "Who proposed it", Type: Text},
			{Key: "decider", Label: "Who decides, and on what authority", Type: Text},
			{Key: "affected", Label: "Who is affected, and what they will really carry", Type: Long},
			{Key: "consent", Label: "What needs someone's explicit consent", Type: Long},
			{Key: "implementer", Label: "Who carries it out, with what resources", Type: Text},
			{Key: "reviewer", Label: "Who reviews it, and may pause it", Type: Text},
			{Key: "advice", Label: "Whose advice counts here", Type: Text},
			{Key: "decision", Label: "The decision for now", Type: Long},
			{Key: "review_date", Label: "Review date", Type: Date,
				Hint: "The review below follows this date."},
			{Key: "evidence", Label: "Evidence to keep", Type: Text},
		}},
	},
}

// up: life-practice-toolkit.md §2 "Attention Audit", with its chapter
// docs/en/threads/part-3/3-attention-and-judgment.md. up writes the week as
// the heading's two dates; the kind keeps them as two date fields.
var attentionAudit = Kind{
	Kind: "attention_audit", Name: "Attention audit", Group: GroupLife, Version: 1,
	Source: lifeSource + " §2 Attention Audit",
	Summary: "One week of where your attention went, area by area, and one change for the next: " +
		"an entry to close, a block of time to protect, and what you can still do without AI.",
	Private: true,
	Attach:  AttachNone,
	Reviews: []Review{
		{Key: "next_week", Label: "Next week's audit", Days: 7},
	},
	Sections: []Section{
		{Key: "week", Title: "The week", Fields: []Field{
			{Key: "from", Label: "Week from", Type: Date},
			{Key: "to", Label: "Week to", Type: Date},
			{Key: "question", Label: "The question that mattered most this week", Type: Text},
			{Key: "areas", Label: "Where attention went", Type: Table, RowHeader: "Area",
				Rows: []Row{
					{Key: "input", Label: "Input: reading, video, meetings, chat"},
					{Key: "switching", Label: "Switching: notifications, interruptions, browsing"},
					{Key: "output", Label: "Output: work, decisions, retelling, delivery"},
					{Key: "relationships", Label: "Relationships: conversations where I was really there"},
					{Key: "body", Label: "Body: sleep, movement, energy"},
				},
				Columns: []Field{
					{Key: "facts", Label: "This week's facts", Type: Text},
					{Key: "result", Label: "Result", Type: Text},
					{Key: "change", Label: "Change for next week", Type: Text},
				}},
			{Key: "close_entry", Label: "One way in to close", Type: Text},
			{Key: "time_box", Label: "One 25–45 minute block to protect", Type: Text},
			{Key: "before_ai", Label: "What I know before I ask AI", Type: Long},
			{Key: "without_ai", Label: "What I can still do with AI closed", Type: Long},
			{Key: "experiment", Label: "One experiment for next week", Type: Text},
		}},
	},
}

// up: life-practice-toolkit.md §3 "Relationship Conversation Card", with its
// chapter docs/en/threads/part-2/relationships.md: power and exit costs,
// consent, then facts, impact, need and one request.
var relationshipCard = Kind{
	Kind: "relationship_card", Name: "Relationship conversation card", Group: GroupLife, Version: 1,
	Source: lifeSource + " §3 Relationship Conversation Card",
	Summary: "Before a hard conversation: who holds the power, what you observed, what you need and the one thing " +
		"you will ask for. After it: what was actually said and agreed, and when you will look at it again.",
	Private: true,
	Attach:  AttachNone,
	Reviews: []Review{
		// up: "When will we review it?", the date the learner writes.
		{Key: "next_review", Label: "Next review", Days: 0, From: Anchor{Section: "after", Field: "review_on"}},
	},
	Sections: []Section{
		{Key: "before", Title: "Before the conversation", Fields: []Field{
			{Key: "situation", Label: "The relationship and the situation", Type: Text},
			{Key: "power", Label: "Who has more money, say over the other, account access, information, or less to lose by leaving", Type: Long},
			{Key: "aim", Label: "What I want this conversation to do", Type: Text},
			{Key: "can_refuse", Label: "Can the other person safely say no, pause, or leave?", Type: Text},
			{Key: "consent", Label: "Do I have clear consent to record, upload, forward or publish anything?", Type: Text},
			{Key: "facts", Label: "What I saw or heard, specifically", Type: Long},
			{Key: "impact", Label: "Its effect on me, and how I feel", Type: Long},
			{Key: "need", Label: "What I really need", Type: Long},
			{Key: "request", Label: "One concrete request", Type: Text},
			{Key: "boundary", Label: "A boundary I can hold", Type: Text},
			{Key: "responsibilities", Label: "Which responsibilities are mine, and which are not?", Type: Long},
			{Key: "unsafe_contact", Label: "If it stops being safe, I will contact", Type: Text},
		}},
		{Key: "after", Title: "After the talk", Continues: true, Fields: []Field{
			{Key: "said", Label: "What did they actually say?", Type: Long},
			{Key: "listened", Label: "Did I really listen?", Type: Text},
			{Key: "agreed", Label: "What did we clearly agree, and what did we not?", Type: Long},
			{Key: "owners", Label: "Who does each action, and by when?", Type: Long},
			{Key: "repair", Label: "What repair can be seen, without asking for forgiveness or making up?", Type: Long},
			{Key: "unresolved", Label: "What is still open?", Type: Long},
			{Key: "review_on", Label: "When will we look at it again?", Type: Date,
				Hint: "The review follows this date."},
		}},
	},
}

// up: life-practice-toolkit.md §4 "Recovery Reset", with its chapter
// docs/en/threads/part-2/recovery.md: safety comes first, then today's mode
// (safety, reduced load, rebuilding), the basic-life floor, one capped task,
// what supporters may do, and the gates for going back to work. up's last
// gate is "review date and person authorised to pause"; the kind keeps it as
// a date and a name, so the review can follow the date.
var recoveryReset = Kind{
	Kind: "recovery_reset", Name: "Recovery reset", Group: GroupLife, Version: 1,
	Source: lifeSource + " §4 Recovery Reset",
	Summary: "For a stretch when you are worn out: keep yourself safe first, choose today's mode, protect the basics, " +
		"do one small capped task, and agree what has to be true before you go back to full work.",
	Private: true,
	Attach:  AttachNone,
	Reviews: []Review{
		{Key: "review", Label: "Review date", Days: 0, From: Anchor{Section: "return", Field: "review_date"}},
	},
	Sections: []Section{
		{Key: "safety", Title: "Safety first",
			Hint: "If you cannot tell whether you are safe today, choose safety mode and set the productivity questions below aside.",
			Fields: []Field{
				{Key: "safety_issue", Label: "What needs protecting today", Type: Text},
				{Key: "contacts", Label: "People I can contact", Type: Text},
				{Key: "pause_decision", Label: "A high-risk decision to put on hold", Type: Text},
				{Key: "mode", Label: "Today's mode", Type: Choice,
					Options: []string{"safety", "reduced load", "rebuilding"}},
				{Key: "if_worse", Label: "If things get less safe: what I will stop, who I will call, where I will go", Type: Long},
			}},
		{Key: "body", Title: "Body", Continues: true, Fields: []Field{
			{Key: "sleep", Label: "Sleep", Type: Text},
			{Key: "food", Label: "Food", Type: Text},
			{Key: "activity", Label: "Light movement I can manage", Type: Text},
			{Key: "professional", Label: "Professional support to ask", Type: Text},
		}},
		{Key: "today", Title: "Today", Continues: true, Fields: []Field{
			{Key: "floor", Label: "The basic-life floor", Type: Multi,
				Options: []string{"food", "getting ready to sleep", "necessary care", "urgent bills and messages"}},
			{Key: "task", Label: "One smallest task today", Type: Text},
			{Key: "done_evidence", Label: "How I will know it is done", Type: Text},
			{Key: "limit", Label: "Its cap, and when I stop", Type: Text},
			{Key: "next_day_cost", Label: "What to check tomorrow that it cost", Type: Text},
			{Key: "allowed_not", Label: "What I am allowed not to do today", Type: Long},
			{Key: "first_action", Label: "The first thing to do when I open this tomorrow", Type: Text},
		}},
		{Key: "support", Title: "Support agreement", Continues: true, Fields: []Field{
			{Key: "may_do", Label: "What a supporter may do", Type: Long},
			{Key: "must_not", Label: "What a supporter must not do for me", Type: Long},
			{Key: "escalate", Label: "Signs that mean escalating", Type: Long},
			{Key: "hand_back", Label: "How accounts, documents and decisions come back to me as the risk falls", Type: Long},
			{Key: "minimum_info", Label: "The least information the safety task needs", Type: Text},
		}},
		{Key: "return", Title: "Gates before going back to work", Continues: true, Fields: []Field{
			{Key: "safety_gate", Label: "Safety gate", Type: Text},
			{Key: "life_gate", Label: "Basic-life gate", Type: Text},
			{Key: "timebox_gate", Label: "Time-boxed task gate", Type: Text},
			{Key: "boundary_gate", Label: "Gate for saying where my limits are", Type: Text},
			{Key: "review_date", Label: "Review date", Type: Date,
				Hint: "The review follows this date."},
			{Key: "pause_person", Label: "Who may pause the return", Type: Text},
			{Key: "next_variable", Label: "One thing to raise next", Type: Text},
		}},
	},
}

// up: life-practice-toolkit.md §6 "Weekly Review" (§5 before f13ff2d): five
// questions, each week. Its fields did not change, so it stays version 1.
var lifeWeeklyReview = Kind{
	Kind: "life_weekly_review", Name: "Weekly five questions", Group: GroupLife, Version: 1,
	Source:  lifeSource + " §6 Weekly Review",
	Summary: "Five questions once a week, so one checked fact still stands when feelings get loud.",
	Private: true,
	Attach:  AttachNone,
	Reviews: []Review{
		{Key: "next_week", Label: "Next week's questions", Days: 7},
	},
	Sections: []Section{
		{Key: "questions", Title: "This week", Fields: []Field{
			{Key: "fact", Label: "Which fact changed how I judged something?", Type: Long},
			{Key: "result", Label: "Which action left a result I can look at?", Type: Long},
			{Key: "repeated", Label: "Which mistake came back, and what might be behind it?", Type: Long},
			{Key: "boundary", Label: "Which boundary needs clearer words or firmer follow-through?", Type: Long},
			{Key: "experiment", Label: "Which one small experiment will I keep next week?", Type: Long},
		}},
	},
}

func init() {
	register(choiceBrief)
	register(attentionAudit)
	register(relationshipCard)
	register(recoveryReset)
	register(lifeWeeklyReview)
}
