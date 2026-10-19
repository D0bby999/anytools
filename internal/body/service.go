package body

import (
	"context"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

// Store is the persistence the service needs (pg.BodyStore). Every method
// takes the caller's user id, and an id that is not theirs is ErrNotFound.
type Store interface {
	Profile(ctx context.Context, userID uuid.UUID) (Profile, error)
	SaveProfile(ctx context.Context, userID uuid.UUID, p Profile) error
	// ConvertUnit rewrites every stored weight of the user by factor and
	// records the new unit, in one transaction.
	ConvertUnit(ctx context.Context, userID uuid.UUID, unit string, factor float64) error

	Routines(ctx context.Context, userID uuid.UUID) ([]Routine, error)
	Routine(ctx context.Context, userID, id uuid.UUID) (*Routine, error)
	CreateRoutine(ctx context.Context, r Routine) (*Routine, error)
	UpdateRoutine(ctx context.Context, r Routine) (*Routine, error)
	DeleteRoutine(ctx context.Context, userID, id uuid.UUID) error
	Week(ctx context.Context, userID uuid.UUID) (Week, error)
	// SetWeek replaces the week; a routine id that is not the user's is
	// ErrNotFound and changes nothing.
	SetWeek(ctx context.Context, userID uuid.UUID, w Week) error

	OpenWorkout(ctx context.Context, userID uuid.UUID) (*Workout, error)
	// CreateWorkout inserts an open workout, or returns the one already open
	// (created false): there is at most one at a time.
	CreateWorkout(ctx context.Context, w Workout) (*Workout, bool, error)
	Workout(ctx context.Context, userID, id uuid.UUID) (*Workout, error)
	SaveWorkout(ctx context.Context, w Workout) (*Workout, error)
	FinishWorkout(ctx context.Context, userID, id uuid.UUID, at time.Time) (*Workout, error)
	DeleteWorkout(ctx context.Context, userID, id uuid.UUID) error
	// Workouts lists finished workouts on or after a day, oldest first, at
	// most limit of the latest.
	Workouts(ctx context.Context, userID uuid.UUID, from string, limit int) ([]Workout, error)

	Weights(ctx context.Context, userID uuid.UUID, from string) ([]Weight, error)
	SetWeight(ctx context.Context, userID uuid.UUID, w Weight) error
	DeleteWeight(ctx context.Context, userID uuid.UUID, day string) error
}

// Zones reads the learner's IANA time zone (pg.UserStore).
type Zones interface {
	Timezone(ctx context.Context, userID uuid.UUID) (string, error)
}

// Service is Body's logic.
type Service struct {
	store Store
	zones Zones
	now   func() time.Time
}

// NewService builds the service. now is nil outside tests.
func NewService(store Store, zones Zones, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{store: store, zones: zones, now: now}
}

// today is the learner's calendar day.
func (s *Service) today(ctx context.Context, userID uuid.UUID) (time.Time, error) {
	zone, err := s.zones.Timezone(ctx, userID)
	if err != nil {
		return time.Time{}, err
	}
	d := learning.LocalDay(s.now(), zone)
	return time.Date(d.Year, d.Month, d.Day, 0, 0, 0, 0, time.UTC), nil
}

// ── profile ──────────────────────────────────────────────────────────────

// ProfileInput is a settings change; nil leaves a field as it is.
type ProfileInput struct {
	Unit       *string
	GoalWeight *float64
	ClearGoal  bool
	RestSec    *int
}

// SaveProfile applies a settings change. A new unit converts every stored
// weight first, so "80" never silently turns from kilograms into pounds.
func (s *Service) SaveProfile(ctx context.Context, userID uuid.UUID, in ProfileInput) (Profile, error) {
	p, err := s.store.Profile(ctx, userID)
	if err != nil {
		return Profile{}, err
	}
	if in.Unit != nil && *in.Unit != p.Unit {
		factor := 1.0
		switch *in.Unit {
		case UnitKg:
			factor = KgPerLb
		case UnitLb:
			factor = 1 / KgPerLb
		default:
			return Profile{}, invalid(`the unit is "kg" or "lb"`)
		}
		if err := s.store.ConvertUnit(ctx, userID, *in.Unit, factor); err != nil {
			return Profile{}, err
		}
		if p, err = s.store.Profile(ctx, userID); err != nil {
			return Profile{}, err
		}
	}
	if in.ClearGoal {
		p.GoalWeight = nil
	} else if in.GoalWeight != nil {
		if err := checkWeight(*in.GoalWeight, false); err != nil {
			return Profile{}, err
		}
		g := round1(*in.GoalWeight)
		p.GoalWeight = &g
	}
	if in.RestSec != nil {
		if *in.RestSec < 15 || *in.RestSec > 600 {
			return Profile{}, invalid("the rest timer runs from 15 seconds to 10 minutes")
		}
		p.RestSec = *in.RestSec
	}
	if err := s.store.SaveProfile(ctx, userID, p); err != nil {
		return Profile{}, err
	}
	return p, nil
}

func checkWeight(w float64, zeroOK bool) error {
	if math.IsNaN(w) || math.IsInf(w, 0) || w < 0 || w > MaxWeight || (!zeroOK && w == 0) {
		return invalid(fmt.Sprintf("a weight is between 0 and %g", MaxWeight))
	}
	return nil
}

// ── overview ─────────────────────────────────────────────────────────────

// Today is what the learner's calendar day asks of them.
type Today struct {
	Day       string     `json:"day"`
	Weekday   int        `json:"weekday"`
	RoutineID *uuid.UUID `json:"routine_id"`
	// Trained is whether a workout was finished today.
	Trained bool `json:"trained"`
}

// Overview is Body's front page, and Home's "Body today".
type Overview struct {
	Profile  Profile   `json:"profile"`
	Routines []Routine `json:"routines"`
	Week     Week      `json:"week"`
	Today    Today     `json:"today"`
	Open     *Workout  `json:"open"`
	// Recent are the latest finished workouts, newest first.
	Recent   []Workout `json:"recent"`
	ThisWeek int       `json:"this_week"`
	Weights  []Weight  `json:"weights"`
}

// Overview reads the front page.
func (s *Service) Overview(ctx context.Context, userID uuid.UUID) (*Overview, error) {
	today, err := s.today(ctx, userID)
	if err != nil {
		return nil, err
	}
	o := &Overview{}
	if o.Profile, err = s.store.Profile(ctx, userID); err != nil {
		return nil, err
	}
	if o.Routines, err = s.store.Routines(ctx, userID); err != nil {
		return nil, err
	}
	if o.Week, err = s.store.Week(ctx, userID); err != nil {
		return nil, err
	}
	if o.Open, err = s.store.OpenWorkout(ctx, userID); err != nil {
		return nil, err
	}
	month := today.AddDate(0, 0, -30).Format(dayLayout)
	recent, err := s.store.Workouts(ctx, userID, month, 60)
	if err != nil {
		return nil, err
	}
	if o.Weights, err = s.store.Weights(ctx, userID, today.AddDate(0, 0, -90).Format(dayLayout)); err != nil {
		return nil, err
	}
	day := today.Format(dayLayout)
	weekStart := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7)).Format(dayLayout)
	o.Today = Today{Day: day, Weekday: int(today.Weekday()), RoutineID: o.Week[today.Weekday()]}
	o.Recent = []Workout{}
	for i := len(recent) - 1; i >= 0; i-- {
		w := recent[i]
		if w.Day == day {
			o.Today.Trained = true
		}
		if w.Day >= weekStart {
			o.ThisWeek++
		}
		if len(o.Recent) < 5 {
			o.Recent = append(o.Recent, w)
		}
	}
	return o, nil
}

