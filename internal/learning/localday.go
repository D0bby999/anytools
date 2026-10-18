package learning

import (
	"errors"
	"strings"
	"time"
	// The zone database ships inside the binary: a container image without
	// /usr/share/zoneinfo would otherwise refuse every learner's zone.
	_ "time/tzdata"
)

// localday.go is the one place any feature decides what "today" means.
//
// "Answered correctly again on a later day", "retest on the day it is due" and
// "consolidate at 02:00" are calendar facts in the LEARNER's zone. The
// database's CURRENT_DATE is the server's (UTC on the VPS), so a learner in
// Hanoi who answers at 06:30 and again at 07:30 would cross "midnight" between
// the two. Every phase computes days here, in Go, and passes dates to SQL.

// ErrUnknownZone is returned for a zone name Go's zone database does not know.
var ErrUnknownZone = errors.New("learning: unknown time zone")

// LoadZone validates an IANA zone name. "Local" and the empty name are refused:
// both mean "wherever the server happens to be", which is the bug this file
// exists to prevent.
func LoadZone(name string) (*time.Location, error) {
	name = strings.TrimSpace(name)
	if name == "" || name == "Local" || len(name) > 64 {
		return nil, ErrUnknownZone
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, ErrUnknownZone
	}
	return loc, nil
}

// Day is a calendar date in some zone, comparable with == and Before.
type Day struct {
	Year  int
	Month time.Month
	Day   int
}

// LocalDay is the calendar day t falls on in the named zone. An unknown zone
// falls back to UTC rather than failing: the name was validated when it was
// stored, and a zone later removed from tzdata must not break a review.
func LocalDay(t time.Time, zone string) Day {
	loc, err := LoadZone(zone)
	if err != nil {
		loc = time.UTC
	}
	y, m, d := t.In(loc).Date()
	return Day{Year: y, Month: m, Day: d}
}

// Before reports whether d is an earlier calendar day than o.
func (d Day) Before(o Day) bool {
	if d.Year != o.Year {
		return d.Year < o.Year
	}
	if d.Month != o.Month {
		return d.Month < o.Month
	}
	return d.Day < o.Day
}

// String is ISO 8601 (2026-09-27), the form SQL `date` parameters take.
func (d Day) String() string {
	return time.Date(d.Year, d.Month, d.Day, 0, 0, 0, 0, time.UTC).Format(time.DateOnly)
}

// StartOf is the instant day d begins in the named zone (midnight local time),
// for "everything since the start of today" queries.
func StartOf(d Day, zone string) time.Time {
	loc, err := LoadZone(zone)
	if err != nil {
		loc = time.UTC
	}
	return time.Date(d.Year, d.Month, d.Day, 0, 0, 0, 0, loc)
}
