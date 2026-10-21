package worksheet

import (
	"fmt"
	"regexp"
	"strconv"
)

// Phase 2 of the private design notes: up's AI evaluation record
// (structure only; wording written fresh).
//
//   - docs/en/templates/ai-evaluation.md, "Copyable record": scope, test
//     setup, case records, results, decision and follow-up, read with the
//     generator's -fenced mode (-sections 3-7);
//   - docs/en/threads/practice/ai-evaluation.md: "Define acceptable
//     performance", "Build a small, varied test set" and "Change one main
//     factor per comparison", summarised in the hints.
//
// up copies its case lines once per attempt and its case section once per
// version. Here each attempt is one row of a free table carrying up's case
// lines, with the version it ran on, so the page and the server can count
// each version's rates from the rows. The blank record compares two
// versions, the current one and a candidate, which are the version column's
// options and the rows of the results' rate table.
//
// The results rule (up's §4 heading): failures and timeouts stay in the
// denominator. A stored rate must match the case rows when the results are
// written (checkEvaluationRates); a case added later does not lock them, and
// the page shows a rate that has gone out of date (evaluation-extras.tsx).

// The AI evaluation's ids the page relies on.
const (
	AIEvaluationKind = "ai_evaluation"

	EvaluationCases      = "cases"
	EvaluationCasesTable = "cases"
	EvaluationVersion    = "version"
	EvaluationFirstPass  = "first_pass"
	EvaluationFinal      = "final"

	EvaluationResults = "results"
	EvaluationRates   = "rates"
	EvaluationRevised = "revised"
)

// The two versions a record compares, and an attempt's outcomes. A timeout
// is an attempt that did not pass.
const (
	VersionCurrent   = "current"
	VersionCandidate = "candidate"

	AttemptPass    = "pass"
	AttemptFail    = "fail"
	AttemptTimeout = "timeout"

	FinalAccepted = "accepted"
	FinalFailed   = "failed"
	FinalTimeout  = "timed out"
)

var aiEvaluation = Kind{
	Kind: AIEvaluationKind, Name: "AI evaluation", Group: GroupProjects, Version: 1,
	Source: "docs/en/templates/ai-evaluation.md",
	Summary: "Compare a current AI workflow with one candidate on fixed cases: the criteria are set before " +
		"anything runs, every attempt is a row, failures and timeouts stay in the count, and the decision " +
		"to adopt, keep, repair or stop rests on named cases and the whole cost.",
	Attach:       AttachState,
	CheckWritten: checkEvaluationRates,
	Sections: []Section{
		// §1
		{Key: "scope", Title: "Scope",
			Hint: "Start from what the user has to do next with the output, not from whether an answer looks good.",
			Fields: []Field{
				{Key: "user", Label: "Who uses it, and the action they mean to take", Type: Text},
				{Key: "inputs", Label: "Input materials, permission to use them, and what is de-identified", Type: Text},
				{Key: "baseline", Label: "The manual baseline and its total time", Type: Text},
				{Key: "unsupported", Label: "Tasks it is not meant to handle", Type: Text},
			}},
		// §2
		{Key: "setup", Title: "Test setup",
			Hint: "Fix all of this before the first run. Loosening the criteria after a candidate fails turns the " +
				"test into a defence of the option you already liked. Give both versions the same inputs, " +
				"sources, permissions and budget, and change one main thing. A first set might mix ordinary " +
				"inputs with missing, conflicting or outdated information, a tool failure and a source that " +
				"carries instructions. Keep some cases out of tuning; once they have shaped a change, they " +
				"become development or regression cases and fresh ones take their place.",
			Fields: []Field{
				{Key: "versions", Label: "Current version and candidate", Type: Text},
				{Key: "stack", Label: "Model, prompt, retrieved materials and tool versions", Type: Text},
				{Key: "run", Label: "Run date, region, memory settings, and services whose version cannot be pinned", Type: Text},
				{Key: "change", Label: "The one main change", Type: Text},
				{Key: "sets", Label: "Development cases, and held-out cases kept out of tuning", Type: Text},
				{Key: "limits", Label: "Attempts per case, and the time, call and spending limits", Type: Text},
				{Key: "must_pass", Label: "Conditions that must all pass", Type: Long,
					Hint: "Real sources, correct figures that matter, nothing restricted disclosed, no unauthorised action. Good writing does not make up for a failure here."},
				{Key: "quality", Label: "Quality comparisons and the human scoring rubric", Type: Long},
				{Key: "reviewers", Label: "Who reviews, and how a disagreement is settled", Type: Text},
				{Key: "failures", Label: "Failures that matter for this task", Type: Multi, Options: []string{
					"absent sources", "prompt injection", "unauthorised actions",
					"unbounded retries or duplicate side effects", "transcription or image errors",
				}},
			}},
		// §3
		{Key: EvaluationCases, Title: "Case records",
			Hint: "One row per attempt, on fixed case materials. A repeated attempt is not another user, and the " +
				"best attempt does not stand for its version. Check the file, the database or what the user sees: " +
				"the model saying it finished is not the outcome.",
			Fields: []Field{
				{Key: EvaluationCasesTable, Label: "Attempts", Type: Table, MaxRows: 40,
					Columns: []Field{
						{Key: EvaluationVersion, Label: "Version", Type: Choice, Options: []string{VersionCurrent, VersionCandidate}},
						{Key: "case", Label: "Case ID / trial", Type: Text},
						{Key: "input", Label: "Case type and fixed input location", Type: Text},
						{Key: "expected", Label: "Expected behaviour, and why", Type: Text},
						{Key: "support", Label: "Supporting passage, timestamp or image region", Type: Text},
						{Key: "actual", Label: "Actual behaviour or artifact location", Type: Text},
						{Key: "trace", Label: "Transcript, tool calls and authorisation record", Type: Text},
						{Key: "outcome", Label: "Final state of the environment", Type: Text},
						{Key: EvaluationFirstPass, Label: "First pass", Type: Choice,
							Options: []string{AttemptPass, AttemptFail, AttemptTimeout},
							Hint:    "A timeout is an attempt that did not pass. An attempt counts once its first pass is chosen."},
						{Key: "mandatory", Label: "Mandatory failures", Type: Text},
						{Key: "revision", Label: "Human revision: minutes and changes", Type: Text},
						{Key: EvaluationFinal, Label: "Final state", Type: Choice,
							Options: []string{FinalAccepted, FinalFailed, FinalTimeout}},
					}},
			}},
		// §4
		{Key: EvaluationResults, Title: "Results",
			Hint: "Count each version on its own. Failures and timeouts stay among the attempts. If nothing was " +
				"accepted, the cost per accepted result cannot be calculated: say so, and keep the cost that was spent.",
			Fields: []Field{
				{Key: EvaluationRates, Label: "Rates", Type: Table, RowHeader: "Version",
					Rows: []Row{
						{Key: VersionCurrent, Label: "Current"},
						{Key: VersionCandidate, Label: "Candidate"},
					},
					Columns: []Field{
						{Key: EvaluationFirstPass, Label: "Accepted on the first pass / all attempts", Type: Text,
							Hint: "Written as accepted/attempts, such as 8/10. It must agree with that version's case rows."},
						{Key: EvaluationRevised, Label: "Accepted after human revision / all attempts", Type: Text,
							Hint: "The same attempts, counted by their final state."},
					}},
				{Key: "mandatory", Label: "Mandatory failures, and the cases they happened in", Type: Text},
				{Key: "minutes", Label: "Total minutes for preparing, running, checking and rework", Type: Text},
				{Key: "charges", Label: "Tool charges, and the value put on time", Type: Text},
				{Key: "cost", Label: "Total cost of the batch / accepted results", Type: Text},
				{Key: "limits", Label: "What the evidence cannot support", Type: Long},
			}},
		// §5
		{Key: "decision", Title: "Decision and follow-up",
			Hint: "Fix one main error pattern per round, then rerun the case that failed and the ones that passed before.",
			Fields: []Field{
				{Key: "decision", Label: "Decision", Type: Choice,
					Options: []string{"adopt", "keep the current version", "repair and retest", "stop"}},
				{Key: "cases", Label: "Cases behind the decision", Type: Text},
				{Key: "regression", Label: "New regression cases, and what is rerun", Type: Text},
				{Key: "retest", Label: "What triggers a retest after a model, material, tool or memory change; the last accepted version", Type: Text},
				{Key: "use", Label: "Permitted use, when a person takes over, and when it is withdrawn", Type: Text},
				{Key: "exit", Label: "Exit rehearsal: another provider, memory off, tools disconnected", Type: Text},
				{Key: "owner", Label: "Owner, review date and where this record is kept", Type: Text},
			}},
	},
}

