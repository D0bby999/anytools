// Package body is AnyLearn's training log: a weekly plan, guided workouts,
// body weight, and a coach that drafts and revises the plan on the learner's
// own model. Learning keeps the mind in shape; this keeps the body that
// carries it.
//
// The behaviour follows openGym (github.com/DuarteSantos8/openGym, and the
// AI Coach fork at github.com/alexpcosta/opengym). openGym is AGPL-3.0 and
// AnyTools is MIT, so none of its code is copied: the rules it documents
// (progression read honestly from what was logged, an estimate that refuses
// to guess above twelve reps, a coach whose answers are validated against
// the real library and applied only on the learner's say-so) are written
// again here, in Go.
//
// The exercise library is the text of hasaneyldrm/exercises-dataset (MIT).
// Its images and animations are © Gym visual and are not used.
package body

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Units. Every weight is stored in the learner's unit; switching converts
// the stored values (Service.SaveProfile), so a number never changes meaning.
const (
	UnitKg = "kg"
	UnitLb = "lb"
)

// KgPerLb converts pounds to kilograms.
const KgPerLb = 0.45359237

// Logging modes: weight × reps, a hold measured in seconds, or cardio as
// minutes at a speed.
const (
	ModeReps   = "reps"
	ModeTime   = "time"
	ModeCardio = "cardio"
)

// Progression policies. A routine sets a default; an exercise may override it.
const (
	PolicyOff    = "off"
	PolicyLinear = "linear"
	PolicyDouble = "double"
	PolicyTime   = "time"
)

// Limits on what a plan holds. The coach's answers are held to the same ones.
const (
	MaxRoutines            = 7
	MaxExercisesPerRoutine = 15
	MaxSets                = 10
	MaxReps                = 100
	MinSec, MaxSec         = 5, 3600
	MaxName                = 60
	MaxWhy                 = 400
	MaxNote                = 1000
	MaxWeight              = 1000.0
	MaxEntries             = 30
	MaxSetsLogged          = 20
)

var (
	// ErrNotFound covers "not yours" and "does not exist" alike.
	ErrNotFound = errors.New("body: not found")
	// ErrInvalid is a request the learner can fix; its text reaches them.
	ErrInvalid = errors.New("body: invalid")
	// ErrConflict is a state that forbids the request (a proposal already
	// decided, a revert that is no longer the latest).
	ErrConflict = errors.New("body: conflict")
	// ErrCoachFailed is a model answer that failed validation twice.
	ErrCoachFailed = errors.New("body: the coach's answer could not be used")
)

// Profile is the learner's settings for this part of the app.
type Profile struct {
	Unit       string   `json:"unit"`
	GoalWeight *float64 `json:"goal_weight"`
	// RestSec is the rest timer's default between sets.
	RestSec int `json:"rest_sec"`
	// Intake is the coach's last intake, so the form opens filled in.
	Intake *Intake `json:"intake"`
}

// DefaultProfile is a learner who has never opened Body.
func DefaultProfile() Profile { return Profile{Unit: UnitKg, RestSec: 90} }

// PlanExercise is one exercise of a routine, and the target a workout entry
// was built from.
type PlanExercise struct {
	Exercise string  `json:"exercise"`
	Mode     string  `json:"mode"`
	Sets     int     `json:"sets"`
	Reps     int     `json:"reps,omitempty"`
	RepsMin  int     `json:"reps_min,omitempty"`
	Sec      int     `json:"sec,omitempty"`
	Min      float64 `json:"min,omitempty"`
	Speed    float64 `json:"speed,omitempty"`
	Weight   float64 `json:"weight,omitempty"`
	Prog     string  `json:"prog,omitempty"`
	Inc      float64 `json:"inc,omitempty"`
	// Why is the coach's reason for this exercise, when it chose it.
	Why string `json:"why,omitempty"`
}

// Routine is one training day's list.
type Routine struct {
	ID        uuid.UUID      `json:"id"`
	UserID    uuid.UUID      `json:"-"`
	Name      string         `json:"name"`
	Prog      string         `json:"prog"`
	Why       string         `json:"why,omitempty"`
	Exercises []PlanExercise `json:"exercises"`
	Position  int            `json:"position"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

// Week maps a weekday (0 = Sunday … 6 = Saturday, as time.Weekday) to the
// routine trained that day; nil is a rest day.
type Week [7]*uuid.UUID

// Set is one logged set. Only the fields of its entry's mode carry meaning.
type Set struct {
	Weight float64 `json:"weight"`
	Reps   int     `json:"reps"`
	Sec    int     `json:"sec,omitempty"`
	Min    float64 `json:"min,omitempty"`
	Speed  float64 `json:"speed,omitempty"`
	Done   bool    `json:"done"`
}

// Entry is one exercise in a workout: the target it started from, the advice
// that set it, and what happened.
type Entry struct {
	Exercise string        `json:"exercise"`
	Target   PlanExercise  `json:"target"`
	Advice   *Prescription `json:"advice,omitempty"`
	Sets     []Set         `json:"sets"`
}

// Workout is one session, open until it is finished.
type Workout struct {
	ID          uuid.UUID  `json:"id"`
	UserID      uuid.UUID  `json:"-"`
	RoutineID   *uuid.UUID `json:"routine_id"`
	RoutineName string     `json:"routine_name"`
	// Day is the learner's calendar day the workout was started on.
	Day        string     `json:"day"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
	Bodyweight *float64   `json:"bodyweight"`
	Entries    []Entry    `json:"entries"`
	Note       string     `json:"note"`
}

// Minutes is how long a finished workout ran, capped so a session left open
// overnight does not count as a day of training.
func (w Workout) Minutes() int {
	if w.FinishedAt == nil {
		return 0
	}
	m := int(w.FinishedAt.Sub(w.StartedAt).Minutes())
	return max(0, min(m, 240))
}

// Weight is one weigh-in, at most one per day.
type Weight struct {
	Day    string  `json:"day"`
	Weight float64 `json:"weight"`
}

// dayLayout is how a calendar day travels: 2026-10-19.
const dayLayout = "2006-01-02"

// ParseDay validates a calendar day.
func ParseDay(s string) (time.Time, error) {
	d, err := time.Parse(dayLayout, s)
	if err != nil {
		return time.Time{}, invalid("a day is written YYYY-MM-DD")
	}
	return d, nil
}

func invalid(msg string) error { return &invalidError{msg} }

type invalidError struct{ msg string }

func (e *invalidError) Error() string { return "body: invalid: " + e.msg }
func (e *invalidError) Unwrap() error { return ErrInvalid }
