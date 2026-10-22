// Package progress is what a learner has done and how steadily: study days,
// a streak that forgives rest days, a weekly goal, levels earned by study
// days, milestones, and the outcomes the studying produced
// (the private design notes).
//
// Every number is counted from real study (a review, an answer, a workout…)
// and the page links each to where it was earned. There are no points to
// collect: a level is a count of days studied, a milestone is a count
// reached.
package progress

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

// ErrInvalid is a setting out of range.
var ErrInvalid = errors.New("progress: invalid")

// Counts are a day's study, by kind.
type Counts struct {
	Reviews    int `json:"reviews"`
	Questions  int `json:"questions"`
	Explains   int `json:"explains"`
	Workouts   int `json:"workouts"`
	Recordings int `json:"recordings"`
	Highlights int `json:"highlights"`
	Skill      int `json:"skill"`
}

// Total is every kind together.
func (c Counts) Total() int {
	return c.Reviews + c.Questions + c.Explains + c.Workouts + c.Recordings + c.Highlights + c.Skill
}

func (c *Counts) add(o Counts) {
	c.Reviews += o.Reviews
	c.Questions += o.Questions
	c.Explains += o.Explains
	c.Workouts += o.Workouts
	c.Recordings += o.Recordings
	c.Highlights += o.Highlights
	c.Skill += o.Skill
}

// StudyDay is one local day with study.
type StudyDay struct {
	Day    time.Time // midnight UTC of the local date
	Counts Counts
}

// Settings are the learner's goal and rest days.
type Settings struct {
	WeekGoal int `json:"week_goal"`
	RestDays int `json:"rest_days"`
}

// Validate checks the ranges the database enforces too.
func (s Settings) Validate() error {
	if s.WeekGoal < 1 || s.WeekGoal > 7 {
		return fmt.Errorf("%w: week_goal must be 1 to 7", ErrInvalid)
	}
	if s.RestDays < 0 || s.RestDays > 2 {
		return fmt.Errorf("%w: rest_days must be 0 to 2", ErrInvalid)
	}
	return nil
}

// Outcomes are what the studying produced, read live.
type Outcomes struct {
	// LongTerm are cards with an FSRS stability of LongTermDays or more.
	LongTerm int `json:"long_term"`
	// Learning are the cards reviewed at least once and not suspended.
	Learning int `json:"learning"`
	// Mastered are knowledge points graduated.
	Mastered int `json:"mastered"`
	// ExplainsPassed are explain-backs judged passed.
	ExplainsPassed int `json:"explains_passed"`
	// Right and Answered are the reviews not forgotten and the questions
	// answered right, of all, in the last RecentDays days.
	Right    int `json:"right"`
	Answered int `json:"answered"`
}

// LongTermDays is the stability a card must reach to count as remembered
// for the long term (Anki calls an interval of 21 days "mature").
const LongTermDays = 21

// RecentDays is the window the share answered right is taken over.
const RecentDays = 30

// Store is what the service reads and keeps.
type Store interface {
	// Settings are the learner's zone, goal, the day study_days was last
	// counted through and when (zero before the first count).
	Settings(ctx context.Context, user uuid.UUID) (zone string, s Settings, countedOn, refreshedAt time.Time, err error)
	SetSettings(ctx context.Context, user uuid.UUID, s Settings) error
	// RefreshDays recounts study from the local day from (zero: all of it)
	// through today, in zone, and records today as counted.
	RefreshDays(ctx context.Context, user uuid.UUID, zone string, from, today time.Time) error
	// Days are every study day, oldest first.
	Days(ctx context.Context, user uuid.UUID) ([]StudyDay, error)
	Outcomes(ctx context.Context, user uuid.UUID, since time.Time) (Outcomes, error)
	// Reach records milestones not reached before, on the day given, and
	// returns every milestone reached with its day.
	Reach(ctx context.Context, user uuid.UUID, reached map[string]time.Time) (map[string]time.Time, error)
}

// Service answers progress.
type Service struct {
	store Store
	now   func() time.Time
}

// NewService builds a Service.
func NewService(store Store) *Service { return &Service{store: store, now: time.Now} }

// SetSettings stores the learner's goal and rest days.
func (s *Service) SetSettings(ctx context.Context, user uuid.UUID, set Settings) error {
	if err := set.Validate(); err != nil {
		return err
	}
	return s.store.SetSettings(ctx, user, set)
}

