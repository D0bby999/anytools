package worksheet

import (
	"time"

	"github.com/D0bby999/anytools/internal/learning"
)

// reviews.go counts a worksheet's review dates from their anchors, on the
// learner's local day (learning.LocalDay).
//
// up counts its reviews from events, not from when a page was copied: three
// to seven days after DELIVERY, Day 7 after the FIRST PASS, the review date a
// choice brief WRITES DOWN. A kind names the anchor (Review.From) and the
// engine schedules the review the day that anchor is filled. Until then it
// is absent from Worksheet.Reviews, which the UI shows as "not scheduled".

// addDays is d moved by n calendar days, as YYYY-MM-DD.
func addDays(d learning.Day, n int) string {
	return time.Date(d.Year, d.Month, d.Day, 0, 0, 0, 0, time.UTC).AddDate(0, 0, n).Format(time.DateOnly)
}

// parseDay reads YYYY-MM-DD.
func parseDay(s string) (learning.Day, bool) {
	t, err := time.Parse(time.DateOnly, s)
	if err != nil {
		return learning.Day{}, false
	}
	y, m, d := t.Date()
	return learning.Day{Year: y, Month: m, Day: d}, true
}

// schedule brings reviews up to date with the answers. created is the local
// day the worksheet was created, today the local day of this write.
//
//   - A creation-anchored review is set once.
//   - A review counted from a date field follows that date: writing a new
//     date reschedules it, clearing the date unschedules it.
//   - A review counted from the first fill of a field is set the first time
//     the field holds anything, from today, and never moves on its own.
//
// A date the learner moved (Due later than Earliest) is kept unless its
// anchor itself changed.
func schedule(k *Kind, a Answers, reviews map[string]ReviewDate, created, today learning.Day) {
	for _, r := range k.Reviews {
		current, has := reviews[r.Key]
		switch {
		case r.From.IsCreation():
			if !has {
				d := addDays(created, r.Days)
				reviews[r.Key] = ReviewDate{Due: d, Earliest: d}
			}
		case k.anchorField(r.From).Type == Date:
			value, _ := anchorValue(a, r.From).(string)
			day, ok := parseDay(value)
			if !ok {
				delete(reviews, r.Key)
				continue
			}
			if d := addDays(day, r.Days); !has || current.Earliest != d {
				reviews[r.Key] = ReviewDate{Due: d, Earliest: d}
			}
		default:
			if !has && filled(anchorValue(a, r.From)) {
				d := addDays(today, r.Days)
				reviews[r.Key] = ReviewDate{Due: d, Earliest: d}
			}
		}
	}
}

// anchorValue is what an anchor's field, or its table cell, holds.
func anchorValue(a Answers, from Anchor) any {
	v := a[from.Section][from.Field]
	if from.Row == "" {
		return v
	}
	return rowCells(v, from.Row)[from.Column]
}

// isDue reports whether a scheduled review's date has come on day today.
func (r ReviewDate) isDue(today learning.Day) bool {
	due, ok := parseDay(r.Due)
	return ok && !today.Before(due)
}
