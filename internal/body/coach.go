package body

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/modeljson"
	bodyprompts "github.com/D0bby999/anytools/internal/prompts/body"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// coach.go — a plan drafted and revised on the learner's own model.
//
// The model proposes; nothing changes until the learner accepts, and an
// accepted change can be reverted. Every answer is held to the real library
// and the plan's limits (ValidatePlan), and a failure gets ONE repair with
// the list of problems. The coach never sets the day-to-day load of an
// exercise already trained: progression.go stays the only thing that does.

// CoachFunction is the route the coach runs on: the learner's main model.
const CoachFunction = "chat"

// Proposal kinds and statuses.
const (
	KindPlan   = "plan"
	KindReview = "review"

	StatusProposed = "proposed"
	StatusAccepted = "accepted"
	StatusDeclined = "declined"
	StatusReplaced = "replaced"
	StatusReverted = "reverted"
)

// Goals and experience levels the intake offers.
var (
	Goals       = []string{"strength", "muscle", "fat_loss", "fitness", "health"}
	Experiences = []string{"new", "some", "experienced"}
)

// Intake is what the learner told the coach.
type Intake struct {
	Goal          string   `json:"goal"`
	Experience    string   `json:"experience"`
	DaysPerWeek   int      `json:"days_per_week"`
	PreferredDays []int    `json:"preferred_days"`
	SessionMin    int      `json:"session_min"`
	Equipment     []string `json:"equipment"`
	Limitations   string   `json:"limitations"`
	Note          string   `json:"note"`
}

// Clean validates an intake.
func (in Intake) Clean() (Intake, error) {
	if !slices.Contains(Goals, in.Goal) {
		return Intake{}, invalid("choose a goal")
	}
	if !slices.Contains(Experiences, in.Experience) {
		return Intake{}, invalid("choose how much you have trained")
	}
	if in.DaysPerWeek < 1 || in.DaysPerWeek > 7 {
		return Intake{}, invalid("train 1 to 7 days a week")
	}
	if in.SessionMin < 10 || in.SessionMin > 180 {
		return Intake{}, invalid("a session lasts 10 to 180 minutes")
	}
	out := Intake{Goal: in.Goal, Experience: in.Experience, DaysPerWeek: in.DaysPerWeek, SessionMin: in.SessionMin,
		Limitations: clip(in.Limitations, MaxNote), Note: clip(in.Note, MaxNote), PreferredDays: []int{}, Equipment: []string{}}
	for _, d := range in.PreferredDays {
		if d >= 0 && d <= 6 && !slices.Contains(out.PreferredDays, d) {
			out.PreferredDays = append(out.PreferredDays, d)
		}
	}
	slices.Sort(out.PreferredDays)
	known := LibraryFacets().Equipment
	for _, e := range in.Equipment {
		if slices.Contains(known, e) && !slices.Contains(out.Equipment, e) {
			out.Equipment = append(out.Equipment, e)
		}
	}
	return out, nil
}

// CoachRoutine is a routine in a proposed plan. Key names it within the plan.
type CoachRoutine struct {
	Key       string         `json:"key"`
	Name      string         `json:"name"`
	Prog      string         `json:"prog,omitempty"`
	Why       string         `json:"why,omitempty"`
	Exercises []PlanExercise `json:"exercises"`
}

// CoachPlan is a whole plan: routines and the week, by key ("" = rest).
type CoachPlan struct {
	Name     string         `json:"name"`
	Summary  string         `json:"summary"`
	BasedOn  string         `json:"based_on"`
	Routines []CoachRoutine `json:"routines"`
	Week     [7]string      `json:"week"`
}

// Change is one line of a review: what changes and the evidence for it.
type Change struct {
	What string `json:"what"`
	Why  string `json:"why"`
}

