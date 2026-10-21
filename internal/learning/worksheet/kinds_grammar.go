package worksheet

import "strings"

// Phase 6 of the private design notes: grammar as meaning decisions.
//
// Two kinds share the chapter's two lists, defined once below and served
// with the kinds as their options:
//   - grammar_evidence follows up's card, docs/en/templates/grammar-evidence.md
//     §1–§8 (structure only; wording written fresh). §2's "Structural choice"
//     column is a choice of the six meaning decisions.
//   - grammar_error_map has no template in up. It is the chapter's §2 table
//     of six meaning decisions and §4 impact table, docs/en/threads/part-1/
//     grammar.md, turned into a worksheet (the owner's "bản đồ lỗi xếp theo
//     loại ý nghĩa"). Its composition is listed in testdata/deviations.txt.

// The kind ids the web page knows.
const (
	GrammarEvidenceKind = "grammar_evidence"
	GrammarErrorMapKind = "grammar_error_map"
)

// grammarDecision is one of the chapter §2's six meaning decisions: its
// option text, and the reference row the error map shows for it.
type grammarDecision struct {
	key, option, structures, question string
}

// up: grammar.md §2, "Begin with Six Meaning Decisions", in up's order.
var grammarDecisions = []grammarDecision{
	{"who", "who acts and who is responsible",
		"Subject and object, active or passive, pronouns",
		"Who did it, who was affected, and has the person responsible dropped out of the sentence?"},
	{"time", "time and state",
		"Tense, progressive and perfect forms, time words",
		"When did it happen, is it still going on, and does its result still hold?"},
	{"object", "which object",
		"Articles, number, countable or not, determiners",
		"Is it something new, something already known, a whole class, or an amount?"},
	{"negation", "negation and question",
		"Auxiliaries, question words, how far a \"not\" reaches",
		"Is the action, the degree or the condition denied? What answer is the question after?"},
	{"logic", "relation and logic",
		"Linking words, clauses, condition, cause, concession",
		"Is this a cause, a condition, background, a contrast or a result?"},
	{"certainty", "certainty and attitude",
		"Modal verbs, adverbs, softening",
		"Is it a fact, a possibility, advice, an obligation, a supposition or a polite request?"},
}

// grammarImpact is one row of the chapter §4's impact table: its option
// text, what it looks like, and the priority the chapter gives it.
type grammarImpact struct {
	key, option, looksLike, priority string
}

// up: grammar.md §4, "Build an Error Map", in up's order, which is also the
// order of priority (highest, highest, high, medium, later).
var grammarImpacts = []grammarImpact{
	{"meaning", "meaning-changing", "Time, negation, a condition or who is responsible is read wrongly", "Highest"},
	{"task", "task-blocking", "The request, the conclusion or the next step is not clear", "Highest"},
	{"recurring", "recurring", "The same structure goes wrong in more than one sample", "High"},
	{"register", "register mismatch", "Grammatical, but too strong, too weak or wrong for the email, interview or relationship", "Medium"},
	{"low", "low-impact", "The reader still understands, and this task does not hinge on it", "Later"},
}

// GrammarDecisions and GrammarImpacts are the two option lists both kinds use.
var (
	GrammarDecisions = func() []string {
		out := make([]string, len(grammarDecisions))
		for i, d := range grammarDecisions {
			out[i] = d.option
		}
		return out
	}()
	GrammarImpacts = func() []string {
		out := make([]string, len(grammarImpacts))
		for i, d := range grammarImpacts {
			out[i] = d.option
		}
		return out
	}()
)

