package calendar

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// events.go — what goes into the calendar, shared by the feed (phase 2) and
// the Google Calendar writer (phase 3).

// CycleLength is a Loop cycle's length in days.
const CycleLength = 90

// Source is everything the events are built from, for one learner.
type Source struct {
	UserID   uuid.UUID
	Zone     string
	Language string
	// ReminderHour is the learner's local review hour (Settings → Reminders).
	ReminderHour int
	// Since is the first day of the daily review series, so its DTSTART
	// stays the same on every refresh.
	Since time.Time

	Cycles   []Cycle
	Training []TrainingDay

	Include Include
	// Named puts goals and routine names in titles; off, the titles are
	// generic, so a feed URL that leaks says nothing about the learner.
	Named bool

	AppURL string
}

// Include picks the kinds of events.
type Include struct {
	Review bool `json:"review"`
	Loop   bool `json:"loop"`
	Body   bool `json:"body"`
}

// Cycle is a Loop cycle, current or recent.
type Cycle struct {
	ID        uuid.UUID
	Goal      string
	StartedAt time.Time
}

// TrainingDay is one weekday of the training week (0 = Sunday).
type TrainingDay struct {
	Weekday int
	Routine string
}

var byDay = [7]string{"SU", "MO", "TU", "WE", "TH", "FR", "SA"}

// Location resolves a zone name, falling back to UTC.
func Location(zone string) *time.Location {
	if loc, err := time.LoadLocation(zone); err == nil && zone != "" {
		return loc
	}
	return time.UTC
}

// Build lists the learner's events as of now.
func Build(src Source, now time.Time) []Event {
	loc := Location(src.Zone)
	words := wordsFor(src.Language)
	today := dateIn(now, loc)
	var out []Event

	if src.Include.Review {
		since := dateIn(src.Since, loc)
		if since.IsZero() || since.After(today) {
			since = today
		}
		hour := src.ReminderHour
		if hour < 0 || hour > 23 {
			hour = 7
		}
		out = append(out, Event{
			UID:         fmt.Sprintf("review-%s@anytools.world", src.UserID),
			Summary:     words.review,
			Description: words.reviewBody + "\n" + src.AppURL + "/mastery/review",
			URL:         src.AppURL + "/mastery/review",
			At:          time.Date(since.Year(), since.Month(), since.Day(), hour, 0, 0, 0, loc),
			Duration:    20 * time.Minute,
			RRule:       "FREQ=DAILY",
			Alarm:       true,
		})
	}

	if src.Include.Loop {
		for _, c := range src.Cycles {
			start := dateIn(c.StartedAt, loc)
			end := start.AddDate(0, 0, CycleLength-1)
			if end.Before(today) {
				continue
			}
			link := fmt.Sprintf("%s/loop/cycle/%s", src.AppURL, c.ID)
			weekly, closing := words.weekly, words.cycleEnd
			if src.Named && c.Goal != "" {
				goal := clip(c.Goal, 60)
				weekly, closing = words.weekly+": "+goal, words.cycleEnd+": "+goal
			}
			out = append(out,
				Event{
					UID:         fmt.Sprintf("weekly-%s@anytools.world", c.ID),
					Summary:     weekly,
					Description: words.weeklyBody + "\n" + link,
					URL:         link,
					Day:         start.AddDate(0, 0, 7),
					// Weeks 1 to 12; the thirteenth is the close.
					RRule: "FREQ=WEEKLY;COUNT=12",
				},
				Event{
					UID:         fmt.Sprintf("cycle-end-%s@anytools.world", c.ID),
					Summary:     closing,
					Description: words.cycleEndBody + "\n" + link,
					URL:         link,
					Day:         end,
				},
			)
		}
	}

	if src.Include.Body {
		for _, d := range src.Training {
			if d.Weekday < 0 || d.Weekday > 6 {
				continue
			}
			first := today.AddDate(0, 0, (d.Weekday-int(today.Weekday())+7)%7)
			title := words.training
			if src.Named && d.Routine != "" {
				title = words.training + ": " + clip(d.Routine, 60)
			}
			out = append(out, Event{
				UID:         fmt.Sprintf("training-%s-%d@anytools.world", src.UserID, d.Weekday),
				Summary:     title,
				Description: src.AppURL + "/body",
				URL:         src.AppURL + "/body",
				Day:         first,
				RRule:       "FREQ=WEEKLY;BYDAY=" + byDay[d.Weekday],
			})
		}
	}
	return out
}

// ReviewTitle is today's review with how much is due (phase 3).
func ReviewTitle(language string, due int) string {
	return fmt.Sprintf(wordsFor(language).reviewDue, due)
}

// Name is the calendar's own name in the learner's language.
func Name(language string) string { return wordsFor(language).name }

// dateIn is t's calendar date in loc, at midnight there.
func dateIn(t time.Time, loc *time.Location) time.Time {
	if t.IsZero() {
		return time.Time{}
	}
	t = t.In(loc)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
}

func clip(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}

type words struct {
	name, review, reviewBody, weekly, weeklyBody, cycleEnd, cycleEndBody, training string
	// reviewDue titles today's review with its count (phase 3), e.g.
	// "AnyLearn: review, %d due".
	reviewDue string
}

var wordsByLanguage = map[string]words{
	"en": {
		name: "AnyLearn", review: "AnyLearn: review", reviewBody: "Open what is due today.",
		weekly: "AnyLearn: weekly review", weeklyBody: "Score this week of your cycle.",
		cycleEnd: "AnyLearn: cycle ends", cycleEndBody: "Day 90. Review the cycle and decide what comes next.",
		training: "AnyLearn: training", reviewDue: "AnyLearn: review, %d due",
	},
	"vi": {
		name: "AnyLearn", review: "AnyLearn: ôn tập", reviewBody: "Mở những gì đến hạn hôm nay.",
		weekly: "AnyLearn: xem lại tuần", weeklyBody: "Chấm điểm tuần này của chu kỳ.",
		cycleEnd: "AnyLearn: hết chu kỳ", cycleEndBody: "Ngày 90. Xem lại chu kỳ và quyết định bước tiếp theo.",
		training: "AnyLearn: buổi tập", reviewDue: "AnyLearn: ôn %d mục đến hạn",
	},
	"es": {
		name: "AnyLearn", review: "AnyLearn: repaso", reviewBody: "Abre lo que vence hoy.",
		weekly: "AnyLearn: revisión semanal", weeklyBody: "Puntúa esta semana de tu ciclo.",
		cycleEnd: "AnyLearn: fin del ciclo", cycleEndBody: "Día 90. Revisa el ciclo y decide qué sigue.",
		training: "AnyLearn: entrenamiento", reviewDue: "AnyLearn: repaso, %d pendientes",
	},
	"pt": {
		name: "AnyLearn", review: "AnyLearn: revisão", reviewBody: "Abra o que vence hoje.",
		weekly: "AnyLearn: revisão semanal", weeklyBody: "Pontue esta semana do seu ciclo.",
		cycleEnd: "AnyLearn: fim do ciclo", cycleEndBody: "Dia 90. Revise o ciclo e decida o que vem a seguir.",
		training: "AnyLearn: treino", reviewDue: "AnyLearn: revisão, %d pendentes",
	},
}

func wordsFor(language string) words {
	if w, ok := wordsByLanguage[language]; ok {
		return w
	}
	return wordsByLanguage["en"]
}
