// Package gcal writes the study calendar into Google Calendar
// (learning-tool-connections phase 3), for a learner who wants it exact
// rather than refreshed when Google decides to read a feed.
//
// The scope is calendar.app.created: AnyLearn may create secondary calendars
// and change events on those, and sees nothing of the learner's other
// calendars. It creates one, "AnyLearn", and keeps it in step every hour:
//
//   - today's review, at the learner's hour, titled with how much is due
//     ("AnyLearn: review, 23 due"), and no event on a day with nothing due;
//   - the Loop's weekly reviews and cycle ends, and the training days, as
//     the same recurring events the feed (phase 2) carries.
//
// Event ids are derived from the feed's UIDs, so a retry, a restart or two
// syncs at once write the same event rather than a second one; events that
// no longer belong (a cycle that ended, a rest day) are deleted.
package gcal

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/calendar"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/googleapi"
)

// BaseURL is the Calendar API.
const BaseURL = "https://www.googleapis.com/calendar/v3"

// SyncInterval is how often the job runs.
const SyncInterval = time.Hour

// ErrNotEnabled reports a learner without an AnyLearn calendar.
var ErrNotEnabled = errors.New("gcal: no AnyLearn calendar for this learner")

// Link is a learner's AnyLearn calendar.
type Link struct {
	UserID     uuid.UUID  `json:"-"`
	CalendarID string     `json:"calendar_id"`
	EventIDs   []string   `json:"-"`
	SyncedAt   *time.Time `json:"synced_at,omitempty"`
	LastError  string     `json:"last_error,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// Store persists links.
type Store interface {
	GetLink(ctx context.Context, userID uuid.UUID) (*Link, error)
	SaveLink(ctx context.Context, l Link) error
	DeleteLink(ctx context.Context, userID uuid.UUID) error
	ListLinkedUsers(ctx context.Context) ([]uuid.UUID, error)
}

// Events builds a learner's events (calendar.Service).
type Events interface {
	Events(ctx context.Context, userID uuid.UUID, named bool, include calendar.Include) (*calendar.Source, []calendar.Event, error)
}

// Counter counts what is due today (the reminder's own count).
type Counter interface {
	DueTotal(ctx context.Context, userID uuid.UUID) (int, error)
}

// Service is the Google Calendar writer.
type Service struct {
	google  googleapi.Doer
	store   Store
	events  Events
	due     Counter
	baseURL string
	now     func() time.Time
	HTTP    *http.Client
}

// NewService returns a Service.
func NewService(google googleapi.Doer, store Store, events Events, due Counter) *Service {
	return &Service{google: google, store: store, events: events, due: due, baseURL: BaseURL, now: time.Now}
}

// SetBaseURL and SetClock are for tests.
func (s *Service) SetBaseURL(u string)           { s.baseURL = u }
func (s *Service) SetClock(now func() time.Time) { s.now = now }

func (s *Service) client(userID uuid.UUID) googleapi.Client {
	return googleapi.Client{Doer: s.google, UserID: userID, Scopes: []string{drive.ScopeCalendarAppCreated}, HTTP: s.HTTP}
}

// Status is the learner's link, or nil.
func (s *Service) Status(ctx context.Context, userID uuid.UUID) (*Link, error) {
	l, err := s.store.GetLink(ctx, userID)
	if errors.Is(err, ErrNotEnabled) {
		return nil, nil
	}
	return l, err
}

// Enable creates the AnyLearn calendar (once) and fills it.
func (s *Service) Enable(ctx context.Context, userID uuid.UUID) (*Link, error) {
	if l, err := s.store.GetLink(ctx, userID); err == nil {
		return l, s.Sync(ctx, userID)
	} else if !errors.Is(err, ErrNotEnabled) {
		return nil, err
	}
	src, _, err := s.events.Events(ctx, userID, false, calendar.Include{})
	if err != nil {
		return nil, err
	}
	var created struct {
		ID string `json:"id"`
	}
	body := map[string]string{
		"summary":     calendar.Name(src.Language),
		"description": "AnyLearn: reviews, the Loop and training days.",
		"timeZone":    calendar.Location(src.Zone).String(),
	}
	if err := s.client(userID).JSON(ctx, http.MethodPost, s.baseURL+"/calendars", body, &created); err != nil {
		return nil, err
	}
	l := Link{UserID: userID, CalendarID: created.ID, CreatedAt: s.now()}
	if err := s.store.SaveLink(ctx, l); err != nil {
		return nil, err
	}
	if err := s.Sync(ctx, userID); err != nil {
		return &l, err
	}
	return s.store.GetLink(ctx, userID)
}

// Disable stops writing; with remove, the AnyLearn calendar is deleted too.
func (s *Service) Disable(ctx context.Context, userID uuid.UUID, remove bool) error {
	l, err := s.store.GetLink(ctx, userID)
	if errors.Is(err, ErrNotEnabled) {
		return nil
	}
	if err != nil {
		return err
	}
	if remove {
		err := s.client(userID).JSON(ctx, http.MethodDelete, s.baseURL+"/calendars/"+url.PathEscape(l.CalendarID), nil, nil)
		if err != nil && !googleapi.IsStatus(err, http.StatusNotFound) && !googleapi.IsStatus(err, http.StatusGone) {
			return err
		}
	}
	return s.store.DeleteLink(ctx, userID)
}

// eventID is a Calendar event id for a feed UID: lowercase hex, which is
// within the base32hex alphabet the API allows.
func eventID(uid string) string {
	sum := sha256.Sum256([]byte(uid))
	return hex.EncodeToString(sum[:20])
}

// body is an event as the Calendar API takes it.
func body(e calendar.Event, zone string) map[string]any {
	out := map[string]any{"summary": e.Summary, "description": e.Description, "source": map[string]string{"title": "AnyLearn", "url": e.URL}}
	if e.Day.IsZero() {
		out["start"] = map[string]string{"dateTime": e.At.Format("2006-01-02T15:04:05"), "timeZone": zone}
		out["end"] = map[string]string{"dateTime": e.At.Add(e.Duration).Format("2006-01-02T15:04:05"), "timeZone": zone}
		if e.Alarm {
			out["reminders"] = map[string]any{"useDefault": false, "overrides": []map[string]any{{"method": "popup", "minutes": 0}}}
		}
	} else {
		out["start"] = map[string]string{"date": e.Day.Format("2006-01-02")}
		out["end"] = map[string]string{"date": e.Day.AddDate(0, 0, 1).Format("2006-01-02")}
		out["transparency"] = "transparent"
	}
	if e.URL == "" {
		delete(out, "source")
	}
	if e.RRule != "" {
		out["recurrence"] = []string{"RRULE:" + e.RRule}
	}
	return out
}

// Sync writes the learner's events and deletes the ones that no longer belong.
func (s *Service) Sync(ctx context.Context, userID uuid.UUID) error {
	l, err := s.store.GetLink(ctx, userID)
	if err != nil {
		return err
	}
	err = s.sync(ctx, l)
	now := s.now()
	l.SyncedAt = &now
	l.LastError = ""
	if err != nil {
		l.LastError = err.Error()
	}
	if serr := s.store.SaveLink(ctx, *l); serr != nil && err == nil {
		err = serr
	}
	return err
}

func (s *Service) sync(ctx context.Context, l *Link) error {
	src, events, err := s.events.Events(ctx, l.UserID, false, calendar.Include{Loop: true, Body: true})
	if err != nil {
		return err
	}
	zone := calendar.Location(src.Zone).String()

	// Today's review, with today's number, instead of the feed's daily series.
	due, err := s.due.DueTotal(ctx, l.UserID)
	if err != nil {
		return err
	}
	if due > 0 {
		loc := calendar.Location(src.Zone)
		local := s.now().In(loc)
		hour := src.ReminderHour
		if hour < 0 || hour > 23 {
			hour = 7
		}
		events = append(events, calendar.Event{
			UID:         fmt.Sprintf("review-%s-%s@anytools.world", l.UserID, local.Format("2006-01-02")),
			Summary:     calendar.ReviewTitle(src.Language, due),
			Description: src.AppURL + "/mastery/review",
			URL:         src.AppURL + "/mastery/review",
			At:          time.Date(local.Year(), local.Month(), local.Day(), hour, 0, 0, 0, loc),
			Duration:    20 * time.Minute,
			Alarm:       true,
		})
	}

	c := s.client(l.UserID)
	base := s.baseURL + "/calendars/" + url.PathEscape(l.CalendarID) + "/events"
	var written []string
	for _, e := range events {
		id := eventID(e.UID)
		b := body(e, zone)
		b["id"] = id
		err := c.JSON(ctx, http.MethodPost, base, b, nil)
		if googleapi.IsStatus(err, http.StatusConflict) {
			delete(b, "id")
			err = c.JSON(ctx, http.MethodPut, base+"/"+id, b, nil)
		}
		if googleapi.IsStatus(err, http.StatusNotFound) {
			return fmt.Errorf("gcal: the AnyLearn calendar is gone: %w", err)
		}
		if err != nil {
			return err
		}
		written = append(written, id)
	}
	for _, old := range l.EventIDs {
		if slices.Contains(written, old) {
			continue
		}
		err := c.JSON(ctx, http.MethodDelete, base+"/"+old, nil, nil)
		if err != nil && !googleapi.IsStatus(err, http.StatusNotFound) && !googleapi.IsStatus(err, http.StatusGone) {
			slog.Warn("gcal: a stale event was not deleted", "user", l.UserID, "error", err)
			written = append(written, old) // try again next hour
		}
	}
	l.EventIDs = written
	return nil
}

// SyncAll runs one pass over every linked learner.
func (s *Service) SyncAll(ctx context.Context) (users, failed int) {
	ids, err := s.store.ListLinkedUsers(ctx)
	if err != nil {
		slog.Error("gcal: listing linked users failed", "error", err)
		return 0, 0
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			break
		}
		users++
		if err := s.Sync(ctx, id); err != nil {
			failed++
			if !errors.Is(err, drive.ErrNeedsReconnect) && !errors.Is(err, drive.ErrScopeMissing) {
				slog.Warn("gcal: sync failed", "user", id, "error", err)
			}
		}
	}
	return users, failed
}