// Proposal is one coach answer, waiting for the learner or decided.
type Proposal struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"-"`
	Kind      string     `json:"kind"`
	Status    string     `json:"status"`
	Intake    *Intake    `json:"intake,omitempty"`
	Request   string     `json:"request"`
	Plan      *CoachPlan `json:"plan"`
	Changes   []Change   `json:"changes"`
	Notes     []string   `json:"notes"`
	NoChange  bool       `json:"nochange"`
	Reading   string     `json:"reading"`
	CreatedAt time.Time  `json:"created_at"`
	DecidedAt *time.Time `json:"decided_at"`
	// CanRevert is true on the latest accepted proposal while what it
	// replaced is still on file.
	CanRevert bool `json:"can_revert"`
}

// CoachStore persists proposals (pg.BodyStore).
type CoachStore interface {
	CreateProposal(ctx context.Context, p Proposal) (*Proposal, error)
	Proposal(ctx context.Context, userID, id uuid.UUID) (*Proposal, error)
	Proposals(ctx context.Context, userID uuid.UUID, limit int) ([]Proposal, error)
	// SetProposalStatus moves a proposal from one of `from` to `to`; false
	// when it was in none of them.
	SetProposalStatus(ctx context.Context, userID, id uuid.UUID, from []string, to string) (bool, error)
	// AcceptProposal replaces the learner's routines and week with the
	// proposal's plan, keeping what it replaced for a revert, in one
	// transaction. ErrConflict when the proposal is not waiting.
	AcceptProposal(ctx context.Context, userID, id uuid.UUID) error
	// RevertProposal puts back what an accepted proposal replaced, only while
	// it is the latest accepted. ErrConflict otherwise.
	RevertProposal(ctx context.Context, userID, id uuid.UUID) error
}

// Languages reads the learner's interface language (en, vi, es, pt).
type Languages interface {
	Language(ctx context.Context, userID uuid.UUID) (string, error)
}

// Coach drafts and revises plans.
type Coach struct {
	svc       *Service
	proposals CoachStore
	providers runtime.ChatProviderResolver
	languages Languages
}

// NewCoach builds the coach over the service's store.
func NewCoach(svc *Service, proposals CoachStore, providers runtime.ChatProviderResolver, languages Languages) *Coach {
	return &Coach{svc: svc, proposals: proposals, providers: providers, languages: languages}
}

// MaxRequest caps the learner's words to the coach.
const MaxRequest = 1000

// Plan drafts a complete plan from an intake.
func (c *Coach) Plan(ctx context.Context, userID uuid.UUID, in Intake) (*Proposal, error) {
	in, err := in.Clean()
	if err != nil {
		return nil, err
	}
	p, err := c.svc.store.Profile(ctx, userID)
	if err != nil {
		return nil, err
	}
	p.Intake = &in
	if err := c.svc.store.SaveProfile(ctx, userID, p); err != nil {
		return nil, err
	}
	payload, caps, err := c.payload(ctx, userID, p, &in)
	if err != nil {
		return nil, err
	}
	task := bodyprompts.Plan
	user := payload + "\n\n" + learnerWords("intake", in.Limitations, in.Note)
	plan, _, err := c.ask(ctx, userID, task, user, func(raw []byte) (*CoachPlan, *reviewAnswer, []string) {
		plan, errs := ValidatePlan(raw, caps, in.DaysPerWeek)
		return plan, nil, errs
	})
	if err != nil {
		return nil, err
	}
	return c.proposals.CreateProposal(ctx, Proposal{UserID: userID, Kind: KindPlan, Status: StatusProposed,
		Intake: &in, Plan: plan, Changes: []Change{}, Notes: []string{}})
}

// Refine revises a waiting plan proposal in the learner's own words. The new
// proposal replaces the old one.
func (c *Coach) Refine(ctx context.Context, userID, id uuid.UUID, text string) (*Proposal, error) {
	text = strings.TrimSpace(text)
	if text == "" || len([]rune(text)) > MaxRequest {
		return nil, invalid(fmt.Sprintf("say what to change, in up to %d characters", MaxRequest))
	}
	prev, err := c.proposals.Proposal(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if prev.Kind != KindPlan || prev.Status != StatusProposed || prev.Plan == nil {
		return nil, fmt.Errorf("%w: only a plan waiting for you can be revised", ErrConflict)
	}
	p, err := c.svc.store.Profile(ctx, userID)
	if err != nil {
		return nil, err
	}
	payload, caps, err := c.payload(ctx, userID, p, prev.Intake)
	if err != nil {
		return nil, err
	}
	previous, _ := json.Marshal(prev.Plan)
	days := 0
	if prev.Intake != nil {
		days = prev.Intake.DaysPerWeek
	}
	user := payload + "\n\nThe plan you proposed:\n" + string(previous) + "\n\n" + learnerWords("refine", text)
	plan, _, err := c.ask(ctx, userID, bodyprompts.Refine, user, func(raw []byte) (*CoachPlan, *reviewAnswer, []string) {
		plan, errs := ValidatePlan(raw, caps, days)
		return plan, nil, errs
	})
	if err != nil {
		return nil, err
	}
	if ok, err := c.proposals.SetProposalStatus(ctx, userID, id, []string{StatusProposed}, StatusReplaced); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("%w: this plan was decided meanwhile", ErrConflict)
	}
	return c.proposals.CreateProposal(ctx, Proposal{UserID: userID, Kind: KindPlan, Status: StatusProposed,
		Intake: prev.Intake, Request: text, Plan: plan, Changes: []Change{}, Notes: []string{}})
}

// Review reads the log against the plan and proposes changes, or says
// plainly that nothing needs changing.
func (c *Coach) Review(ctx context.Context, userID uuid.UUID, note string) (*Proposal, error) {
	note = clip(note, MaxRequest)
	p, err := c.svc.store.Profile(ctx, userID)
	if err != nil {
		return nil, err
	}
	routines, err := c.svc.store.Routines(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(routines) == 0 {
		return nil, invalid("there is no plan to review yet — draft one first")
	}
	payload, caps, err := c.payload(ctx, userID, p, p.Intake)
	if err != nil {
		return nil, err
	}
	user := payload + "\n\n" + learnerWords("review", note)
	_, review, err := c.ask(ctx, userID, bodyprompts.Review, user, func(raw []byte) (*CoachPlan, *reviewAnswer, []string) {
		r, errs := ValidateReview(raw, caps)
		return nil, r, errs
	})
	if err != nil {
		return nil, err
	}
	return c.proposals.CreateProposal(ctx, Proposal{UserID: userID, Kind: KindReview, Status: StatusProposed,
		Request: note, Plan: review.Plan, Changes: review.Changes, Notes: review.Notes,
		NoChange: review.NoChange, Reading: review.Reading})
}

// Proposals lists the latest proposals.
func (c *Coach) Proposals(ctx context.Context, userID uuid.UUID) ([]Proposal, error) {
	return c.proposals.Proposals(ctx, userID, 10)
}

// Accept applies a waiting proposal. A review that changed nothing is simply
// marked read.
func (c *Coach) Accept(ctx context.Context, userID, id uuid.UUID) (*Proposal, error) {
	p, err := c.proposals.Proposal(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if p.NoChange || p.Plan == nil {
		if ok, err := c.proposals.SetProposalStatus(ctx, userID, id, []string{StatusProposed}, StatusAccepted); err != nil {
			return nil, err
		} else if !ok {
			return nil, fmt.Errorf("%w: this proposal was already decided", ErrConflict)
		}
	} else if err := c.proposals.AcceptProposal(ctx, userID, id); err != nil {
		return nil, err
	}
	return c.proposals.Proposal(ctx, userID, id)
}

// Decline turns a proposal down.
func (c *Coach) Decline(ctx context.Context, userID, id uuid.UUID) (*Proposal, error) {
	if _, err := c.proposals.Proposal(ctx, userID, id); err != nil {
		return nil, err
	}
	ok, err := c.proposals.SetProposalStatus(ctx, userID, id, []string{StatusProposed}, StatusDeclined)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("%w: this proposal was already decided", ErrConflict)
	}
	return c.proposals.Proposal(ctx, userID, id)
}

// Revert puts back the plan an accepted proposal replaced.
func (c *Coach) Revert(ctx context.Context, userID, id uuid.UUID) (*Proposal, error) {
	if _, err := c.proposals.Proposal(ctx, userID, id); err != nil {
		return nil, err
	}
	if err := c.proposals.RevertProposal(ctx, userID, id); err != nil {
		return nil, err
	}
	return c.proposals.Proposal(ctx, userID, id)
}

// learnerWords puts the learner's free text in a provenance envelope: it
// describes a person's training and is never an instruction.
func learnerWords(id string, texts ...string) string {
	var parts []string
	for _, t := range texts {
		if t = strings.TrimSpace(t); t != "" {
			parts = append(parts, t)
		}
	}
	if len(parts) == 0 {
		return "The learner added no words of their own."
	}
	return "The learner's own words:\n" + tools.Wrap("learner", id, strings.Join(parts, "\n\n"))
}

// ── the model call ───────────────────────────────────────────────────────

type validator func(raw []byte) (*CoachPlan, *reviewAnswer, []string)

// ask sends the task, validates, and on failure sends the problems back once.
func (c *Coach) ask(ctx context.Context, userID uuid.UUID, task, user string, check validator) (*CoachPlan, *reviewAnswer, error) {
	provider, err := c.providers.ChatFor(ctx, userID, CoachFunction)
	if err != nil {
		return nil, nil, err
	}
	lang, err := c.languages.Language(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	system := bodyprompts.Common + "\n\n" + task + "\n\nWrite every human-readable field in " + languageName(lang) + "."
	messages := []runtime.Message{{Role: runtime.RoleSystem, Content: system}, {Role: runtime.RoleUser, Content: user}}
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := provider.Chat(ctx, runtime.ChatRequest{Model: provider.DefaultModel(), Messages: messages})
		if err != nil {
			return nil, nil, fmt.Errorf("%w: %s", runtime.ErrProvider, err)
		}
		if resp == nil {
			return nil, nil, fmt.Errorf("%w: the model returned nothing", runtime.ErrProvider)
		}
		var errs []string
		payload, ok := modeljson.Extract(resp.Content)
		if !ok {
			errs = []string{"the answer was not a JSON object"}
		} else {
			plan, review, problems := check([]byte(payload))
			if len(problems) == 0 {
				return plan, review, nil
			}
			errs = problems
		}
		messages = append(messages,
			runtime.Message{Role: runtime.RoleAssistant, Content: truncate(resp.Content, 20000)},
			runtime.Message{Role: runtime.RoleUser, Content: bodyprompts.Repair + "\n\nProblems:\n- " + strings.Join(errs, "\n- ")})
	}
	return nil, nil, ErrCoachFailed
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func languageName(code string) string {
	switch code {
	case "vi":
		return "Vietnamese"
	case "es":
		return "Spanish"
	case "pt":
		return "Brazilian Portuguese"
	}
	return "English"
}

// ── validation ───────────────────────────────────────────────────────────

// Caps are the heaviest weight the learner has handled per exercise: a coach
// never starts them above it, and never guesses a load they have not lifted.
type Caps map[string]float64

type rawPlan struct {
	Name     string            `json:"name"`
	Summary  string            `json:"summary"`
	BasedOn  string            `json:"based_on"`
	Week     map[string]string `json:"week"`
	Routines []struct {
		Key       string         `json:"key"`
		Name      string         `json:"name"`
		Prog      string         `json:"prog"`
		Why       string         `json:"why"`
		Exercises []PlanExercise `json:"exercises"`
	} `json:"routines"`
}

// ValidatePlan reads a plan answer. days > 0 requires exactly that many
// training days. Every problem is collected, for the one repair.
func ValidatePlan(raw []byte, caps Caps, days int) (*CoachPlan, []string) {
	var r rawPlan
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, []string{"the answer does not match the schema: " + err.Error()}
	}
	return checkPlan(r, caps, days)
}

func checkPlan(r rawPlan, caps Caps, days int) (*CoachPlan, []string) {
	var errs []string
	if len(r.Routines) == 0 || len(r.Routines) > MaxRoutines {
		errs = append(errs, fmt.Sprintf("routines must hold 1 to %d routines", MaxRoutines))
	}
	plan := &CoachPlan{Name: clip(r.Name, MaxName), Summary: clip(r.Summary, 1200), BasedOn: clip(r.BasedOn, MaxWhy)}
	if plan.Name == "" {
		plan.Name = "Plan"
	}
	keys := map[string]bool{}
	for i, rr := range r.Routines {
		if i >= MaxRoutines {
			break
		}
		where := fmt.Sprintf("routines[%d]", i)
		key := strings.TrimSpace(rr.Key)
		if key == "" || keys[key] {
			errs = append(errs, where+".key must be present and unique")
			continue
		}
		keys[key] = true
		name := clip(rr.Name, MaxName)
		if name == "" {
			errs = append(errs, where+".name is required")
		}
		if rr.Prog != "" && !slices.Contains([]string{PolicyOff, PolicyLinear, PolicyDouble, PolicyTime}, rr.Prog) {
			errs = append(errs, fmt.Sprintf("%s.prog %q is not one of off, linear, double, time", where, rr.Prog))
		}
		if len(rr.Exercises) == 0 || len(rr.Exercises) > MaxExercisesPerRoutine {
			errs = append(errs, fmt.Sprintf("%s must hold 1 to %d exercises", where, MaxExercisesPerRoutine))
		}
		cr := CoachRoutine{Key: key, Name: name, Prog: rr.Prog, Why: clip(rr.Why, MaxWhy)}
		for j, e := range rr.Exercises {
			clean, err := CleanPlanExercise(e)
			if err != nil {
				errs = append(errs, fmt.Sprintf("%s.exercises[%d]: %s", where, j, strings.TrimPrefix(err.Error(), "body: invalid: ")))
				continue
			}
			// Loads: never above what was handled, never guessed for what
			// was not. The first session sets the baseline.
			if cap, trained := caps[clean.Exercise]; trained {
				clean.Weight = min(clean.Weight, cap)
			} else {
				clean.Weight = 0
			}
			cr.Exercises = append(cr.Exercises, clean)
		}
		plan.Routines = append(plan.Routines, cr)
	}
	trained := 0
	for k, v := range r.Week {
		d, err := strconv.Atoi(k)
		if err != nil || d < 0 || d > 6 {
			errs = append(errs, fmt.Sprintf("week key %q is not a weekday number 0-6", k))
			continue
		}
		if v == "" || v == "rest" {
			continue
		}
		if !keys[v] {
			errs = append(errs, fmt.Sprintf("week[%s] names %q, which is not a routine key in this plan", k, v))
			continue
		}
		plan.Week[d] = v
		trained++
	}
	if trained == 0 {
		errs = append(errs, "the week schedules no training day")
	}
	if days > 0 && trained != days {
		errs = append(errs, fmt.Sprintf("the week schedules %d training days but %d were asked for", trained, days))
	}
	if len(errs) > 0 {
		return nil, errs
	}
	return plan, nil
}

type reviewAnswer struct {
	Plan     *CoachPlan
	Changes  []Change
	Notes    []string
	NoChange bool
	Reading  string
}

// ValidateReview reads a review answer: "no change" with a reading, or a
// revised plan with the changes that make it so.
func ValidateReview(raw []byte, caps Caps) (*reviewAnswer, []string) {
	var r struct {
		rawPlan
		NoChange bool     `json:"nochange"`
		Reading  string   `json:"reading"`
		Changes  []Change `json:"changes"`
		Notes    []string `json:"notes"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, []string{"the answer does not match the schema: " + err.Error()}
	}
	out := &reviewAnswer{Notes: []string{}, Changes: []Change{}}
	for _, n := range r.Notes {
		if n = clip(n, MaxWhy); n != "" && len(out.Notes) < 6 {
			out.Notes = append(out.Notes, n)
		}
	}
	if r.NoChange {
		out.NoChange, out.Reading = true, clip(r.Reading, 1200)
		if out.Reading == "" {
			return nil, []string{`"nochange": true needs a "reading" saying how the block went`}
		}
		return out, nil
	}
	var errs []string
	if len(r.Changes) == 0 || len(r.Changes) > 8 {
		errs = append(errs, `changes must list 1 to 8 changes, or answer "nochange": true`)
	}
	for i, ch := range r.Changes {
		ch.What, ch.Why = clip(ch.What, MaxWhy), clip(ch.Why, MaxWhy)
		if ch.What == "" || ch.Why == "" {
			errs = append(errs, fmt.Sprintf("changes[%d] needs both what and why — every change cites its evidence", i))
			continue
		}
		out.Changes = append(out.Changes, ch)
	}
	plan, perrs := checkPlan(r.rawPlan, caps, 0)
	errs = append(errs, perrs...)
	if len(errs) > 0 {
		return nil, errs
	}
	out.Plan = plan
	out.Reading = clip(r.Reading, 1200)
	return out, nil
}