// PlannedToday is the name of the routine the week schedules today, or ""
// when it schedules none or a workout was already finished today. The daily
// reminder reads it, so a learner who turned reminders on hears about
// training as well as review.
func (s *Service) PlannedToday(ctx context.Context, userID uuid.UUID) (string, error) {
	o, err := s.Overview(ctx, userID)
	if err != nil || o.Today.RoutineID == nil || o.Today.Trained {
		return "", err
	}
	for _, r := range o.Routines {
		if r.ID == *o.Today.RoutineID {
			return r.Name, nil
		}
	}
	return "", nil
}

// ── routines and the week ────────────────────────────────────────────────

// RoutineInput is a routine as the learner wrote it.
type RoutineInput struct {
	Name      string
	Prog      string
	Exercises []PlanExercise
}

// CleanPlanExercise validates one exercise of a plan and fills its defaults.
// The coach's answers go through the same function.
func CleanPlanExercise(e PlanExercise) (PlanExercise, error) {
	ex, ok := Lookup(strings.TrimSpace(e.Exercise))
	if !ok {
		return PlanExercise{}, invalid(fmt.Sprintf("%q is not in the exercise library", e.Exercise))
	}
	out := PlanExercise{Exercise: ex.ID, Mode: e.Mode, Sets: e.Sets}
	if out.Mode == "" {
		out.Mode = ex.Mode()
	}
	if out.Sets == 0 {
		out.Sets = 3
	}
	if out.Sets < 1 || out.Sets > MaxSets {
		return PlanExercise{}, invalid(fmt.Sprintf("an exercise has 1 to %d sets", MaxSets))
	}
	switch out.Mode {
	case ModeReps:
		out.Reps = cmp0(e.Reps, 10)
		if out.Reps < 1 || out.Reps > MaxReps {
			return PlanExercise{}, invalid(fmt.Sprintf("reps run from 1 to %d", MaxReps))
		}
		if e.RepsMin != 0 {
			if e.RepsMin < 1 || e.RepsMin > out.Reps {
				return PlanExercise{}, invalid("the bottom of a rep range is between 1 and its top")
			}
			out.RepsMin = e.RepsMin
		}
		out.Weight = e.Weight
	case ModeTime:
		out.Sec = cmp0(e.Sec, 45)
		if out.Sec < MinSec || out.Sec > MaxSec {
			return PlanExercise{}, invalid(fmt.Sprintf("a hold lasts %d to %d seconds", MinSec, MaxSec))
		}
		out.Weight = e.Weight
	case ModeCardio:
		out.Min = e.Min
		if out.Min == 0 {
			out.Min = 20
		}
		if out.Min < 1 || out.Min > 300 || e.Speed < 0 || e.Speed > 60 {
			return PlanExercise{}, invalid("cardio runs 1 to 300 minutes, at a speed up to 60")
		}
		out.Speed = round1(e.Speed)
	default:
		return PlanExercise{}, invalid(`the mode is "reps", "time" or "cardio"`)
	}
	if err := checkWeight(out.Weight, true); err != nil {
		return PlanExercise{}, err
	}
	out.Weight = round1(out.Weight)
	if e.Inc < 0 || e.Inc > 100 {
		return PlanExercise{}, invalid("a load step is between 0 and 100")
	}
	out.Inc = round1(e.Inc)
	if e.Prog != "" {
		if !slices.Contains(PoliciesFor(out.Mode), e.Prog) {
			return PlanExercise{}, invalid(fmt.Sprintf("%q cannot drive a %s exercise", e.Prog, out.Mode))
		}
		out.Prog = e.Prog
	}
	out.Why = clip(e.Why, MaxWhy)
	return out, nil
}