// Rate is one version's count from its case rows: attempts are rows with a
// first pass chosen, failures and timeouts included.
type Rate struct {
	FirstPass int
	Revised   int
	Attempts  int
}

// EvaluationRatesOf counts each version's attempts in a cases table value,
// cleaned or stored.
func EvaluationRatesOf(cases any) map[string]Rate {
	out := map[string]Rate{}
	for _, cells := range tableRows(cases) {
		version, outcome := cellText(cells, EvaluationVersion), cellText(cells, EvaluationFirstPass)
		if version == "" || outcome == "" {
			continue
		}
		r := out[version]
		r.Attempts++
		if outcome == AttemptPass {
			r.FirstPass++
		}
		if cellText(cells, EvaluationFinal) == FinalAccepted {
			r.Revised++
		}
		out[version] = r
	}
	return out
}

var rateShape = regexp.MustCompile(`^(\d{1,4})\s*/\s*(\d{1,4})$`)

// checkEvaluationRates refuses, when the results are written, a stored rate
// that is not "accepted/attempts" or disagrees with the case rows.
func checkEvaluationRates(a Answers, written map[string]bool) error {
	if !written[EvaluationResults] {
		return nil
	}
	counted := EvaluationRatesOf(a[EvaluationCases][EvaluationCasesTable])
	rows, _ := normalize(a[EvaluationResults][EvaluationRates]).([]any)
	for i, raw := range rows {
		row, _ := raw.(map[string]any)
		version, _ := row["row"].(string)
		cells, _ := row["cells"].(map[string]any)
		r := counted[version]
		for _, col := range []struct {
			key  string
			want int
		}{{EvaluationFirstPass, r.FirstPass}, {EvaluationRevised, r.Revised}} {
			stored := cellText(cells, col.key)
			if stored == "" {
				continue
			}
			path := fmt.Sprintf("%s.%s[%d].%s", EvaluationResults, EvaluationRates, i, col.key)
			m := rateShape.FindStringSubmatch(stored)
			if m == nil {
				return &FieldError{Field: path, Reason: "write a rate as accepted/attempts, such as 8/10"}
			}
			n, _ := strconv.Atoi(m[1])
			d, _ := strconv.Atoi(m[2])
			if n != col.want || d != r.Attempts {
				return &FieldError{Field: path, Reason: fmt.Sprintf(
					"the %s version's case rows give %d/%d; failures and timeouts stay among the attempts",
					version, col.want, r.Attempts)}
			}
		}
	}
	return nil
}

func init() { register(aiEvaluation) }
