package gcal

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/calendar"
	"github.com/D0bby999/anytools/internal/connectors/drive"
)

type fakeDoer struct{ scopes []string }

func (f *fakeDoer) GoogleDo(_ context.Context, _ uuid.UUID, scopes []string, send func(string) (*http.Response, error)) (*http.Response, error) {
	f.scopes = scopes
	return send("tok")
}

type memStore struct{ links map[uuid.UUID]Link }

func (m *memStore) GetLink(_ context.Context, u uuid.UUID) (*Link, error) {
	if l, ok := m.links[u]; ok {
		return &l, nil
	}
	return nil, ErrNotEnabled
}
func (m *memStore) SaveLink(_ context.Context, l Link) error { m.links[l.UserID] = l; return nil }
func (m *memStore) DeleteLink(_ context.Context, u uuid.UUID) error {
	delete(m.links, u)
	return nil
}
func (m *memStore) ListLinkedUsers(context.Context) ([]uuid.UUID, error) {
	var out []uuid.UUID
	for u := range m.links {
		out = append(out, u)
	}
	return out, nil
}

type fakeEvents struct{ training []calendar.TrainingDay }

func (f *fakeEvents) Events(_ context.Context, u uuid.UUID, named bool, inc calendar.Include) (*calendar.Source, []calendar.Event, error) {
	src := calendar.Source{UserID: u, Zone: "Asia/Ho_Chi_Minh", Language: "vi", ReminderHour: 20, Training: f.training, Include: inc, Named: named, AppURL: "https://anytools.world"}
	return &src, calendar.Build(src, time.Date(2026, 10, 21, 3, 0, 0, 0, time.UTC)), nil
}

type fakeDue struct{ n int }

func (f *fakeDue) DueTotal(context.Context, uuid.UUID) (int, error) { return f.n, nil }

// fakeCalendar is the Calendar API's events, by id, for one calendar.
type fakeCalendar struct {
	mu      sync.Mutex
	events  map[string]map[string]any
	created int
	deleted []string
	gone    bool
}

func (f *fakeCalendar) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.gone {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error":{"code":404,"message":"Not Found","errors":[{"reason":"notFound"}]}}`)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/calendars":
			f.created++
			if body["timeZone"] != "Asia/Ho_Chi_Minh" || body["summary"] != "AnyLearn" {
				t.Errorf("calendar body: %v", body)
			}
			_, _ = io.WriteString(w, `{"id":"cal-1@group.calendar.google.com"}`)
		case r.Method == http.MethodPost && r.URL.Path == "/calendars/cal-1@group.calendar.google.com/events":
			id := body["id"].(string)
			if _, ok := f.events[id]; ok {
				w.WriteHeader(http.StatusConflict)
				_, _ = io.WriteString(w, `{"error":{"code":409,"message":"The requested identifier already exists.","errors":[{"reason":"duplicate"}]}}`)
				return
			}
			f.events[id] = body
			_, _ = io.WriteString(w, `{}`)
		case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/calendars/cal-1@group.calendar.google.com/events/"):
			id := strings.TrimPrefix(r.URL.Path, "/calendars/cal-1@group.calendar.google.com/events/")
			f.events[id] = body
			_, _ = io.WriteString(w, `{}`)
		case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/calendars/cal-1@group.calendar.google.com/events/"):
			id := strings.TrimPrefix(r.URL.Path, "/calendars/cal-1@group.calendar.google.com/events/")
			delete(f.events, id)
			f.deleted = append(f.deleted, id)
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodDelete && r.URL.Path == "/calendars/cal-1@group.calendar.google.com":
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	})
}

func summaries(events map[string]map[string]any) []string {
	var out []string
	for _, e := range events {
		out = append(out, e["summary"].(string))
	}
	return out
}

func TestEnableSyncAndDisable(t *testing.T) {
	fc := &fakeCalendar{events: map[string]map[string]any{}}
	srv := httptest.NewServer(fc.handler(t))
	defer srv.Close()

	doer, store := &fakeDoer{}, &memStore{links: map[uuid.UUID]Link{}}
	events := &fakeEvents{training: []calendar.TrainingDay{{Weekday: 1}, {Weekday: 4}}}
	due := &fakeDue{n: 23}
	svc := NewService(doer, store, events, due)
	svc.SetBaseURL(srv.URL)
	svc.SetClock(func() time.Time { return time.Date(2026, 10, 21, 3, 0, 0, 0, time.UTC) })
	user := uuid.New()
	ctx := context.Background()

	l, err := svc.Enable(ctx, user)
	if err != nil || l.CalendarID != "cal-1@group.calendar.google.com" || len(doer.scopes) != 1 || doer.scopes[0] != drive.ScopeCalendarAppCreated {
		t.Fatalf("enable: %+v %v %v", l, err, doer.scopes)
	}
	if len(fc.events) != 3 || !strings.Contains(strings.Join(summaries(fc.events), "|"), "AnyLearn: ôn 23 mục đến hạn") {
		t.Fatalf("today's review with its count and two training days: %v", summaries(fc.events))
	}
	for _, e := range fc.events {
		if e["summary"] == "AnyLearn: buổi tập" && e["recurrence"] == nil {
			t.Fatalf("training days recur: %v", e)
		}
	}

	// Enabling again neither creates a second calendar nor a second event.
	if _, err := svc.Enable(ctx, user); err != nil || fc.created != 1 || len(fc.events) != 3 {
		t.Fatalf("second enable: %v created=%d events=%d", err, fc.created, len(fc.events))
	}

	// Nothing due and Thursday made a rest day: those two events go.
	due.n, events.training = 0, []calendar.TrainingDay{{Weekday: 1}}
	if err := svc.Sync(ctx, user); err != nil {
		t.Fatal(err)
	}
	if len(fc.events) != 1 || len(fc.deleted) != 2 {
		t.Fatalf("after: %v deleted=%v", summaries(fc.events), fc.deleted)
	}
	if store.links[user].SyncedAt == nil || store.links[user].LastError != "" {
		t.Fatalf("link: %+v", store.links[user])
	}

	// The learner deleted the calendar in Google: the sync says so.
	fc.gone = true
	if err := svc.Sync(ctx, user); err == nil || !strings.Contains(store.links[user].LastError, "gone") {
		t.Fatalf("gone: %v %q", err, store.links[user].LastError)
	}
	fc.gone = false

	if err := svc.Disable(ctx, user, true); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetLink(ctx, user); !errors.Is(err, ErrNotEnabled) {
		t.Fatal("disable forgets the link")
	}
}

func TestEventIDIsValidBase32Hex(t *testing.T) {
	id := eventID("review-x@anytools.world")
	if len(id) < 5 || strings.Trim(id, "0123456789abcdefghijklmnopqrstuv") != "" || id != eventID("review-x@anytools.world") {
		t.Fatalf("%q", id)
	}
}
