package body

import (
	"math"
	"slices"
	"time"
)

// RepCap is where an estimated one-rep max stops being honest: above twelve
// reps a set says more about work capacity than maximal strength, and the
// formulas disagree by double digits. Refusing beats printing a fantasy.
const RepCap = 12

// Estimate1RM is Epley's estimate (w · (1 + r/30)) for one set, or 0 when it
// cannot honestly answer. A single rep is the measurement, not an estimate.
func Estimate1RM(weight float64, reps int) float64 {
	if weight <= 0 || reps < 1 || reps > RepCap || math.IsNaN(weight) || math.IsInf(weight, 0) {
		return 0
	}
	if reps == 1 {
		return round1(weight)
	}
	return round1(weight * (1 + float64(reps)/30))
}

// BestSet is the set behind an estimate: "142.5 from 100 × 10" is a very
// different claim from "142.5 from 140 × 1".
type BestSet struct {
	E1RM   float64 `json:"e1rm"`
	Weight float64 `json:"weight"`
	Reps   int     `json:"reps"`
	Day    string  `json:"day,omitempty"`
}

// BestOf is the best estimate among an entry's done sets, or nil.
func BestOf(e Entry) *BestSet {
	if e.Target.Mode != ModeReps {
		return nil
	}
	var best *BestSet
	for _, s := range e.Sets {
		if !s.Done {
			continue
		}
		if est := Estimate1RM(s.Weight, s.Reps); est > 0 && (best == nil || est > best.E1RM) {
			best = &BestSet{E1RM: est, Weight: s.Weight, Reps: s.Reps}
		}
	}
	return best
}

// Record is a new best set on finishing a workout.
type Record struct {
	Exercise string  `json:"exercise"`
	Name     string  `json:"name"`
	E1RM     float64 `json:"e1rm"`
	Weight   float64 `json:"weight"`
	Reps     int     `json:"reps"`
	Previous float64 `json:"previous"`
}

// Records compares a workout against everything before it. An exercise's
// first session sets its starting point, not a record: calling every lift of
// a first workout a "new best" says nothing.
func Records(w Workout, before []Workout) []Record {
	var out []Record
	for _, e := range w.Entries {
		now := BestOf(e)
		if now == nil {
			continue
		}
		prev := 0.0
		for _, old := range before {
			for _, oe := range old.Entries {
				if oe.Exercise == e.Exercise {
					if b := BestOf(oe); b != nil {
						prev = max(prev, b.E1RM)
					}
				}
			}
		}
		if prev > 0 && now.E1RM > prev {
			ex, _ := Lookup(e.Exercise)
			out = append(out, Record{Exercise: e.Exercise, Name: ex.Name, E1RM: now.E1RM, Weight: now.Weight, Reps: now.Reps, Previous: prev})
		}
	}
	return out
}

// Stats is the progress page.
type Stats struct {
	Unit       string          `json:"unit"`
	GoalWeight *float64        `json:"goal_weight"`
	Workouts   int             `json:"workouts"`
	ThisWeek   int             `json:"this_week"`
	Minutes    int             `json:"minutes"`
	Heatmap    []HeatDay       `json:"heatmap"`
	Weights    []Weight        `json:"weights"`
	Exercises  []ExerciseTrend `json:"exercises"`
	Coverage   []Coverage      `json:"coverage"`
}

// HeatDay is one trained day: minutes and workouts.
type HeatDay struct {
	Day      string `json:"day"`
	Minutes  int    `json:"minutes"`
	Workouts int    `json:"workouts"`
}

// ExerciseTrend is one lift's estimate over time.
type ExerciseTrend struct {
	Exercise string    `json:"exercise"`
	Name     string    `json:"name"`
	Sessions int       `json:"sessions"`
	Best     *BestSet  `json:"best"`
	Series   []BestSet `json:"series"`
}

// Coverage is the sets a muscle group got in the last 7 and 30 days. A set
// counts once for the exercise's target muscle and half for each secondary
// one, the usual convention: a squat targets the glutes in the library, and
// leaving the quads at zero after squatting read as a fault.
type Coverage struct {
	Group string  `json:"group"`
	Week  float64 `json:"week"`
	Month float64 `json:"month"`
}

// BuildStats reads a year of finished workouts (oldest first) and weigh-ins.
// today is the learner's calendar day.
func BuildStats(p Profile, workouts []Workout, weights []Weight, today time.Time) Stats {
	st := Stats{Unit: p.Unit, GoalWeight: p.GoalWeight, Weights: weights}
	if st.Weights == nil {
		st.Weights = []Weight{}
	}
	weekStart := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7)) // Monday
	week, month := today.AddDate(0, 0, -6), today.AddDate(0, 0, -29)

	heat := map[string]*HeatDay{}
	var days []string
	trends := map[string]*ExerciseTrend{}
	var order []string
	cov := map[string]*Coverage{}
	for _, g := range MuscleGroups {
		cov[g] = &Coverage{Group: g}
	}

	for _, w := range workouts {
		if w.FinishedAt == nil {
			continue
		}
		day, err := time.Parse(dayLayout, w.Day)
		if err != nil {
			continue
		}
		st.Workouts++
		st.Minutes += w.Minutes()
		if !day.Before(weekStart) {
			st.ThisWeek++
		}
		h := heat[w.Day]
		if h == nil {
			h = &HeatDay{Day: w.Day}
			heat[w.Day] = h
			days = append(days, w.Day)
		}
		h.Minutes += w.Minutes()
		h.Workouts++

		for _, e := range w.Entries {
			if !e.Performed() {
				continue
			}
			done := 0
			for _, s := range e.Sets {
				if s.Done {
					done++
				}
			}
			for group, share := range GroupShares(e.Exercise) {
				c := cov[group]
				if c == nil {
					continue
				}
				if !day.Before(week) {
					c.Week += share * float64(done)
				}
				if !day.Before(month) {
					c.Month += share * float64(done)
				}
			}
			tr := trends[e.Exercise]
			if tr == nil {
				ex, _ := Lookup(e.Exercise)
				tr = &ExerciseTrend{Exercise: e.Exercise, Name: ex.Name, Series: []BestSet{}}
				trends[e.Exercise] = tr
				order = append(order, e.Exercise)
			}
			tr.Sessions++
			if b := BestOf(e); b != nil {
				b.Day = w.Day
				tr.Series = append(tr.Series, *b)
				if tr.Best == nil || b.E1RM > tr.Best.E1RM {
					best := *b
					tr.Best = &best
				}
			}
		}
	}

	slices.Sort(days)
	st.Heatmap = make([]HeatDay, 0, len(days))
	for _, d := range days {
		st.Heatmap = append(st.Heatmap, *heat[d])
	}
	st.Exercises = make([]ExerciseTrend, 0, len(order))
	for _, id := range order {
		st.Exercises = append(st.Exercises, *trends[id])
	}
	// Most trained first: the lifts the learner actually cares about.
	slices.SortStableFunc(st.Exercises, func(a, b ExerciseTrend) int { return b.Sessions - a.Sessions })
	for _, g := range MuscleGroups {
		st.Coverage = append(st.Coverage, *cov[g])
	}
	return st
}