// PlanRoutines turns a plan into routines and a week, in plan order. The
// store calls it inside the accepting transaction.
func PlanRoutines(userID uuid.UUID, plan CoachPlan) ([]Routine, [7]int) {
	var week [7]int
	index := map[string]int{}
	routines := make([]Routine, 0, len(plan.Routines))
	for i, r := range plan.Routines {
		index[r.Key] = i
		routines = append(routines, Routine{UserID: userID, Name: r.Name, Prog: r.Prog, Why: r.Why,
			Exercises: r.Exercises, Position: i})
	}
	for d, key := range plan.Week {
		week[d] = -1
		if i, ok := index[key]; ok && key != "" {
			week[d] = i
		}
	}
	return routines, week
}

// SnapshotPlan is the learner's current routines and week as a plan, kept
// so an accepted proposal can be undone.
func SnapshotPlan(routines []Routine, week Week) CoachPlan {
	plan := CoachPlan{Name: "Before"}
	for _, r := range routines {
		plan.Routines = append(plan.Routines, CoachRoutine{Key: r.ID.String(), Name: r.Name, Prog: r.Prog, Why: r.Why, Exercises: r.Exercises})
	}
	for d, id := range week {
		if id != nil {
			plan.Week[d] = id.String()
		}
	}
	return plan
}

