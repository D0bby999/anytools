package calendar

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

func TestWriteICS_FoldsEscapesAndEndsLinesWithCRLF(t *testing.T) {
	var buf bytes.Buffer
	long := strings.Repeat("Ôn tập, từ vựng; ", 12)
	err := WriteICS(&buf, Calendar{
		Name: "AnyLearn", Zone: "Asia/Ho_Chi_Minh", Stamp: time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC),
		Events: []Event{{
			UID: "x@anytools.world", Summary: long, Description: "line one\nline two\\",
			At: time.Date(2026, 10, 21, 7, 0, 0, 0, Location("Asia/Ho_Chi_Minh")), Duration: 20 * time.Minute,
			RRule: "FREQ=DAILY", Alarm: true,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if strings.Contains(strings.ReplaceAll(out, "\r\n", ""), "\n") {
		t.Fatal("a bare LF: every line must end CRLF")
	}
	for _, line := range strings.Split(strings.TrimSuffix(out, "\r\n"), "\r\n") {
		if len(line) > 75 {
			t.Fatalf("line of %d octets: %q", len(line), line)
		}
		if !utf8.ValidString(line) {
			t.Fatalf("a fold split a character: %q", line)
		}
	}
	unfolded := strings.ReplaceAll(out, "\r\n ", "")
	for _, want := range []string{
		"DTSTART;TZID=Asia/Ho_Chi_Minh:20261021T070000",
		"DURATION:PT20M",
		"RRULE:FREQ=DAILY",
		`DESCRIPTION:line one\nline two\\`,
		`SUMMARY:Ôn tập\, từ vựng\; `,
		"BEGIN:VALARM",
		"DTSTAMP:20261021T120000Z",
	} {
		if !strings.Contains(unfolded, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestWriteICS_AllDayEvent(t *testing.T) {
	var buf bytes.Buffer
	day := time.Date(2026, 12, 31, 0, 0, 0, 0, time.UTC)
	_ = WriteICS(&buf, Calendar{Zone: "UTC", Events: []Event{{UID: "d", Summary: "s", Day: day}}})
	out := buf.String()
	if !strings.Contains(out, "DTSTART;VALUE=DATE:20261231\r\n") || !strings.Contains(out, "DTEND;VALUE=DATE:20270101\r\n") {
		t.Fatal(out)
	}
}

func TestIsoDuration(t *testing.T) {
	for d, want := range map[time.Duration]string{
		20 * time.Minute: "PT20M", time.Hour: "PT1H", 90 * time.Minute: "PT1H30M", 0: "PT30M",
	} {
		if got := isoDuration(d); got != want {
			t.Errorf("%v: %s, want %s", d, got, want)
		}
	}
}

func source() Source {
	user := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	return Source{
		UserID: user, Zone: "Asia/Ho_Chi_Minh", Language: "vi", ReminderHour: 20,
		Since: time.Date(2026, 10, 1, 3, 0, 0, 0, time.UTC),
		Cycles: []Cycle{
			{ID: uuid.MustParse("22222222-2222-2222-2222-222222222222"), Goal: "IELTS writing band 7", StartedAt: time.Date(2026, 10, 5, 2, 0, 0, 0, time.UTC)},
			// Ended in the summer: no events.
			{ID: uuid.New(), Goal: "old", StartedAt: time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)},
		},
		Training: []TrainingDay{{Weekday: 1, Routine: "Push"}, {Weekday: 4, Routine: "Pull"}},
		Include:  Include{Review: true, Loop: true, Body: true},
		AppURL:   "https://anytools.world",
	}
}

func TestBuild(t *testing.T) {
	// Wednesday 21 October 2026, 10:00 in Saigon.
	now := time.Date(2026, 10, 21, 3, 0, 0, 0, time.UTC)
	events := Build(source(), now)
	byUID := map[string]Event{}
	for _, e := range events {
		byUID[e.UID] = e
	}
	if len(events) != 5 {
		t.Fatalf("%d events, want review + weekly + cycle end + 2 training days", len(events))
	}

	review := byUID["review-11111111-1111-1111-1111-111111111111@anytools.world"]
	// The series starts on the feed's first day, at the learner's hour, in their zone.
	if got := review.At.Format("2006-01-02 15:04 MST"); got != "2026-10-01 20:00 +07" || review.RRule != "FREQ=DAILY" {
		t.Fatalf("review: %s %s", got, review.RRule)
	}
	if review.Summary != "AnyLearn: ôn tập" {
		t.Fatalf("review in the learner's language: %q", review.Summary)
	}

	weekly := byUID["weekly-22222222-2222-2222-2222-222222222222@anytools.world"]
	if weekly.Day.Format("2006-01-02") != "2026-10-12" || weekly.RRule != "FREQ=WEEKLY;COUNT=12" {
		t.Fatalf("weekly: %s %s", weekly.Day.Format("2006-01-02"), weekly.RRule)
	}
	// Generic titles by default (red team #2).
	if strings.Contains(weekly.Summary, "IELTS") {
		t.Fatalf("a goal leaked into a generic title: %q", weekly.Summary)
	}
	end := byUID["cycle-end-22222222-2222-2222-2222-222222222222@anytools.world"]
	if end.Day.Format("2006-01-02") != "2027-01-02" {
		t.Fatalf("day 90 of a cycle started 5 Oct is 2 Jan: %s", end.Day.Format("2006-01-02"))
	}

	monday := byUID["training-11111111-1111-1111-1111-111111111111-1@anytools.world"]
	if monday.Day.Format("2006-01-02 Mon") != "2026-10-26 Mon" || monday.RRule != "FREQ=WEEKLY;BYDAY=MO" {
		t.Fatalf("monday: %s %s", monday.Day.Format("2006-01-02 Mon"), monday.RRule)
	}
}

func TestBuild_NamedAndFiltered(t *testing.T) {
	src := source()
	src.Named = true
	src.Include = Include{Loop: true}
	events := Build(src, time.Date(2026, 10, 21, 3, 0, 0, 0, time.UTC))
	if len(events) != 2 {
		t.Fatalf("only the Loop: %d events", len(events))
	}
	if events[0].Summary != "AnyLearn: xem lại tuần: IELTS writing band 7" {
		t.Fatalf("named: %q", events[0].Summary)
	}
}

func TestBuild_UnknownZoneAndLanguageFallBack(t *testing.T) {
	src := source()
	src.Zone, src.Language = "Mars/Olympus", "xx"
	events := Build(src, time.Date(2026, 10, 21, 3, 0, 0, 0, time.UTC))
	if events[0].At.Location() != time.UTC || events[0].Summary != "AnyLearn: review" {
		t.Fatalf("%v %q", events[0].At.Location(), events[0].Summary)
	}
}

type memStore struct {
	feeds  map[uuid.UUID]*Feed
	hashes map[string]uuid.UUID
	src    Source
}

func (m *memStore) GetFeed(_ context.Context, u uuid.UUID) (*Feed, error) {
	if f, ok := m.feeds[u]; ok {
		c := *f
		return &c, nil
	}
	return nil, ErrNoFeed
}
func (m *memStore) FeedByHash(ctx context.Context, h []byte) (*Feed, error) {
	if u, ok := m.hashes[string(h)]; ok {
		return m.GetFeed(ctx, u)
	}
	return nil, ErrNoFeed
}
func (m *memStore) SaveFeed(_ context.Context, f Feed, h []byte) error {
	for k, u := range m.hashes {
		if u == f.UserID {
			delete(m.hashes, k)
		}
	}
	m.feeds[f.UserID], m.hashes[string(h)] = &f, f.UserID
	return nil
}
func (m *memStore) UpdateFeedOptions(_ context.Context, u uuid.UUID, named bool, inc Include) error {
	m.feeds[u].Named, m.feeds[u].Include = named, inc
	return nil
}
func (m *memStore) MarkFetched(context.Context, uuid.UUID, time.Time) error { return nil }
func (m *memStore) Source(context.Context, uuid.UUID) (*Source, error) {
	s := m.src
	return &s, nil
}

func TestService_RenderAndRotate(t *testing.T) {
	src := source()
	store := &memStore{feeds: map[uuid.UUID]*Feed{}, hashes: map[string]uuid.UUID{}, src: src}
	svc := NewService(store, "https://anytools.world")
	ctx := context.Background()

	feed, err := svc.Get(ctx, src.UserID)
	if err != nil || len(feed.Token) < 40 || !feed.Include.Review || feed.Named {
		t.Fatalf("first feed: %+v %v", feed, err)
	}
	ics, err := svc.Render(ctx, feed.Token)
	if err != nil || !bytes.Contains(ics, []byte("X-WR-CALNAME:AnyLearn")) {
		t.Fatalf("render: %v", err)
	}

	rotated, err := svc.Rotate(ctx, src.UserID)
	if err != nil || rotated.Token == feed.Token {
		t.Fatalf("rotate: %v", err)
	}
	if _, err := svc.Render(ctx, feed.Token); !errors.Is(err, ErrNoFeed) {
		t.Fatalf("the old token still renders: %v", err)
	}
	if _, err := svc.Render(ctx, "short"); !errors.Is(err, ErrNoFeed) {
		t.Fatal("a malformed token must be a plain miss")
	}
}
