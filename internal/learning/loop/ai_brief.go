package loop

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ai_brief.go is the pair of worksheets for handing work to a model: the brief
// written before, and the log that compares three runs after — without AI,
// with AI, and alone again some days later.
//
// The third run is the point. "With AI" beating "without" says the tool helped
// with the task; only "alone, later" beating "without" says the person learned
// something. ThreeWay reads exactly that and nothing more.

// Pre-start checks: the questions a brief should be able to answer before the
// task is handed over. Fixed here so the UI and the Ready check agree.
const (
	CheckOutputEvalWritten = "output_eval_written"
	CheckHumanGatesNamed   = "human_gates_named"
	CheckRollbackKnown     = "rollback_known"
	CheckBaselineRecorded  = "baseline_recorded"
)

// PreStartChecks returns every check key, in display order.
func PreStartChecks() []string {
	return []string{CheckOutputEvalWritten, CheckHumanGatesNamed, CheckRollbackKnown, CheckBaselineRecorded}
}

// Brief is one row of ai_task_briefs.
type Brief struct {
	ID                uuid.UUID       `json:"id"`
	UserID            uuid.UUID       `json:"-"`
	StateID           uuid.UUID       `json:"state_id"`
	Task              string          `json:"task"`
	DataBoundaryNote  string          `json:"data_boundary_note"`
	OutputEval        string          `json:"output_eval"`
	AIScope           string          `json:"ai_scope"`
	HumanGates        string          `json:"human_gates"`
	CostReversibility string          `json:"cost_reversibility"`
	FailureRollback   string          `json:"failure_rollback"`
	Handover          string          `json:"handover"`
	PreStartCheck     map[string]bool `json:"pre_start_check"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

// BriefInput is the body for creating or replacing a brief's fields. Every
// field is a pointer so the same shape serves create and patch.
type BriefInput struct {
	Task              *string          `json:"task"`
	DataBoundaryNote  *string          `json:"data_boundary_note"`
	OutputEval        *string          `json:"output_eval"`
	AIScope           *string          `json:"ai_scope"`
	HumanGates        *string          `json:"human_gates"`
	CostReversibility *string          `json:"cost_reversibility"`
	FailureRollback   *string          `json:"failure_rollback"`
	Handover          *string          `json:"handover"`
	PreStartCheck     *map[string]bool `json:"pre_start_check"`
}

// Validate checks a brief input. create requires the task.
func (in BriefInput) Validate(create bool) error {
	if create || in.Task != nil {
		task := ""
		if in.Task != nil {
			task = *in.Task
		}
		if err := requireText("task", task, MaxTextLen); err != nil {
			return err
		}
	}
	for name, v := range map[string]*string{
		"data boundary note": in.DataBoundaryNote, "output evaluation": in.OutputEval,
		"AI scope": in.AIScope, "human gates": in.HumanGates,
		"cost and reversibility": in.CostReversibility, "failure and rollback": in.FailureRollback,
	} {
		if v != nil && len(*v) > MaxTextLen {
			return fmt.Errorf("%w: the %s is too long", ErrInvalid, name)
		}
	}
	if in.Handover != nil && len(*in.Handover) > 2*MaxTextLen {
		return fmt.Errorf("%w: the handover is too long", ErrInvalid)
	}
	if in.PreStartCheck != nil {
		for k := range *in.PreStartCheck {
			if !contains(PreStartChecks(), k) {
				return fmt.Errorf("%w: unknown pre-start check %q", ErrInvalid, k)
			}
		}
	}
	return nil
}

// Apply writes an input onto a brief.
func (in BriefInput) Apply(b *Brief) {
	set := func(dst *string, v *string) {
		if v != nil {
			*dst = *v
		}
	}
	set(&b.Task, in.Task)
	set(&b.DataBoundaryNote, in.DataBoundaryNote)
	set(&b.OutputEval, in.OutputEval)
	set(&b.AIScope, in.AIScope)
	set(&b.HumanGates, in.HumanGates)
	set(&b.CostReversibility, in.CostReversibility)
	set(&b.FailureRollback, in.FailureRollback)
	set(&b.Handover, in.Handover)
	if in.PreStartCheck != nil {
		b.PreStartCheck = *in.PreStartCheck
	}
	if b.PreStartCheck == nil {
		b.PreStartCheck = map[string]bool{}
	}
}

// Unchecked returns the pre-start checks not yet ticked, in display order.
func (b Brief) Unchecked() []string {
	var out []string
	for _, k := range PreStartChecks() {
		if !b.PreStartCheck[k] {
			out = append(out, k)
		}
	}
	return out
}

// Log metrics, fixed so the three columns always line up.
const (
	MetricCompletion      = "completion"
	MetricQuality         = "quality"
	MetricIndependentPerf = "independent_perf"
	MetricRework          = "rework"
	MetricCost            = "cost"
	MetricTransfer        = "transfer"
)

// LogMetrics returns every metric key, in display order.
func LogMetrics() []string {
	return []string{MetricCompletion, MetricQuality, MetricIndependentPerf, MetricRework, MetricCost, MetricTransfer}
}

// LowerIsBetter reports whether a smaller value of the metric is the better
// one. Rework and cost are the two.
func LowerIsBetter(metric string) bool { return metric == MetricRework || metric == MetricCost }

// Cell is one measurement in the three-way table.
type Cell struct {
	Value *float64 `json:"value"`
	Note  string   `json:"note"`
}

// Log is one row of ai_learning_logs.
type Log struct {
	ID                 uuid.UUID         `json:"id"`
	UserID             uuid.UUID         `json:"-"`
	BriefID            uuid.UUID         `json:"brief_id"`
	BaselineNoAI       map[string]Cell   `json:"baseline_noai"`
	Assisted           map[string]Cell   `json:"assisted"`
	DelayedIndependent map[string]Cell   `json:"delayed_independent"`
	Metrics            map[string]string `json:"metrics"`
	NextCycleDecision  string            `json:"next_cycle_decision"`
	CreatedAt          time.Time         `json:"created_at"`
	UpdatedAt          time.Time         `json:"updated_at"`
}

// LogInput is the body for creating or patching a log.
type LogInput struct {
	BaselineNoAI       *map[string]Cell   `json:"baseline_noai"`
	Assisted           *map[string]Cell   `json:"assisted"`
	DelayedIndependent *map[string]Cell   `json:"delayed_independent"`
	Metrics            *map[string]string `json:"metrics"`
	NextCycleDecision  *string            `json:"next_cycle_decision"`
}

// Validate checks a log input.
func (in LogInput) Validate() error {
	for name, col := range map[string]*map[string]Cell{
		"without AI": in.BaselineNoAI, "with AI": in.Assisted, "alone, later": in.DelayedIndependent,
	} {
		if col == nil {
			continue
		}
		for k, c := range *col {
			if !contains(LogMetrics(), k) {
				return fmt.Errorf("%w: unknown metric %q in %s", ErrInvalid, k, name)
			}
			if len(c.Note) > MaxTextLen {
				return fmt.Errorf("%w: a note in %s is too long", ErrInvalid, name)
			}
		}
	}
	if in.Metrics != nil {
		for k, v := range *in.Metrics {
			if !contains(LogMetrics(), k) {
				return fmt.Errorf("%w: unknown metric %q", ErrInvalid, k)
			}
			if len(v) > MaxTextLen {
				return fmt.Errorf("%w: the measure for %s is too long", ErrInvalid, k)
			}
		}
	}
	if in.NextCycleDecision != nil && len(*in.NextCycleDecision) > MaxTextLen {
		return fmt.Errorf("%w: the decision is too long", ErrInvalid)
	}
	return nil
}

// Apply writes an input onto a log.
func (in LogInput) Apply(l *Log) {
	if in.BaselineNoAI != nil {
		l.BaselineNoAI = *in.BaselineNoAI
	}
	if in.Assisted != nil {
		l.Assisted = *in.Assisted
	}
	if in.DelayedIndependent != nil {
		l.DelayedIndependent = *in.DelayedIndependent
	}
	if in.Metrics != nil {
		l.Metrics = *in.Metrics
	}
	if in.NextCycleDecision != nil {
		l.NextCycleDecision = *in.NextCycleDecision
	}
	for _, m := range []*map[string]Cell{&l.BaselineNoAI, &l.Assisted, &l.DelayedIndependent} {
		if *m == nil {
			*m = map[string]Cell{}
		}
	}
	if l.Metrics == nil {
		l.Metrics = map[string]string{}
	}
}

// Readings of one metric across the three runs.
const (
	// ReadingIncomplete: a value is missing, so nothing is concluded.
	ReadingIncomplete = "incomplete"
	// ReadingRetained: alone-later beats without-AI. Something was learned.
	ReadingRetained = "retained"
	// ReadingOnlyWithAI: with-AI beats without-AI, alone-later does not. The
	// tool did the work; the person did not keep it.
	ReadingOnlyWithAI = "only_with_ai"
	// ReadingNoGain: neither beats without-AI.
	ReadingNoGain = "no_gain"
)

// ThreeWayRow is one metric across the three runs, with its reading and what
// that reading cannot show.
type ThreeWayRow struct {
	Metric      string `json:"metric"`
	Measure     string `json:"measure"`
	Baseline    Cell   `json:"baseline_noai"`
	Assisted    Cell   `json:"assisted"`
	Delayed     Cell   `json:"delayed_independent"`
	Reading     string `json:"reading"`
	CannotProve string `json:"cannot_prove"`
}

// ThreeWay reads a log metric by metric.
func ThreeWay(l Log) []ThreeWayRow {
	out := make([]ThreeWayRow, 0, len(LogMetrics()))
	for _, m := range LogMetrics() {
		row := ThreeWayRow{
			Metric: m, Measure: l.Metrics[m],
			Baseline: l.BaselineNoAI[m], Assisted: l.Assisted[m], Delayed: l.DelayedIndependent[m],
		}
		row.Reading = readMetric(m, row.Baseline.Value, row.Assisted.Value, row.Delayed.Value)
		row.CannotProve = cannotProveReading(row.Reading)
		out = append(out, row)
	}
	return out
}

func readMetric(metric string, base, assisted, delayed *float64) string {
	if base == nil || assisted == nil || delayed == nil {
		return ReadingIncomplete
	}
	better := func(a, b float64) bool {
		if LowerIsBetter(metric) {
			return a < b
		}
		return a > b
	}
	switch {
	case better(*delayed, *base):
		return ReadingRetained
	case better(*assisted, *base):
		return ReadingOnlyWithAI
	default:
		return ReadingNoGain
	}
}

func cannotProveReading(reading string) string {
	switch reading {
	case ReadingRetained:
		return "One later run beating the first cannot rule out practice with the task itself, an easier second task, or a good day."
	case ReadingOnlyWithAI:
		return "This cannot tell whether a longer gap, more practice, or a different task would have kept the gain."
	case ReadingNoGain:
		return "No gain on one measure cannot show the AI was useless; it may have helped on something this metric does not see."
	default:
		return "With a run missing, this row cannot say anything about learning."
	}
}
