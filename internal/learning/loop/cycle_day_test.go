package loop

import (
	"testing"
	"time"
)

// A cycle's day is counted on the learner's calendar (up methods, phase 10):
// "Close this cycle" appears from day 84 in Hanoi even while it is still the
// day before in UTC.
func TestCycleDayIsTheLearnersLocalDay(t *testing.T) {
	// 23:30 on 1 July in Hanoi (UTC+7): day 1 there, though UTC says 1 July 16:30.
	start := time.Date(2026, time.July, 1, 16, 30, 0, 0, time.UTC)
	cases := []struct {
		name string
		at   time.Time
		zone string
		want int
	}{
		{"the start", start, "Asia/Ho_Chi_Minh", 1},
		{"before the start", start.Add(-48 * time.Hour), "Asia/Ho_Chi_Minh", 1},
		// 00:10 on 2 July in Hanoi is day 2, an hour after the start.
		{"local midnight", start.Add(40 * time.Minute), "Asia/Ho_Chi_Minh", 2},
		{"the same hour in UTC", start.Add(40 * time.Minute), "UTC", 1},
		// 82 days later at 00:10 Hanoi: day 84 there, still day 83 in UTC.
		{"day 84 in Hanoi", start.Add(82*24*time.Hour + 40*time.Minute), "Asia/Ho_Chi_Minh", CloseFromDay},
		{"day 83 in UTC", start.Add(82*24*time.Hour + 40*time.Minute), "UTC", CloseFromDay - 1},
		{"day 90", start.Add(89 * 24 * time.Hour), "UTC", 90},
	}
	for _, tc := range cases {
		if got := CycleDay(start, tc.at, tc.zone); got != tc.want {
			t.Errorf("%s: day %d, want %d", tc.name, got, tc.want)
		}
	}
}