// How long a count stands before a read counts again: the progress page
// always counts; Home and the reminder take a count a minute old; a study
// circle, which reads every member, one ten minutes old.
const (
	FreshForHome   = time.Minute
	FreshForCircle = 10 * time.Minute
)

// days refreshes, unless it was counted today within fresh, and reads the
// learner's study days.
func (s *Service) days(ctx context.Context, user uuid.UUID, fresh time.Duration) (zone string, set Settings, today time.Time, days []StudyDay, err error) {
	zone, set, counted, refreshed, err := s.store.Settings(ctx, user)
	if err != nil {
		return "", Settings{}, time.Time{}, nil, err
	}
	now := s.now()
	l := learning.LocalDay(now, zone)
	today = date(l.Year, l.Month, l.Day)
	if fresh > 0 && counted.Equal(today) && now.Sub(refreshed) < fresh {
		days, err = s.store.Days(ctx, user)
		return zone, set, today, days, err
	}
	// Yesterday and today are counted again: a review made at 23:59 may be
	// committed after the count that ran at 00:00. Days before are kept as
	// counted, so deleting a deck does not unmake the days it was studied.
	var from time.Time
	if !counted.IsZero() {
		from = counted
		if from.After(today) {
			from = today // the zone moved west
		}
		from = from.AddDate(0, 0, -1)
	}
	if err := s.store.RefreshDays(ctx, user, zone, from, today); err != nil {
		return "", Settings{}, time.Time{}, nil, err
	}
	days, err = s.store.Days(ctx, user)
	return zone, set, today, days, err
}