// ── the payload ──────────────────────────────────────────────────────────

// payload is what leaves the server for the learner's provider. It is built
// field by field: no name, no email, no id but the plan's own keys, nothing
// from the rest of AnyLearn.
func (c *Coach) payload(ctx context.Context, userID uuid.UUID, p Profile, in *Intake) (string, Caps, error) {
	today, err := c.svc.today(ctx, userID)
	if err != nil {
		return "", nil, err
	}
	routines, err := c.svc.store.Routines(ctx, userID)
	if err != nil {
		return "", nil, err
	}
	week, err := c.svc.store.Week(ctx, userID)
	if err != nil {
		return "", nil, err
	}
	from := today.AddDate(0, 0, -56).Format(dayLayout)
	workouts, err := c.svc.store.Workouts(ctx, userID, from, 40)
	if err != nil {
		return "", nil, err
	}
	history, err := c.svc.historyFor(ctx, userID, today)
	if err != nil {
		return "", nil, err
	}
	weights, err := c.svc.store.Weights(ctx, userID, from)
	if err != nil {
		return "", nil, err
	}

	caps := Caps{}
	for _, w := range history {
		for _, e := range w.Entries {
			for _, s := range e.Sets {
				if s.Done && s.Weight > 0 {
					caps[e.Exercise] = max(caps[e.Exercise], s.Weight)
				}
			}
		}
	}

	type exOut struct {
		Exercise string  `json:"exercise"`
		Name     string  `json:"name"`
		Mode     string  `json:"mode"`
		Sets     int     `json:"sets"`
		Reps     int     `json:"reps,omitempty"`
		RepsMin  int     `json:"reps_min,omitempty"`
		Sec      int     `json:"sec,omitempty"`
		Min      float64 `json:"min,omitempty"`
		Weight   float64 `json:"weight,omitempty"`
		Prog     string  `json:"prog,omitempty"`
		Inc      float64 `json:"inc,omitempty"`
	}
	type routineOut struct {
		Key       string  `json:"key"`
		Name      string  `json:"name"`
		Prog      string  `json:"prog,omitempty"`
		Exercises []exOut `json:"exercises"`
	}
	planOut := struct {
		Routines []routineOut      `json:"routines"`
		Week     map[string]string `json:"week"`
	}{Routines: []routineOut{}, Week: map[string]string{}}
	for _, r := range routines {
		ro := routineOut{Key: r.ID.String(), Name: r.Name, Prog: r.Prog, Exercises: []exOut{}}
		for _, e := range r.Exercises {
			ex, _ := Lookup(e.Exercise)
			ro.Exercises = append(ro.Exercises, exOut{Exercise: e.Exercise, Name: ex.Name, Mode: e.Mode, Sets: e.Sets,
				Reps: e.Reps, RepsMin: e.RepsMin, Sec: e.Sec, Min: e.Min, Weight: e.Weight, Prog: e.Prog, Inc: e.Inc})
		}
		planOut.Routines = append(planOut.Routines, ro)
	}
	for d, id := range week {
		if id != nil {
			planOut.Week[strconv.Itoa(d)] = id.String()
		}
	}

	type setOut struct {
		Weight float64 `json:"weight,omitempty"`
		Reps   int     `json:"reps,omitempty"`
		Sec    int     `json:"sec,omitempty"`
		Min    float64 `json:"min,omitempty"`
		Done   bool    `json:"done"`
	}
	type entryOut struct {
		Exercise string   `json:"exercise"`
		Target   exOut    `json:"target"`
		Sets     []setOut `json:"sets"`
	}
	type workoutOut struct {
		Day     string     `json:"day"`
		Weekday int        `json:"weekday"`
		Routine string     `json:"routine"`
		Minutes int        `json:"minutes"`
		Entries []entryOut `json:"entries"`
	}
	logOut := []workoutOut{}
	trained := map[string]bool{}
	for _, w := range workouts {
		d, _ := ParseDay(w.Day)
		wo := workoutOut{Day: w.Day, Weekday: int(d.Weekday()), Routine: w.RoutineName, Minutes: w.Minutes(), Entries: []entryOut{}}
		for _, e := range w.Entries {
			t := e.Target
			eo := entryOut{Exercise: e.Exercise, Target: exOut{Exercise: t.Exercise, Mode: t.Mode, Sets: t.Sets, Reps: t.Reps, Sec: t.Sec, Min: t.Min, Weight: t.Weight}, Sets: []setOut{}}
			for _, s := range e.Sets {
				eo.Sets = append(eo.Sets, setOut{Weight: s.Weight, Reps: s.Reps, Sec: s.Sec, Min: s.Min, Done: s.Done})
			}
			wo.Entries = append(wo.Entries, eo)
			trained[e.Exercise] = true
		}
		logOut = append(logOut, wo)
	}

	type aggOut struct {
		Exercise string  `json:"exercise"`
		Name     string  `json:"name"`
		Sessions int     `json:"sessions"`
		Stalls   int     `json:"stalls"`
		Best     float64 `json:"heaviest,omitempty"`
	}
	aggs := []aggOut{}
	for id := range trained {
		ex, _ := Lookup(id)
		sessions := SessionsOf(workouts, id, ex.Mode())
		aggs = append(aggs, aggOut{Exercise: id, Name: ex.Name, Sessions: len(sessions), Stalls: StallCount(sessions), Best: caps[id]})
	}
	slices.SortFunc(aggs, func(a, b aggOut) int { return strings.Compare(a.Exercise, b.Exercise) })

	planned := 0
	for _, id := range week {
		if id != nil {
			planned++
		}
	}
	st := BuildStats(p, workouts, weights, today)
	coverage := map[string]float64{}
	for _, cv := range st.Coverage {
		coverage[cv.Group] = cv.Month
	}

	var equipment []string
	if in != nil {
		equipment = in.Equipment
	}

	doc := map[string]any{
		"meta": map[string]any{
			"unit": p.Unit, "today": today.Format(dayLayout), "weekday_today": int(today.Weekday()),
			"weekdays": "0 = Sunday, 1 = Monday … 6 = Saturday",
		},
		"intake": intakeOut(in),
		"plan":   planOut,
		"log":    map[string]any{"from": from, "to": today.Format(dayLayout), "workouts": logOut},
		"aggregates": map[string]any{
			"planned_days_per_week": planned, "workouts_in_window": len(workouts),
			"exercises": aggs, "sets_per_muscle_group_last_30_days": coverage,
		},
		"bodyweight": map[string]any{"goal": p.GoalWeight, "weigh_ins": weights},
	}
	b, err := json.Marshal(doc)
	if err != nil {
		return "", nil, err
	}
	return "Training data (JSON):\n" + string(b) + "\n\nExercise library you may choose from, one per line as id | name | body part | target | equipment:\n" +
		librarySlice(equipment), caps, nil
}

