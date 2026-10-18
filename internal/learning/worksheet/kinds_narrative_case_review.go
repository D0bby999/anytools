package worksheet

// up: docs/en/threads/part-2/narrative-and-evidence.md §6, "One-page Case
// Review" (structure only; wording written fresh). Phase 8 of
// plans/260930-0915-up-methods.
//
// §6 tells the reader to copy the AI case review template
// (docs/en/templates/ai-case-review.md), add two gates, "Narrative boundary"
// and "Next test", and then ask a reader who does not know the background
// three things. So the kind is the case review's four sections, the two
// gates, and the reader's three answers. The gates are what its outline
// counts; the four template sections and the reader's answers are listed in
// testdata/deviations.txt with that reason.
//
// It is private (plan principle 5): it is about the learner's own life and
// other people in it, so it never reaches a model or an evidence surface.

// NarrativeCaseReviewKind is the narrative case review's id.
const NarrativeCaseReviewKind = "narrative_case_review"

var narrativeCaseReview = Kind{
	Kind: NarrativeCaseReviewKind, Name: "Narrative case review", Group: GroupLife, Version: 1,
	Source: "docs/en/threads/part-2/narrative-and-evidence.md §6, with docs/en/templates/ai-case-review.md",
	Summary: "Review a story from your own life or work the way you would review someone else's case: facts, " +
		"the judgement at the time, the result, the principle — then check what the story claims more than it shows.",
	Private:  true,
	Attach:   AttachNone,
	Sections: narrativeSections(),
}

func narrativeSections() []Section {
	sections := caseReviewSections()
	for i := range sections {
		// From the case review template, which §6 says to copy.
		sections[i].Added = true
	}
	return append(sections,
		Section{Key: "boundary", Title: "Narrative boundary",
			Fields: []Field{
				{Key: "whose", Label: "Is this what I saw, what someone else said, or how I read it?", Type: Text},
				{Key: "identifiable", Label: "Who could be recognised, and which details must go or be made general?", Type: Text},
				{Key: "hindsight", Label: "Have I pushed today's outcome back into the past?", Type: Text},
			}},
		Section{Key: "next_test", Title: "Next test",
			Fields: []Field{
				{Key: "conditions", Label: "Under which conditions does this principle hold?", Type: Text},
				{Key: "experiment", Label: "What is the smallest next experiment?", Type: Text},
				{Key: "stop_when", Label: "What evidence would make me drop it, weaken it or rewrite it?", Type: Text},
			}},
		// §6's closing paragraph: a reader without the background retells it.
		Section{Key: "reader", Title: "A reader's retelling", Added: true,
			Hint: "Give the review to someone who does not know the background, and write down their answers in their words. Where their retelling slips is where the story says more than it shows.",
			Fields: []Field{
				{Key: "happened", Label: "What happened, in their words", Type: Long},
				{Key: "unproven", Label: "The line that reads most like an unproven conclusion", Type: Text},
				{Key: "next", Label: "What they could actually do next", Type: Text},
			}},
	)
}

func init() { register(narrativeCaseReview) }