// capitalise turns an option into a row label.
func capitalise(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func decisionRows() (rows []Row, structures, questions map[string]string) {
	structures, questions = map[string]string{}, map[string]string{}
	for _, d := range grammarDecisions {
		rows = append(rows, Row{Key: d.key, Label: capitalise(d.option)})
		structures[d.key], questions[d.key] = d.structures, d.question
	}
	return rows, structures, questions
}

func impactRows() (rows []Row, looksLike, priority, byOption map[string]string) {
	looksLike, priority, byOption = map[string]string{}, map[string]string{}, map[string]string{}
	for _, d := range grammarImpacts {
		rows = append(rows, Row{Key: d.key, Label: capitalise(d.option)})
		looksLike[d.key], priority[d.key], byOption[d.option] = d.looksLike, d.priority, d.priority
	}
	return rows, looksLike, priority, byOption
}

// The section and field the error map's own rows live in.
const (
	GrammarMapSection = "map"
	GrammarMapErrors  = "errors"
)

// up: docs/en/templates/grammar-evidence.md, §1–§8.
var grammarEvidence = Kind{
	Kind: GrammarEvidenceKind, Name: "Grammar evidence", Group: GroupLanguage, Version: 1,
	Source: "docs/en/templates/grammar-evidence.md",
	Summary: "One structure that gets in the way of a real task: the sentence you actually wrote or said, " +
		"a contrast card, revisions with reasons, practice across the four skills, and retests days later.",
	Attach: AttachState,
	// §7's later rows, counted from the day §2's first sample is written.
	Reviews: []Review{
		{Key: "days_3_7", Label: "Parallel topic (days 3–7)", Days: 5, From: Anchor{Section: "problem", Field: "original"}},
		{Key: "day_14", Label: "Transfer task (day 14)", Days: 14, From: Anchor{Section: "problem", Field: "original"}},
	},
	RowReviews: []RowReview{
		{Section: "retest", Field: "timeline", Row: "days_3_7", Review: "days_3_7"},
		{Section: "retest", Field: "timeline", Row: "day_14", Review: "day_14"},
	},
	Sections: []Section{
		// §1
		{Key: "task", Title: "The real task",
			Hint: "One structure per card, taken from something you really had to say or write. " +
				"Keep customers, colleagues, patients and other people out of it: invent the facts or cut the excerpt down.",
			Fields: []Field{
				{Key: "date", Label: "Date", Type: Date},
				{Key: "situation", Label: "Situation", Type: Choice, Other: true,
					Options: []string{"email", "explanation", "dialogue", "retelling", "interview"}},
				{Key: "audience", Label: "Audience", Type: Text},
				{Key: "outcome", Label: "What the other person must understand or do", Type: Text},
				{Key: "limits", Label: "Time, tool and length limits", Type: Text},
				{Key: "sample_location", Label: "Where the raw sample is kept", Type: Text},
			}},
		// §2
		{Key: "problem", Title: "One structural problem",
			Hint: "Start from the sentence as it came out, then set it beside two versions that say something else.",
			Fields: []Field{
				{Key: "original", Label: "My original sentence or passage", Type: Long},
				{Key: "reading", Label: "How it is most likely to be read", Type: Text},
				{Key: "intended", Label: "What I meant", Type: Text},
				{Key: "impact", Label: "Impact", Type: Choice, Options: GrammarImpacts},
				{Key: "structure", Label: "The one structure I track this cycle", Type: Text},
				{Key: "samples", Label: "Samples", Type: Table, RowHeader: "Sample",
					Rows: []Row{
						{Key: "original", Label: "Original"},
						{Key: "contrast_a", Label: "Contrast A"},
						{Key: "contrast_b", Label: "Contrast B"},
					},
					Columns: []Field{
						{Key: "choice", Label: "Structural choice", Type: Choice, Options: GrammarDecisions},
						{Key: "relationship", Label: "Relationship it actually expresses", Type: Text},
						{Key: "fits", Label: "Fits the task?", Type: YesNo},
					}},
			}},
		// §3
		{Key: "contrast", Title: "Meaning contrast card",
			Hint: "Say why this form matches what happened. A definition copied from a grammar book does not count.",
			Fields: []Field{
				{Key: "meaning", Label: "Meaning I need to express", Type: Text},
				{Key: "forms", Label: "Forms I mix up", Type: Text},
				{Key: "example", Label: "An example from reliable material, with its source", Type: Text},
				{Key: "explanation", Label: "One sentence, in my own words, on why the form fits", Type: Text},
				{Key: "boundary", Label: "A counterexample or a limit", Type: Text},
			}},
		// §4
		{Key: "revision", Title: "Revisions and reasons",
			Fields: []Field{
				{Key: "versions", Label: "Versions", Type: Table, RowHeader: "Version",
					Rows: []Row{
						{Key: "first", Label: "First"},
						{Key: "revised", Label: "Revised"},
						{Key: "repeat", Label: "Independent repeat"},
					},
					Columns: []Field{
						{Key: "condition", Label: "Condition", Type: Label, Text: map[string]string{
							"first":   "No prompt",
							"revised": "After an explanation or feedback",
							"repeat":  "With the material closed",
						}},
						{Key: "location", Label: "Where the sentence or output is", Type: Text},
						{Key: "changed", Label: "What changed", Type: Text},
						{Key: "why", Label: "Why", Type: Text},
					}},
				{Key: "understood", Label: "How the other person understood the revision", Type: Text},
				{Key: "still", Label: "A problem that still gets in the way of the task", Type: Text},
				{Key: "rejected", Label: "A style change I was offered and turned down", Type: Text},
			}},
		// §5
		{Key: "skills", Title: "Retrieval across four skills",
			Hint: "Not every skill every cycle. Keep at least one thing you noticed while listening or reading, and one thing you produced.",
			Fields: []Field{
				{Key: "skills", Label: "Skills", Type: Table, RowHeader: "Skill",
					Rows: []Row{
						{Key: "listening", Label: "Listening"},
						{Key: "reading", Label: "Reading"},
						{Key: "speaking", Label: "Speaking"},
						{Key: "writing", Label: "Writing"},
					},
					Columns: []Field{
						{Key: "task", Label: "Small task", Type: Label, Text: map[string]string{
							"listening": "Catch the relationship the structure carries",
							"reading":   "Mark what a phrase covers, what a word refers back to, or how two ideas connect",
							"speaking":  "Use it against the clock, and repair it after a slip",
							"writing":   "Compare how two versions change what the reader takes away",
						}},
						{Key: "result", Label: "Result", Type: Text},
						{Key: "evidence", Label: "Evidence", Type: Text},
					}},
			}},
		// §6
		{Key: "ai", Title: "AI and feedback record",
			Fields: []Field{
				{Key: "tool", Label: "Tool or reviewer, and date", Type: Text},
				{Key: "problem", Label: "Problem observed", Type: Text},
				{Key: "explanation", Label: "Explanation given", Type: Text},
				{Key: "separated", Label: "Did it keep error, ambiguity, register and style apart?", Type: Text},
				{Key: "checked", Label: "Checked against a dictionary, corpus, teacher or reader", Type: Text},
				{Key: "accepted", Label: "What I accepted or rejected, and why", Type: Long},
			}},
		// §7
		{Key: "retest", Title: "Delayed retest",
			Hint: "Each later row opens on its date. Choose the form yourself, without the card or the old answer in front of you.",
			Fields: []Field{
				{Key: "timeline", Label: "Retests", Type: Table, RowHeader: "Time",
					Rows: []Row{
						{Key: "day_1", Label: "Day 1"},
						{Key: "days_3_7", Label: "Days 3–7"},
						{Key: "day_14", Label: "Day 14"},
					},
					Columns: []Field{
						{Key: "condition", Label: "Prompt condition", Type: Label, Text: map[string]string{
							"day_1":    "The original task, no prompt",
							"days_3_7": "Rule and old answer put away",
							"day_14":   "A new audience, or a time limit",
						}},
						{Key: "task", Label: "New task", Type: Text,
							Hint: "Day 1 repeats the original task; days 3–7 take a parallel topic; day 14 is a transfer task."},
						{Key: "choice", Label: "Form I chose on my own", Type: Text},
						{Key: "result", Label: "Result", Type: Text},
					}},
				{Key: "retained", Label: "Judgement I still had on day seven", Type: Text},
				{Key: "returned", Label: "An error that came back", Type: Text},
				{Key: "transfer", Label: "Where transfer broke down", Type: Text},
			}},
		// §8
		{Key: "score", Title: "Score and decide",
			Fields: []Field{
				{Key: "scores", Label: "Scores", Type: Table, RowHeader: "Item",
					Rows: []Row{
						{Key: "explain", Label: "Explain how form and meaning differ"},
						{Key: "recognise", Label: "Recognise it in a new sentence"},
						{Key: "retrieve", Label: "Retrieve it when producing"},
						{Key: "repair", Label: "Repair it myself after a slip"},
						{Key: "stable", Label: "Stop changing the key meaning from one try to the next"},
					},
					Columns: []Field{
						{Key: "day_1", Label: "Day 1", Type: Score, ScoreLabels: grammarScoreLabels},
						{Key: "day_7", Label: "Day 7", Type: Score, ScoreLabels: grammarScoreLabels},
						{Key: "day_14", Label: "Day 14", Type: Score, ScoreLabels: grammarScoreLabels},
						{Key: "reason", Label: "Evidence for the score", Type: Text},
					}},
				{Key: "decision", Label: "What the evidence supports now", Type: Choice,
					Options: []string{"continue the same structure", "add variation", "move to another problem", "pause"}},
				{Key: "evidence", Label: "Evidence", Type: Text},
				{Key: "open_conclusion", Label: "A conclusion I cannot draw yet", Type: Text},
				{Key: "smallest_next", Label: "The smallest next task", Type: Text},
				{Key: "next_review", Label: "Next review date", Type: Date},
			}},
	},
}

// grammarScoreLabels are up's 0–2 anchors for §8, reworded.
var grammarScoreLabels = []string{"not done", "needs a prompt, or unsteady", "done under the current condition"}

// up: docs/en/threads/part-1/grammar.md §2 (six meaning decisions) and §4
// (error map by impact). up has no template; see testdata/deviations.txt.
var grammarErrorMap = func() Kind {
	dRows, structures, questions := decisionRows()
	iRows, looksLike, priority, byOption := impactRows()
	return Kind{
		Kind: GrammarErrorMapKind, Name: "Grammar error map", Group: GroupLanguage, Version: 1,
		Source: "docs/en/threads/part-1/grammar.md §2, §4",
		Summary: "Sort your grammar slips by what they did to the reader, not by chapter of a grammar book, " +
			"and practise the ones that change meaning or block the task first.",
		Attach: AttachStateOrDocument,
		Sections: []Section{
			// Chapter §2
			{Key: "decisions", Title: "Six meaning decisions",
				Hint: "Most slips come down to one of these six choices. A single task usually shows one or two of them.",
				Fields: []Field{
					{Key: "decisions", Label: "Meaning decisions", Type: Table, RowHeader: "Meaning decision",
						Rows: dRows,
						Columns: []Field{
							{Key: "structures", Label: "Structures that carry it", Type: Label, Text: structures},
							{Key: "question", Label: "What to ask of the task", Type: Label, Text: questions},
						}},
				}},
			// Chapter §4
			{Key: GrammarMapSection, Title: "Error map",
				Hint: "Name what a slip did to the reader before you name a rule. Take \"If I know earlier, I tell you.\" " +
					"Write out the realities it could stand for, then pick the form:\n" +
					"If I hear by Friday, I will tell you. (it may still happen)\n" +
					"If I knew now, I would tell you. (imagined; not true now)\n" +
					"If I had known earlier, I would have told you. (it did not happen)\n" +
					"Settle which reality you meant before you choose.",
				Fields: []Field{
					{Key: "impacts", Label: "Impact types", Type: Table, RowHeader: "Impact",
						Rows: iRows,
						Columns: []Field{
							{Key: "looks_like", Label: "What it looks like", Type: Label, Text: looksLike},
							{Key: "priority", Label: "Priority", Type: Label, Text: priority},
						}},
					{Key: GrammarMapErrors, Label: "My errors", Type: Table, MaxRows: 40,
						Columns: []Field{
							{Key: "sample", Label: "Sample", Type: Text},
							{Key: "decision", Label: "Meaning decision", Type: Choice, Options: GrammarDecisions},
							{Key: "impact", Label: "Impact", Type: Choice, Options: GrammarImpacts},
							// Derived from the impact, never stored; the page
							// sorts the rows by it.
							{Key: "priority", Label: "Priority", Type: Label, TextFrom: "impact", Text: byOption},
							{Key: "meant", Label: "What I meant", Type: Text},
							{Key: "contrast", Label: "The contrast I will practise", Type: Text},
						}},
				}},
		},
	}
}()

func init() {
	register(grammarEvidence)
	register(grammarErrorMap)
}