var (
	goalWords = map[string]string{
		"strength": "get stronger", "muscle": "build muscle", "fat_loss": "lose fat",
		"fitness": "general fitness", "health": "stay healthy while studying",
	}
	experienceWords = map[string]string{
		"new": "new to training", "some": "a few months of training", "experienced": "years of training",
	}
)

func intakeOut(in *Intake) any {
	if in == nil {
		return nil
	}
	// Limitations and the note travel in the envelope, not here. The goal and
	// experience go as phrases, not codes: a model handed "strength" quoted it
	// back to the learner ("your goal 'strength'").
	return map[string]any{"goal": goalWords[in.Goal], "experience": experienceWords[in.Experience], "days_per_week": in.DaysPerWeek,
		"preferred_days": in.PreferredDays, "session_minutes": in.SessionMin, "equipment": in.Equipment}
}

// librarySlice is the library filtered to the learner's equipment, plus
// body-weight work, which needs none. No equipment named means all of it.
func librarySlice(equipment []string) string {
	var b strings.Builder
	for _, e := range Library() {
		if len(equipment) > 0 && !slices.Contains(equipment, e.Equipment) && !e.Bodyweight() {
			continue
		}
		fmt.Fprintf(&b, "%s | %s | %s | %s | %s\n", e.ID, e.Name, e.BodyPart, e.Target, e.Equipment)
	}
	return b.String()
}
