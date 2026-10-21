// Package calendar is the learner's study calendar (learning-tool-connections
// phases 2 and 3): the review hour, the Loop's weekly reviews and cycle ends,
// and the training days, as events. Phase 2 serves them as an iCalendar feed
// any calendar app can subscribe to; phase 3 writes the same events into a
// Google calendar of AnyLearn's own.
package calendar

import (
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf8"
)

// ics.go — RFC 5545, written by hand. The format is small and every rule it
// has is one this file has to get right anyway: CRLF line ends, lines folded
// at 75 octets without splitting a UTF-8 character, and text escaped (`\`,
// `;`, `,`, newlines). A library would add a dependency for forty lines.

// Event is one calendar entry. Exactly one of At (a timed event) or Day (an
// all-day event) is set.
type Event struct {
	UID         string
	Summary     string
	Description string
	URL         string

	// At is a timed start in the learner's zone; Duration its length.
	At       time.Time
	Duration time.Duration
	// Day is an all-day start (its date, in the learner's zone).
	Day time.Time

	// RRule is a recurrence rule without the "RRULE:" prefix, e.g.
	// "FREQ=WEEKLY;COUNT=12". Empty for a single event.
	RRule string
	// Alarm adds a display alarm at the start.
	Alarm bool
}

// Calendar is a whole feed.
type Calendar struct {
	Name string
	// Zone is an IANA zone name; timed events are written in it.
	Zone string
	// Stamp is DTSTAMP for every event: when the feed was produced.
	Stamp  time.Time
	Events []Event
}

// WriteICS writes the calendar as text/calendar.
//
// Timed events carry TZID=<IANA name> without a VTIMEZONE block. Google
// Calendar, Apple Calendar and Outlook resolve IANA names themselves, and a
// VTIMEZONE generated from Go's zone database would have to describe every
// rule change the recurrence might cross; the zone name is the more correct
// statement of what is meant.
func WriteICS(w io.Writer, cal Calendar) error {
	lw := &lineWriter{w: w}
	lw.line("BEGIN:VCALENDAR")
	lw.line("VERSION:2.0")
	lw.line("PRODID:-//AnyLearn//Study calendar//EN")
	lw.line("CALSCALE:GREGORIAN")
	lw.line("METHOD:PUBLISH")
	lw.prop("X-WR-CALNAME", cal.Name)
	lw.line("X-WR-TIMEZONE:" + cal.Zone)
	// A hint, honoured by Apple and Outlook; Google decides on its own.
	lw.line("REFRESH-INTERVAL;VALUE=DURATION:PT6H")
	lw.line("X-PUBLISHED-TTL:PT6H")
	stamp := cal.Stamp.UTC().Format("20060102T150405Z")
	for _, e := range cal.Events {
		lw.line("BEGIN:VEVENT")
		lw.line("UID:" + e.UID)
		lw.line("DTSTAMP:" + stamp)
		if e.Day.IsZero() {
			lw.line(fmt.Sprintf("DTSTART;TZID=%s:%s", cal.Zone, e.At.Format("20060102T150405")))
			lw.line("DURATION:" + isoDuration(e.Duration))
		} else {
			lw.line("DTSTART;VALUE=DATE:" + e.Day.Format("20060102"))
			lw.line("DTEND;VALUE=DATE:" + e.Day.AddDate(0, 0, 1).Format("20060102"))
			lw.line("TRANSP:TRANSPARENT")
		}
		if e.RRule != "" {
			lw.line("RRULE:" + e.RRule)
		}
		lw.prop("SUMMARY", e.Summary)
		if e.Description != "" {
			lw.prop("DESCRIPTION", e.Description)
		}
		if e.URL != "" {
			lw.line("URL:" + e.URL)
		}
		if e.Alarm {
			lw.line("BEGIN:VALARM")
			lw.line("ACTION:DISPLAY")
			lw.prop("DESCRIPTION", e.Summary)
			lw.line("TRIGGER:PT0M")
			lw.line("END:VALARM")
		}
		lw.line("END:VEVENT")
	}
	lw.line("END:VCALENDAR")
	return lw.err
}

// isoDuration writes a duration as an RFC 5545 dur-time, e.g. PT20M.
func isoDuration(d time.Duration) string {
	if d <= 0 {
		d = 30 * time.Minute
	}
	h := int(d / time.Hour)
	m := int((d % time.Hour) / time.Minute)
	out := "PT"
	if h > 0 {
		out += fmt.Sprintf("%dH", h)
	}
	if m > 0 || h == 0 {
		out += fmt.Sprintf("%dM", m)
	}
	return out
}

// escapeText escapes a TEXT value (RFC 5545 §3.3.11).
func escapeText(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	r := strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\n", `\n`, "\r", "")
	return r.Replace(s)
}

type lineWriter struct {
	w   io.Writer
	err error
}

func (l *lineWriter) prop(name, text string) { l.line(name + ":" + escapeText(text)) }

// line writes one content line, folded at 75 octets (§3.1): each
// continuation starts with a space, and no UTF-8 character is split.
func (l *lineWriter) line(s string) {
	if l.err != nil {
		return
	}
	var b strings.Builder
	limit := 75
	for len(s) > limit {
		cut := limit
		for cut > 0 && !utf8.RuneStart(s[cut]) {
			cut--
		}
		b.WriteString(s[:cut])
		b.WriteString("\r\n ")
		s = s[cut:]
		limit = 74 // the leading space counts
	}
	b.WriteString(s)
	b.WriteString("\r\n")
	_, l.err = io.WriteString(l.w, b.String())
}
