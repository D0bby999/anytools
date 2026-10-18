package worksheet

// up: docs/en/templates/life-practice-toolkit.md at f13ff2d, §5 "Care and
// Shared Responsibility Card" (structure only; wording written fresh), with
// its chapter docs/en/threads/part-2/care-and-carry-on.md.
// plans/261017-1828-up-f13ff2d-upgrade, phase 1.
//
// One practical task shared with someone the learner cares for: what that
// person says they need, what each side can really carry, the next step both
// agreed to, and a review that asks whether it is still voluntary. Like the
// rest of the life toolkit (kinds_life.go) it is private: its answers never
// reach a model, it is refused as evidence, and Home counts it without a
// title. The paragraph that opens up's §5 becomes the first section's hint
// and the kind's line in the private notice (toolkit.json life.safety).
//
// up's block has four groups: the person or task, what each carries, the
// next step decided together, and the review. The kind keeps each as a
// section that continues the first, so the AC1 harness counts one, and
// keeps up's 19 lines as 19 fields in up's order. up's two "action … and its
// completion date" lines stay one field each, as up writes them.
var careCard = Kind{
	Kind: "life_care_card", Name: "Care and shared responsibility card", Group: GroupLife, Version: 1,
	Source: lifeSource + " §5 Care and Shared Responsibility Card",
	Summary: "For one practical task you share with someone you care for: what they say they need, what each of you " +
		"can really carry, the next step you agree on together, and a date to check it is still freely given. " +
		"Read it with up's chapter \"Care: Finding Strength in the People We Love\": " +
		"https://github.com/byoungd/up/blob/f13ff2d/docs/en/threads/part-2/care-and-carry-on.md",
	Private: true,
	Attach:  AttachNone,
	Reviews: []Review{
		// up: "Next review date:", the date the learner writes.
		{Key: "review", Label: "Next review date", Days: 0, From: Anchor{Section: "review", Field: "review_date"}},
	},
	Sections: []Section{
		{Key: "person", Title: "The person or the task",
			Hint: "Pick one concrete thing you can talk through, such as a lift, the shopping, company, rest or a bill, " +
				"and ask what is needed before anyone decides who does what. This card does not measure anyone's love, " +
				"follow where anyone goes, or ask anyone to report back: write down only what you both agree to keep.",
			Fields: []Field{
				{Key: "subject", Label: "Person I care for, or practical task to share", Type: Text},
				{Key: "their_need", Label: "What the other person says they need", Type: Long,
					Hint: `Write "unknown" if you have not asked yet.`},
				{Key: "care", Label: "One way I want to show care or thanks", Type: Text},
			}},
		{Key: "carry", Title: "What each of us carries", Continues: true,
			Hint: "Support does not have to come from family or a partner: friends, a community or a professional service " +
				"can help instead. A child may take a small task that suits their age and may say no to it, but never the job " +
				"of calming adults, settling their arguments or rescuing anyone.",
			Fields: []Field{
				{Key: "i_carry", Label: "Specific tasks I can carry myself", Type: Long},
				{Key: "need_support", Label: "Specific tasks I need support with", Type: Long},
				{Key: "reduce", Label: "Tasks that can be cut down, put off or stopped", Type: Long},
				{Key: "my_capacity", Label: "Time, energy or resources I am willing and able to give now", Type: Long},
				{Key: "their_capacity", Label: "Time, energy or resources the other person is willing and able to give", Type: Long,
					Hint: `Write "unknown" until they have confirmed it.`},
				{Key: "join", Label: "Does the other person want to join this conversation and this record?", Type: Text},
				{Key: "refuse", Label: "How can either of us say no, pause or change this without blame, payback or having to prove love?", Type: Long},
				{Key: "others", Label: "Other people or services I can turn to if this person cannot help", Type: Long},
				{Key: "adult_duties", Label: "Adult responsibilities that stay with adults and the right supporters", Type: Long},
			}},
		{Key: "next", Title: "Next step decided together", Continues: true,
			Hint: "Write the other person's part only once they have agreed to it. Until then it stays unassigned.",
			Fields: []Field{
				{Key: "my_action", Label: "The action I choose to own, and the date it will be done", Type: Text},
				{Key: "their_action", Label: "The action the other person clearly agreed to own, and its date", Type: Text},
				{Key: "unassigned", Label: "What stays unassigned or needs help from outside", Type: Long},
				{Key: "records", Label: "What information we agree to keep, where it is kept, and when it is deleted", Type: Long},
			}},
		{Key: "review", Title: "Review", Continues: true,
			Hint: "If the load is already too heavy, do not wait for this date: bring in outside help now.",
			Fields: []Field{
				{Key: "review_date", Label: "Next review date", Type: Date,
					Hint: "The review follows this date."},
				{Key: "signals", Label: "Signs that mean easing the load or getting help before then", Type: Long},
				{Key: "at_review", Label: "At the review: is it still voluntary, is the load too heavy, and what has to change?", Type: Long},
			}},
	},
}

func init() { register(careCard) }
