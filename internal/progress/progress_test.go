package progress

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// days builds study days from offsets before today (0 is today), given
// largest first so the days come oldest first, as the store reads them.
func days(today time.Time, offsets ...int) []StudyDay {
	out := []StudyDay{}
	for _, o := range offsets {
		out = append(out, StudyDay{Day: today.AddDate(0, 0, -o), Counts: Counts{Reviews: 1}})
	}
	return out
}

// sunday is a Sunday, so its week runs Monday 8 to Sunday 14 (offsets 6 to 0).
var sunday = date(2026, 11, 15)

func TestTheStreakForgivesTheWeeksRestDays(t *testing.T) {
	cases := []struct {
		name    string
		offsets []int
		today   time.Time
		rest    int
		want    Streak
	}{
		{"nothing yet", nil, sunday, 1, Streak{RestLeft: 1}},
		{"today only", []int{0}, sunday, 1, Streak{Current: 1, Longest: 1, StudiedToday: true, RestLeft: 1}},
		{"yesterday, today not yet", []int{1}, sunday, 0, Streak{Current: 1, Longest: 1}},
		{"a day missed is a rest day", []int{4, 3, 1}, sunday, 1, Streak{Current: 3, Longest: 3, RestUsed: 1}},
		{"two days missed in one week end it", []int{4, 3, 0}, sunday, 1, Streak{Current: 1, Longest: 2, StudiedToday: true, RestLeft: 1}},
		{"no rest days", []int{3, 2, 0}, sunday, 0, Streak{Current: 1, Longest: 2, StudiedToday: true}},
		{"two rest days", []int{4, 3, 0}, sunday, 2, Streak{Current: 3, Longest: 3, StudiedToday: true, RestUsed: 2}},
		// Saturday 7 (offset 8) missed costs the week before, not this one.
		{"each week has its own", []int{9, 7, 6, 5, 3, 2, 1}, sunday, 1, Streak{Current: 7, Longest: 7, RestUsed: 1}},
		{"two missed yesterday and before", []int{3}, sunday, 1, Streak{RestLeft: 1, Longest: 1}},
	}
	for _, c := range cases {
		if got := streak(days(c.today, c.offsets...), c.today, c.rest); got != c.want {
			t.Errorf("%s: %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestTheWeeklyGoalCountsWeeksInARow(t *testing.T) {
	// Three days in each of the last three weeks, two so far this week.
	var offsets []int
	for w := 3; w >= 1; w-- {
		offsets = append(offsets, 7*w+1, 7*w+2, 7*w+3)
	}
	offsets = append(offsets, 1, 0)
	d := days(sunday, offsets...)
	got := week(d, sunday, 3)
	if got.Days != 2 || got.Met || got.InARow != 3 || got.Longest != 3 || got.Start != "2026-11-09" {
		t.Errorf("a week still going: %+v", got)
	}
	if got := week(d, sunday, 2); !got.Met || got.InARow != 4 {
		t.Errorf("this week met: %+v", got)
	}
	if got := week(d, sunday, 4); got.InARow != 0 || got.Longest != 0 {
		t.Errorf("never met: %+v", got)
	}
}

func TestLevelsAreStudyDays(t *testing.T) {
	for days, want := range map[int]Level{
		0:    {Level: 0, Days: 0, From: 0, Next: 1},
		1:    {Level: 1, Days: 1, From: 1, Next: 3},
		29:   {Level: 4, Days: 29, From: 14, Next: 30},
		1200: {Level: 14, Days: 1200, From: 1000, Next: 0},
	} {
		if got := LevelOf(days); got != want {
			t.Errorf("%d days: %+v, want %+v", days, got, want)
		}
	}
}

type fakeStore struct {
	zone      string
	set       Settings
	counted   time.Time
	refreshed time.Time
	refreshes int
	from      time.Time
	days      []StudyDay
	outcomes  Outcomes
	reached   map[string]time.Time
}

func (f *fakeStore) Settings(context.Context, uuid.UUID) (string, Settings, time.Time, time.Time, error) {
	return f.zone, f.set, f.counted, f.refreshed, nil
}
func (f *fakeStore) SetSettings(_ context.Context, _ uuid.UUID, s Settings) error {
	f.set = s
	return nil
}
func (f *fakeStore) RefreshDays(_ context.Context, _ uuid.UUID, _ string, from, today time.Time) error {
	f.from, f.counted = from, today
	f.refreshes++
	return nil
}
func (f *fakeStore) Days(context.Context, uuid.UUID) ([]StudyDay, error) { return f.days, nil }
func (f *fakeStore) Outcomes(context.Context, uuid.UUID, time.Time) (Outcomes, error) {
	return f.outcomes, nil
}
func (f *fakeStore) Reach(_ context.Context, _ uuid.UUID, r map[string]time.Time) (map[string]time.Time, error) {
	for k, d := range r {
		if _, ok := f.reached[k]; !ok {
			f.reached[k] = d
		}
	}
	return f.reached, nil
}

func TestTheSummaryRecountsFromYesterdayAndKeepsMilestones(t *testing.T) {
	// 23:30 on Sunday in Hanoi is still Sunday there, Sunday 16:30 in UTC.
	now := time.Date(2026, 11, 15, 16, 30, 0, 0, time.UTC)
	store := &fakeStore{zone: "Asia/Ho_Chi_Minh", set: Settings{WeekGoal: 3, RestDays: 1},
		counted: date(2026, 11, 14), reached: map[string]time.Time{},
		days: days(sunday, 8, 3, 2, 1, 0), outcomes: Outcomes{LongTerm: 12, Mastered: 0}}
	svc := NewService(store)
	svc.now = func() time.Time { return now }
	sum, err := svc.Summary(context.Background(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if !store.from.Equal(date(2026, 11, 13)) || sum.Today != "2026-11-15" {
		t.Errorf("recounted from %v; today %s", store.from, sum.Today)
	}
	if sum.Streak.Current != 4 || sum.Week.Days != 4 || !sum.Week.Met || sum.Level.Level != 2 || sum.Totals.Reviews != 5 {
		t.Errorf("summary: %+v %+v %+v", sum.Streak, sum.Week, sum.Level)
	}
	if len(sum.Calendar) != 5 || sum.Weeks[RecentWeeks-1].Days != 4 || sum.Weeks[RecentWeeks-2].Days != 1 {
		t.Errorf("calendar %v, weeks %v", sum.Calendar, sum.Weeks)
	}
	// Milestones the study days tell are dated the day they were reached;
	// long-term cards the day they were first seen.
	if store.reached["days:1"] != date(2026, 11, 7) || store.reached["longterm:10"] != sunday ||
		store.reached["streak:3"] != date(2026, 11, 14) || store.reached["reviews:100"] != (time.Time{}) {
		t.Errorf("reached: %v", store.reached)
	}
	// A milestone once reached stays, though the count fell back.
	store.outcomes.LongTerm = 3
	sum, _ = svc.Summary(context.Background(), uuid.New())
	var longTerm []Milestone
	for _, m := range sum.Milestones {
		if m.Kind == "long_term" {
			longTerm = append(longTerm, m)
		}
	}
	if len(longTerm) != 2 || longTerm[0].ReachedOn != "2026-11-15" || longTerm[1].Target != 100 || longTerm[1].ReachedOn != "" {
		t.Errorf("long-term milestones after a fall: %+v", longTerm)
	}
	if sum.Milestones[len(sum.Milestones)-1].ReachedOn != "" || sum.Milestones[0].ReachedOn == "" {
		t.Errorf("reached milestones come first: %+v", sum.Milestones)
	}

	// The first count reads everything.
	store.counted = time.Time{}
	_, _ = svc.Summary(context.Background(), uuid.New())
	if !store.from.IsZero() {
		t.Errorf("a first count began at %v", store.from)
	}
	// A brief takes a count of today made within its while, and counts
	// again after it.
	store.counted, store.refreshed, store.refreshes = sunday, now.Add(-30*time.Second), 0
	if b, _ := svc.Brief(context.Background(), uuid.New(), FreshForHome); store.refreshes != 0 || b.Streak != 4 || b.Level != 2 {
		t.Errorf("a fresh count was redone (%d) or misread: %+v", store.refreshes, b)
	}
	store.refreshed = now.Add(-2 * time.Minute)
	if _, _ = svc.Brief(context.Background(), uuid.New(), FreshForHome); store.refreshes != 1 {
		t.Errorf("a stale count was not redone")
	}
	store.counted, store.refreshed, store.refreshes = date(2026, 11, 14), now, 0
	if _, _ = svc.Brief(context.Background(), uuid.New(), FreshForCircle); store.refreshes != 1 {
		t.Errorf("yesterday's count was kept on a new day")
	}
	if err := svc.SetSettings(context.Background(), uuid.New(), Settings{WeekGoal: 8}); err == nil {
		t.Error("a goal of 8 days a week was accepted")
	}
}