func date(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

// weekStart is the Monday of d's week.
func weekStart(d time.Time) time.Time {
	return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
}

// Streak is the run of study days.
type Streak struct {
	Current      int  `json:"current"`
	Longest      int  `json:"longest"`
	StudiedToday bool `json:"studied_today"`
	// RestUsed are the days missed this week that the streak forgave.
	RestUsed int `json:"rest_used"`
	RestLeft int `json:"rest_left"`
}

// streak walks every day from the first study day through today. A missed
// day costs one of the week's rest days while a streak runs; one more than
// the week allows ends it. Today not studied yet costs nothing.
func streak(days []StudyDay, today time.Time, rest int) Streak {
	out, _ := walkStreak(days, today, rest)
	return out
}

// walkStreak is streak, and the day each length was first reached.
func walkStreak(days []StudyDay, today time.Time, rest int) (Streak, map[int]time.Time) {
	var out Streak
	first := map[int]time.Time{}
	if len(days) == 0 {
		out.RestLeft = rest
		return out, first
	}
	studied := make(map[time.Time]bool, len(days))
	for _, d := range days {
		studied[d.Day] = true
	}
	out.StudiedToday = studied[today]
	cur := 0
	missed := map[time.Time]int{}
	for d := days[0].Day; !d.After(today); d = d.AddDate(0, 0, 1) {
		if studied[d] {
			cur++
			out.Longest = max(out.Longest, cur)
			if _, ok := first[cur]; !ok {
				first[cur] = d
			}
			continue
		}
		if d.Equal(today) || cur == 0 {
			continue
		}
		w := weekStart(d)
		missed[w]++
		if missed[w] > rest {
			cur = 0
			missed = map[time.Time]int{}
		}
	}
	out.Current = cur
	if cur > 0 {
		out.RestUsed = missed[weekStart(today)]
	}
	out.RestLeft = rest - out.RestUsed
	return out, first
}

// Week is this week against the goal.
type Week struct {
	Start string `json:"start"`
	Days  int    `json:"days"`
	Goal  int    `json:"goal"`
	Met   bool   `json:"met"`
	// InARow are the weeks the goal was met running up to this one, and this
	// one once it is met. A week still going never ends the run.
	InARow  int `json:"in_a_row"`
	Longest int `json:"longest"`
}

func week(days []StudyDay, today time.Time, goal int) Week {
	out, _ := walkWeeks(days, today, goal)
	return out
}

// walkWeeks is week, and the day each run of weeks was first reached: the
// Sunday that closed the week, or today for this week.
func walkWeeks(days []StudyDay, today time.Time, goal int) (Week, map[int]time.Time) {
	this := weekStart(today)
	first := map[int]time.Time{}
	per := map[time.Time]int{}
	for _, d := range days {
		per[weekStart(d.Day)]++
	}
	out := Week{Start: this.Format(time.DateOnly), Days: per[this], Goal: goal, Met: per[this] >= goal}
	if len(days) == 0 {
		return out, first
	}
	run := 0
	for w := weekStart(days[0].Day); !w.After(this); w = w.AddDate(0, 0, 7) {
		switch {
		case per[w] >= goal:
			run++
			if _, ok := first[run]; !ok {
				closed := w.AddDate(0, 0, 6)
				if closed.After(today) {
					closed = today
				}
				first[run] = closed
			}
		case w.Equal(this):
		default:
			run = 0
		}
		out.Longest = max(out.Longest, run)
	}
	out.InARow = run
	return out, first
}

// LevelDays are the study days each level needs: level 1 at the first day.
var LevelDays = []int{1, 3, 7, 14, 30, 60, 100, 150, 200, 300, 365, 500, 730, 1000}

// Level is the learner's level by study days.
type Level struct {
	Level int `json:"level"`
	Days  int `json:"days"`
	// From is the days this level needed, Next the days the next one needs
	// (0 at the last level).
	From int `json:"from"`
	Next int `json:"next"`
}

// LevelOf is the level for a number of study days.
func LevelOf(days int) Level {
	out := Level{Days: days}
	for i, need := range LevelDays {
		if days >= need {
			out.Level, out.From = i+1, need
			continue
		}
		out.Next = need
		break
	}
	return out
}

// Milestone is a count to reach, and the day it was reached.
type Milestone struct {
	Kind   string `json:"kind"`
	Target int    `json:"target"`
	Value  int    `json:"value"`
	// ReachedOn is empty until it is reached.
	ReachedOn string `json:"reached_on,omitempty"`
}

// milestoneTargets are each kind's counts, smallest first.
var milestoneTargets = map[string][]int{
	"days":      {1, 7, 30, 100, 365, 1000},
	"streak":    {3, 7, 30, 100, 365},
	"weeks":     {4, 12, 26, 52},
	"long_term": {10, 100, 500, 1000, 5000},
	"mastered":  {1, 10, 50, 200},
	"reviews":   {100, 1000, 10000},
	"workouts":  {1, 10, 50, 100, 250},
}

// MilestoneKinds are the kinds in the order the page shows them.
var MilestoneKinds = []string{"days", "streak", "weeks", "long_term", "mastered", "reviews", "workouts"}

// DayCount is a day's total study.
type DayCount struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

// WeekTotal is one week's study.
type WeekTotal struct {
	Start string `json:"start"`
	Days  int    `json:"days"`
	Count Counts `json:"count"`
}

// Summary is the progress page.
type Summary struct {
	Today    string   `json:"today"`
	Settings Settings `json:"settings"`
	Streak   Streak   `json:"streak"`
	Week     Week     `json:"week"`
	Level    Level    `json:"level"`
	// Totals are every study day's counts added up.
	Totals     Counts      `json:"totals"`
	Outcomes   Outcomes    `json:"outcomes"`
	Milestones []Milestone `json:"milestones"`
	// Calendar are the study days of the last CalendarWeeks weeks.
	Calendar []DayCount `json:"calendar"`
	// Weeks are the last RecentWeeks weeks, oldest first.
	Weeks []WeekTotal `json:"weeks"`
	// FirstDay is the first study day; empty before any.
	FirstDay string `json:"first_day,omitempty"`
}

// CalendarWeeks and RecentWeeks are how far back the page looks.
const (
	CalendarWeeks = 53
	RecentWeeks   = 12
)

// Brief is what a study circle shows of a member: never what they study.
type Brief struct {
	Streak       int    `json:"streak"`
	StudiedToday bool   `json:"studied_today"`
	WeekDays     int    `json:"week_days"`
	WeekGoal     int    `json:"week_goal"`
	Level        int    `json:"level"`
	LastStudied  string `json:"last_studied,omitempty"`
}

// Brief is a learner's progress in short, from a count no older than fresh:
// what Home, the reminder and a study circle show.
func (s *Service) Brief(ctx context.Context, user uuid.UUID, fresh time.Duration) (Brief, error) {
	_, set, today, days, err := s.days(ctx, user, fresh)
	if err != nil {
		return Brief{}, err
	}
	st, wk := streak(days, today, set.RestDays), week(days, today, set.WeekGoal)
	out := Brief{Streak: st.Current, StudiedToday: st.StudiedToday, WeekDays: wk.Days, WeekGoal: set.WeekGoal, Level: LevelOf(len(days)).Level}
	if len(days) > 0 {
		out.LastStudied = days[len(days)-1].Day.Format(time.DateOnly)
	}
	return out, nil
}

// Summary counts the learner's progress, recording milestones newly reached.
func (s *Service) Summary(ctx context.Context, user uuid.UUID) (*Summary, error) {
	return s.SummaryWithin(ctx, user, 0)
}

// SummaryWithin is Summary from a count up to fresh old (zero: counted now).
// A public profile takes one ten minutes old, so its visitors cannot make the
// server count.
func (s *Service) SummaryWithin(ctx context.Context, user uuid.UUID, fresh time.Duration) (*Summary, error) {
	_, set, today, days, err := s.days(ctx, user, fresh)
	if err != nil {
		return nil, err
	}
	out := &Summary{
		Today:    today.Format(time.DateOnly),
		Settings: set,
		Streak:   streak(days, today, set.RestDays),
		Week:     week(days, today, set.WeekGoal),
		Level:    LevelOf(len(days)),
	}
	for _, d := range days {
		out.Totals.add(d.Counts)
	}
	if len(days) > 0 {
		out.FirstDay = days[0].Day.Format(time.DateOnly)
	}
	out.Outcomes, err = s.store.Outcomes(ctx, user, s.now().Add(-RecentDays*24*time.Hour))
	if err != nil {
		return nil, err
	}

	calendarFrom := weekStart(today).AddDate(0, 0, -7*(CalendarWeeks-1))
	recentFrom := weekStart(today).AddDate(0, 0, -7*(RecentWeeks-1))
	weeks := make([]WeekTotal, RecentWeeks)
	for i := range weeks {
		weeks[i].Start = recentFrom.AddDate(0, 0, 7*i).Format(time.DateOnly)
	}
	out.Calendar = []DayCount{}
	for _, d := range days {
		if !d.Day.Before(calendarFrom) {
			out.Calendar = append(out.Calendar, DayCount{Day: d.Day.Format(time.DateOnly), Count: d.Counts.Total()})
		}
		if !d.Day.Before(recentFrom) {
			w := &weeks[int(d.Day.Sub(recentFrom).Hours()/24)/7]
			w.Days++
			w.Count.add(d.Counts)
		}
	}
	out.Weeks = weeks

	out.Milestones, err = s.milestones(ctx, user, today, days, out)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// milestones records the counts reached and lists, for each kind, those
// reached and the next one.
func (s *Service) milestones(ctx context.Context, user uuid.UUID, today time.Time, days []StudyDay, sum *Summary) ([]Milestone, error) {
	values := map[string]int{
		"days":      len(days),
		"streak":    sum.Streak.Longest,
		"weeks":     sum.Week.Longest,
		"long_term": sum.Outcomes.LongTerm,
		"mastered":  sum.Outcomes.Mastered,
		"reviews":   sum.Totals.Reviews + sum.Totals.Questions,
		"workouts":  sum.Totals.Workouts,
	}
	// The day each was reached, from the study days where they tell it;
	// long-term cards and mastered points have no history, so the day they
	// are first seen.
	_, streakOn := walkStreak(days, today, sum.Settings.RestDays)
	_, weeksOn := walkWeeks(days, today, sum.Settings.WeekGoal)
	reachedOn := func(kind string, target int) time.Time {
		switch kind {
		case "days":
			return days[target-1].Day
		case "streak":
			return streakOn[target]
		case "weeks":
			return weeksOn[target]
		case "reviews", "workouts":
			total := 0
			for _, d := range days {
				if kind == "reviews" {
					total += d.Counts.Reviews + d.Counts.Questions
				} else {
					total += d.Counts.Workouts
				}
				if total >= target {
					return d.Day
				}
			}
		}
		return today
	}
	reached := map[string]time.Time{}
	for kind, targets := range milestoneTargets {
		for _, target := range targets {
			if values[kind] < target {
				break
			}
			reached[key(kind, target)] = reachedOn(kind, target)
		}
	}
	stored, err := s.store.Reach(ctx, user, reached)
	if err != nil {
		return nil, err
	}
	out := []Milestone{}
	for _, kind := range MilestoneKinds {
		for _, target := range milestoneTargets[kind] {
			m := Milestone{Kind: kind, Target: target, Value: values[kind]}
			if on, ok := stored[key(kind, target)]; ok {
				m.ReachedOn = on.Format(time.DateOnly)
				out = append(out, m)
				continue
			}
			out = append(out, m) // the next one to reach
			break
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ReachedOn != "" && out[j].ReachedOn == "" })
	return out, nil
}

func key(kind string, target int) string {
	k := kind
	if kind == "long_term" {
		k = "longterm"
	}
	return fmt.Sprintf("%s:%d", k, target)
}