func cmp0(v, def int) int {
	if v == 0 {
		return def
	}
	return v
}

// clip trims and caps a free-text field at n characters.
func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

func cleanRoutine(in RoutineInput) (Routine, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" || utf8.RuneCountInString(name) > MaxName {
		return Routine{}, invalid(fmt.Sprintf("a routine needs a name of up to %d characters", MaxName))
	}
	if in.Prog != "" && !slices.Contains([]string{PolicyOff, PolicyLinear, PolicyDouble, PolicyTime}, in.Prog) {
		return Routine{}, invalid(fmt.Sprintf("%q is not a progression policy", in.Prog))
	}
	if len(in.Exercises) > MaxExercisesPerRoutine {
		return Routine{}, invalid(fmt.Sprintf("a routine holds up to %d exercises", MaxExercisesPerRoutine))
	}
	r := Routine{Name: name, Prog: in.Prog, Exercises: make([]PlanExercise, 0, len(in.Exercises))}
	for _, e := range in.Exercises {
		clean, err := CleanPlanExercise(e)
		if err != nil {
			return Routine{}, err
		}
		r.Exercises = append(r.Exercises, clean)
	}
	return r, nil
}

// CreateRoutine adds a routine.
func (s *Service) CreateRoutine(ctx context.Context, userID uuid.UUID, in RoutineInput) (*Routine, error) {
	r, err := cleanRoutine(in)
	if err != nil {
		return nil, err
	}
	existing, err := s.store.Routines(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(existing) >= 20 {
		return nil, invalid("you can keep up to 20 routines")
	}
	r.UserID, r.Position = userID, len(existing)
	return s.store.CreateRoutine(ctx, r)
}

// UpdateRoutine replaces a routine's contents.
func (s *Service) UpdateRoutine(ctx context.Context, userID, id uuid.UUID, in RoutineInput) (*Routine, error) {
	cur, err := s.store.Routine(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	r, err := cleanRoutine(in)
	if err != nil {
		return nil, err
	}
	r.ID, r.UserID, r.Position, r.Why = cur.ID, userID, cur.Position, cur.Why
	return s.store.UpdateRoutine(ctx, r)
}

// Routine reads one routine.
func (s *Service) Routine(ctx context.Context, userID, id uuid.UUID) (*Routine, error) {
	return s.store.Routine(ctx, userID, id)
}

// DeleteRoutine removes a routine; its weekdays become rest days and past
// workouts keep its name.
func (s *Service) DeleteRoutine(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.DeleteRoutine(ctx, userID, id)
}

// SetWeek replaces the weekly schedule.
func (s *Service) SetWeek(ctx context.Context, userID uuid.UUID, w Week) (Week, error) {
	if err := s.store.SetWeek(ctx, userID, w); err != nil {
		return Week{}, err
	}
	return s.store.Week(ctx, userID)
}

// ── workouts ─────────────────────────────────────────────────────────────

// historyFor is the finished workouts progression reads: half a year is far
// more than the three sessions a stall needs.
func (s *Service) historyFor(ctx context.Context, userID uuid.UUID, today time.Time) ([]Workout, error) {
	return s.store.Workouts(ctx, userID, today.AddDate(0, -6, 0).Format(dayLayout), 200)
}

// entryFor builds an entry from a target, with its prescription applied.
func entryFor(t PlanExercise, routineProg string, history []Workout, unit string) Entry {
	p := Next(t, routineProg, SessionsOf(history, t.Exercise, t.Mode), unit)
	return Entry{Exercise: t.Exercise, Target: Applied(t, p), Advice: &p, Sets: BuildSets(t, p)}
}

// StartInput starts a workout: a routine's, or an empty one.
type StartInput struct {
	RoutineID  *uuid.UUID
	Bodyweight *float64
}

// StartWorkout opens today's workout with every target already worked out,
// or returns the one already open (created false).
func (s *Service) StartWorkout(ctx context.Context, userID uuid.UUID, in StartInput) (*Workout, bool, error) {
	if open, err := s.store.OpenWorkout(ctx, userID); err != nil || open != nil {
		return open, false, err
	}
	today, err := s.today(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	p, err := s.store.Profile(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	w := Workout{UserID: userID, Day: today.Format(dayLayout), StartedAt: s.now().UTC(), Entries: []Entry{}}
	if in.Bodyweight != nil {
		if err := checkWeight(*in.Bodyweight, false); err != nil {
			return nil, false, err
		}
		bw := round1(*in.Bodyweight)
		w.Bodyweight = &bw
	}
	if in.RoutineID != nil {
		r, err := s.store.Routine(ctx, userID, *in.RoutineID)
		if err != nil {
			return nil, false, err
		}
		history, err := s.historyFor(ctx, userID, today)
		if err != nil {
			return nil, false, err
		}
		w.RoutineID, w.RoutineName = &r.ID, r.Name
		for _, t := range r.Exercises {
			w.Entries = append(w.Entries, entryFor(t, r.Prog, history, p.Unit))
		}
	}
	created, fresh, err := s.store.CreateWorkout(ctx, w)
	if err != nil || !fresh {
		return created, fresh, err
	}
	// The weigh-in asked before training is a weigh-in like any other.
	if w.Bodyweight != nil {
		if err := s.store.SetWeight(ctx, userID, Weight{Day: w.Day, Weight: *w.Bodyweight}); err != nil {
			return nil, false, err
		}
	}
	return created, true, nil
}

// Workout reads one workout.
func (s *Service) Workout(ctx context.Context, userID, id uuid.UUID) (*Workout, error) {
	return s.store.Workout(ctx, userID, id)
}

// AddEntry appends an exercise to a workout, with its target worked out
// from its own history.
func (s *Service) AddEntry(ctx context.Context, userID, id uuid.UUID, exercise string) (*Workout, error) {
	w, err := s.store.Workout(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if len(w.Entries) >= MaxEntries {
		return nil, invalid(fmt.Sprintf("a workout holds up to %d exercises", MaxEntries))
	}
	t, err := CleanPlanExercise(PlanExercise{Exercise: exercise})
	if err != nil {
		return nil, err
	}
	today, err := s.today(ctx, userID)
	if err != nil {
		return nil, err
	}
	p, err := s.store.Profile(ctx, userID)
	if err != nil {
		return nil, err
	}
	history, err := s.historyFor(ctx, userID, today)
	if err != nil {
		return nil, err
	}
	// The last time this exercise was done sets the starting numbers.
	for _, old := range slices.Backward(history) {
		if e := lastEntry(old, t.Exercise); e != nil {
			t.Sets, t.Reps, t.Sec, t.Weight, t.Min, t.Speed = e.Target.Sets, e.Target.Reps, e.Target.Sec, e.Target.Weight, e.Target.Min, e.Target.Speed
			t.Mode = e.Target.Mode
			break
		}
	}
	w.Entries = append(w.Entries, entryFor(t, "", history, p.Unit))
	return s.store.SaveWorkout(ctx, *w)
}

func lastEntry(w Workout, exercise string) *Entry {
	for i := range w.Entries {
		if w.Entries[i].Exercise == exercise && w.Entries[i].Performed() {
			return &w.Entries[i]
		}
	}
	return nil
}

// WorkoutPatch is what the workout screen saves as the learner goes. A nil
// field is left as it is.
type WorkoutPatch struct {
	Entries    *[]Entry
	Bodyweight *float64
	ClearBW    bool
	Note       *string
}

// SaveWorkout records what was done. Finished workouts can be corrected too:
// progression reads the log fresh every time, so a fixed typo fixes the
// next target.
func (s *Service) SaveWorkout(ctx context.Context, userID, id uuid.UUID, patch WorkoutPatch) (*Workout, error) {
	w, err := s.store.Workout(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if patch.Entries != nil {
		entries, err := cleanEntries(*patch.Entries, w.Entries)
		if err != nil {
			return nil, err
		}
		w.Entries = entries
	}
	if patch.ClearBW {
		w.Bodyweight = nil
	} else if patch.Bodyweight != nil {
		if err := checkWeight(*patch.Bodyweight, false); err != nil {
			return nil, err
		}
		bw := round1(*patch.Bodyweight)
		w.Bodyweight = &bw
	}
	if patch.Note != nil {
		w.Note = clip(*patch.Note, MaxNote)
	}
	return s.store.SaveWorkout(ctx, *w)
}

// cleanEntries validates the learner's entries. Targets are re-validated and
// the advice is kept from the stored entry: neither is the browser's to set.
func cleanEntries(in, stored []Entry) ([]Entry, error) {
	if len(in) > MaxEntries {
		return nil, invalid(fmt.Sprintf("a workout holds up to %d exercises", MaxEntries))
	}
	advice := map[string]*Prescription{}
	for _, e := range stored {
		advice[e.Exercise] = e.Advice
	}
	out := make([]Entry, 0, len(in))
	for _, e := range in {
		t, err := CleanPlanExercise(e.Target)
		if err != nil {
			return nil, err
		}
		if len(e.Sets) > MaxSetsLogged {
			return nil, invalid(fmt.Sprintf("an exercise logs up to %d sets", MaxSetsLogged))
		}
		sets := make([]Set, 0, len(e.Sets))
		for _, set := range e.Sets {
			if err := checkWeight(set.Weight, true); err != nil {
				return nil, err
			}
			if set.Reps < 0 || set.Reps > 1000 || set.Sec < 0 || set.Sec > 4*MaxSec ||
				set.Min < 0 || set.Min > 600 || set.Speed < 0 || set.Speed > 60 ||
				math.IsNaN(set.Min) || math.IsNaN(set.Speed) {
				return nil, invalid("a set's numbers are out of range")
			}
			sets = append(sets, Set{Weight: round1(set.Weight), Reps: set.Reps, Sec: set.Sec,
				Min: round1(set.Min), Speed: round1(set.Speed), Done: set.Done})
		}
		out = append(out, Entry{Exercise: t.Exercise, Target: t, Advice: advice[t.Exercise], Sets: sets})
	}
	return out, nil
}

// Finished is a finished workout and the records it set.
type Finished struct {
	Workout *Workout `json:"workout"`
	Records []Record `json:"records"`
}

// FinishWorkout closes the workout and names any new bests.
func (s *Service) FinishWorkout(ctx context.Context, userID, id uuid.UUID) (*Finished, error) {
	w, err := s.store.Workout(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if w.FinishedAt != nil {
		return nil, fmt.Errorf("%w: this workout is already finished", ErrConflict)
	}
	day, err := ParseDay(w.Day)
	if err != nil {
		return nil, err
	}
	before, err := s.store.Workouts(ctx, userID, day.AddDate(-2, 0, 0).Format(dayLayout), 1000)
	if err != nil {
		return nil, err
	}
	done, err := s.store.FinishWorkout(ctx, userID, id, s.now().UTC())
	if err != nil {
		return nil, err
	}
	records := Records(*done, before)
	if records == nil {
		records = []Record{}
	}
	return &Finished{Workout: done, Records: records}, nil
}

// DeleteWorkout removes a workout, open or finished.
func (s *Service) DeleteWorkout(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.DeleteWorkout(ctx, userID, id)
}

// History is the latest finished workouts, newest first.
func (s *Service) History(ctx context.Context, userID uuid.UUID, limit int) ([]Workout, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	list, err := s.store.Workouts(ctx, userID, "1970-01-01", limit)
	if err != nil {
		return nil, err
	}
	slices.Reverse(list)
	return list, nil
}

// ── body weight ──────────────────────────────────────────────────────────

// SetWeight records a weigh-in; a day in the future is refused.
func (s *Service) SetWeight(ctx context.Context, userID uuid.UUID, day string, weight float64) (Weight, error) {
	d, err := ParseDay(day)
	if err != nil {
		return Weight{}, err
	}
	today, err := s.today(ctx, userID)
	if err != nil {
		return Weight{}, err
	}
	if d.After(today) {
		return Weight{}, invalid("a weigh-in cannot be in the future")
	}
	if err := checkWeight(weight, false); err != nil {
		return Weight{}, err
	}
	w := Weight{Day: day, Weight: round1(weight)}
	return w, s.store.SetWeight(ctx, userID, w)
}

// DeleteWeight removes a weigh-in.
func (s *Service) DeleteWeight(ctx context.Context, userID uuid.UUID, day string) error {
	if _, err := ParseDay(day); err != nil {
		return err
	}
	return s.store.DeleteWeight(ctx, userID, day)
}

// Stats reads the progress page: a year of workouts and weigh-ins.
func (s *Service) Stats(ctx context.Context, userID uuid.UUID) (*Stats, error) {
	today, err := s.today(ctx, userID)
	if err != nil {
		return nil, err
	}
	p, err := s.store.Profile(ctx, userID)
	if err != nil {
		return nil, err
	}
	from := today.AddDate(-1, 0, 1).Format(dayLayout)
	workouts, err := s.store.Workouts(ctx, userID, from, 1000)
	if err != nil {
		return nil, err
	}
	weights, err := s.store.Weights(ctx, userID, from)
	if err != nil {
		return nil, err
	}
	st := BuildStats(p, workouts, weights, today)
	return &st, nil
}
