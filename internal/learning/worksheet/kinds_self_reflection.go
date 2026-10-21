package worksheet

// up: docs/en/threads/part-6/, chapters 1–5 at f13ff2d (structure only;
// wording written fresh). the private design notes, phase 3.
//
// up's part 6 is about the learner's relationship with themselves. Its five
// chapters leave eleven short copyable cards, each a code block of a few
// lines in its own `##` section. The kind gathers all eleven into one
// worksheet, one section per card in up's order, so a learner keeps them in
// one private place and fills one card at a time: no section is required.
// The outline is read from the five files into one
// (testdata/gen -file a.md,b.md … -sections '…;…').
//
// The kind is private (plan principle 5): its answers never reach a model,
// it is refused as evidence, and Home counts it without a title. The safety
// line the page shows comes from the first chapter's closing paragraph
// (toolkit.json, life.safety.self_reflection).

// selfReflectionSource is the directory of the five chapters.
const selfReflectionSource = "docs/en/threads/part-6/"

var selfReflection = Kind{
	Kind: "self_reflection", Name: "Self-reflection cards", Group: GroupLife, Version: 1,
	Source: selfReflectionSource + " (1-understanding-yourself.md §4, §6; 2-knowing-yourself.md §3, §6; " +
		"3-being-kind-to-yourself.md §4, §7; 4-improving-yourself.md §1, §6, §9; 5-being-your-own-lifelong-friend.md §1, §4)",
	Summary: "Eleven short cards for getting along with yourself over the long run: watch how you actually work, " +
		"check whose goal you are chasing, treat a slip as something to repair, test one change at a time, " +
		"and keep promises small enough to hold. Fill whichever card fits today; the rest can wait.",
	Private: true,
	Attach:  AttachNone,
	Reviews: []Review{
		// The thirty-day experiment's retest, on the date the learner writes.
		// up's card ends in a day-30 decision without a date line; the kind
		// adds one so the decision has a day (deviations.txt).
		{Key: "retest", Label: "Retest and decide", Days: 0, From: Anchor{Section: "hypothesis", Field: "retest_on"}},
	},
	Sections: []Section{
		// up: 1-understanding-yourself.md §4 "Treat Avoidance as Information,
		// Not Identity".
		{Key: "avoidance", Title: "When I put something off",
			Hint: "From “Understanding yourself”: read one delay as a trade you made, not as proof of what kind of person you are.",
			Fields: []Field{
				{Key: "intended", Label: "What I meant to do", Type: Text},
				{Key: "did", Label: "What I did instead", Type: Text},
				{Key: "relief", Label: "The relief I got straight away", Type: Text},
				{Key: "postponed_cost", Label: "The cost I pushed to later", Type: Text},
				{Key: "smaller", Label: "If the task shrank to a fifth of its size, the first piece I would still do", Type: Text},
			}},
		// up: 1-understanding-yourself.md §6 "Seven-Day Self-Observation
		// Practice".
		{Key: "observation", Title: "One moment, observed",
			Hint: "From “Understanding yourself”: write down one recurring moment as facts, so a pattern can show over a week of them.",
			Fields: []Field{
				{Key: "when_where", Label: "When and where", Type: Text},
				{Key: "facts", Label: "What could be seen or heard", Type: Long},
				{Key: "action", Label: "What I did", Type: Text},
				{Key: "relief", Label: "The relief right then", Type: Text},
				{Key: "later_cost", Label: "The cost that came later", Type: Text},
				{Key: "protecting", Label: "What I might have been guarding", Type: Text},
				{Key: "change", Label: "The one condition I will change next time", Type: Text},
			}},
		// up: 2-knowing-yourself.md §3 "Recognize Borrowed Desire".
		{Key: "borrowed", Title: "Whose goal is this?",
			Hint: "From “Knowing yourself”: check whether a goal is yours or one you picked up from someone else's expectations.",
			Fields: []Field{
				{Key: "goal", Label: "The goal I am chasing", Type: Text},
				{Key: "unseen", Label: "Would I still do it if nobody ever found out? Why?", Type: Long},
				{Key: "who_benefits", Label: "Whose life would actually get better if it worked?", Type: Text},
				{Key: "fair_cost", Label: "What reasonable cost am I prepared to carry?", Type: Text},
				{Key: "half", Label: "If I kept only half of it, what would be left?", Type: Text},
			}},
		// up: 2-knowing-yourself.md §6 "Bring Self-Knowledge into Decisions".
		{Key: "decision", Title: "A choice that fits this season",
			Hint: "From “Knowing yourself”: tie one choice to what you value right now, and decide in advance how you will know it was wrong.",
			Fields: []Field{
				{Key: "problem", Label: "The problem I am really trying to solve", Type: Text},
				{Key: "value", Label: "The value this choice serves for now", Type: Text},
				{Key: "cost_boundary", Label: "The cost I accept, and the line I will not cross", Type: Long},
				{Key: "evidence", Label: "What I will look at in two weeks", Type: Text},
				{Key: "adjust", Label: "If that evidence goes against it, how I change course or step back", Type: Long},
			}},
		// up: 3-being-kind-to-yourself.md §4 "Turn Inner Criticism into a
		// Work Note".
		{Key: "work_note", Title: "A harsh thought, rewritten as a work note",
			Hint: "From “Being kind to yourself”: replace a judgement about yourself with something you can act on.",
			Fields: []Field{
				{Key: "fact", Label: "Fact: what did I do, and where?", Type: Text},
				{Key: "impact", Label: "Impact: what did it actually change, and for whom?", Type: Text},
				{Key: "responsibility", Label: "Responsibility: which part can I put right now?", Type: Text},
				{Key: "support", Label: "Support: what condition, reminder or help would make next time go better?", Type: Text},
			}},
		// up: 3-being-kind-to-yourself.md §7 "A 24-Hour Return Agreement
		// After Interruption".
		{Key: "return", Title: "Coming back within a day",
			Hint: "From “Being kind to yourself”: after a break in the routine, agree one small way back for the next twenty-four hours instead of trying to catch up on everything.",
			Fields: []Field{
				{Key: "happened", Label: "What happened, without blame", Type: Long},
				{Key: "responsibility", Label: "The responsibility that matters most now", Type: Text},
				{Key: "smallest_action", Label: "The smallest thing I can finish within a day", Type: Text},
				{Key: "not_make_up", Label: "What I am deliberately not making up for", Type: Text},
				{Key: "notify", Label: "Who should hear from me, or be asked for help", Type: Text},
				{Key: "check_in", Label: "When I will check in next", Type: Text},
			}},
		// up: 4-improving-yourself.md §1 "Ask What the Improvement Is For".
		{Key: "purpose", Title: "What the improvement is for",
			Hint: "From “Improving yourself”: before trying to get better at something, name where you will use it and how much you will spend on it.",
			Fields: []Field{
				{Key: "situation", Label: "The real situation where I will use it", Type: Text},
				{Key: "stuck", Label: "Exactly where I get stuck in that situation", Type: Text},
				{Key: "observable", Label: "What someone will be able to see once it works", Type: Text},
				{Key: "limit", Label: "The most time, money and attention I will put into it", Type: Text},
			}},
		// up: 4-improving-yourself.md §6 "AI Can Speed Iteration, Not Choose
		// Your Direction".
		{Key: "ai_check", Title: "Before asking AI to check my work",
			Hint: "From “Improving yourself”: write your own view first, so a tool checks it rather than replacing it.",
			Fields: []Field{
				{Key: "own_draft", Label: "My own judgement or first draft", Type: Long},
				{Key: "issue", Label: "The one thing I want checked", Type: Text},
				{Key: "accept_when", Label: "What evidence decides whether I take the suggestion", Type: Text},
			}},
		// up: 4-improving-yourself.md §9 "A Thirty-Day Improvement
		// Experiment".
		{Key: "hypothesis", Title: "A thirty-day experiment",
			Hint: "From “Improving yourself”: test one change for thirty days against a starting sample, then decide what happens to it.",
			Fields: []Field{
				{Key: "hypothesis", Label: "My hypothesis", Type: Long,
					Hint: "One sentence: if I repeat this action, under these conditions, this result will get better."},
				{Key: "baseline", Label: "Starting sample", Type: Text},
				{Key: "per_week", Label: "How many times a week", Type: Text},
				{Key: "feedback", Label: "Feedback I will keep", Type: Text},
				{Key: "stop_signals", Label: "Signs it is not worth continuing", Type: Long},
				{Key: "retest_on", Label: "Retest date", Type: Date,
					Hint: "The day you take the sample again and decide. It becomes this worksheet's review."},
				{Key: "decision", Label: "Decision on day thirty", Type: Choice,
					Options: []string{"continue", "transfer", "repair", "stop"}},
			}},
		// up: 5-being-your-own-lifelong-friend.md §1 "A Friend Remembers Your
		// History First".
		{Key: "history", Title: "What I already know about myself",
			Hint: "From “Being your own lifelong friend”: keep the record a good friend would remember for you, including what you have already come through.",
			Fields: []Field{
				{Key: "start_easily", Label: "When I start most easily", Type: Text},
				{Key: "avoid_easily", Label: "When I most easily avoid", Type: Text},
				{Key: "recovered", Label: "A break I once came back from", Type: Text},
				{Key: "paid_costs", Label: "Costs I have already paid and do not want to pay again", Type: Long},
				{Key: "fine_question", Label: "When I say I am fine, what a person I trust may ask me", Type: Text},
			}},
		// up: 5-being-your-own-lifelong-friend.md §4 "Make Commitments Small
		// and Credible".
		{Key: "commitment", Title: "A promise small enough to keep",
			Hint: "From “Being your own lifelong friend”: make one commitment you can still keep on a bad week, and say what happens when you miss it.",
			Fields: []Field{
				{Key: "protect", Label: "What I am protecting", Type: Text},
				{Key: "smallest", Label: "The smallest action", Type: Text},
				{Key: "lower_when", Label: "What condition lowers the level by itself", Type: Text},
				{Key: "evidence", Label: "The trace I will leave", Type: Text},
				{Key: "talk_after", Label: "Who I will talk to if I miss it twice", Type: Text},
			}},
	},
}

func init() { register(selfReflection) }
