package push

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

func TestValidateEndpointAcceptsOnlyBrowserPushServices(t *testing.T) {
	good := []string{
		"https://fcm.googleapis.com/fcm/send/abc:def",
		"https://web.push.apple.com/QGx",
		"https://updates.push.services.mozilla.com/wpush/v2/gAAA",
		"https://wns2-par02p.notify.windows.com/w/?token=abc",
	}
	for _, u := range good {
		if err := ValidateEndpoint(u); err != nil {
			t.Errorf("%s refused: %v", u, err)
		}
	}
	bad := []string{
		"http://fcm.googleapis.com/fcm/send/x",       // not https
		"https://fcm.googleapis.com:8443/fcm/send/x", // a port
		"https://user@fcm.googleapis.com/fcm/send/x", // credentials
		"https://169.254.169.254/latest/meta-data",   // the metadata service
		"https://localhost/push",
		"https://evilpush.apple.com.attacker.net/x", // suffix, not a subdomain
		"https://notpush.apple.com/x",               // no dot before push.apple.com
		"https://example.com/fcm.googleapis.com",
		"",
	}
	for _, u := range bad {
		if err := ValidateEndpoint(u); !errors.Is(err, ErrInvalid) {
			t.Errorf("%q accepted (err=%v)", u, err)
		}
	}
}

func TestMessageIsDeclarativeWebPush(t *testing.T) {
	s := NewService(nil, nil, "https://anytools.world/")
	var got struct {
		WebPush      int `json:"web_push"`
		Notification struct {
			Title    string `json:"title"`
			Body     string `json:"body"`
			Navigate string `json:"navigate"`
			AppBadge string `json:"app_badge"`
		} `json:"notification"`
	}
	if err := json.Unmarshal(s.message("3 review points are due.", "/mastery/review", 3, "en"), &got); err != nil {
		t.Fatal(err)
	}
	if got.WebPush != 8030 || got.Notification.Title != "AnyLearn" ||
		got.Notification.Navigate != "https://anytools.world/mastery/review" || got.Notification.AppBadge != "3" {
		t.Fatalf("payload = %+v", got)
	}
}

func TestDueBody(t *testing.T) {
	cases := []struct {
		lang string
		due  int
		want string
	}{
		{"en", 1, "1 thing is waiting for your review."},
		{"en", 4, "4 things are waiting for your review."},
		{"vi", 4, "Có 4 việc cần ôn đang chờ bạn."},
		{"es", 1, "Tienes 1 cosa por repasar."},
		{"pt", 3, "Você tem 3 coisas para revisar."},
		{"fr", 2, "2 things are waiting for your review."},
	}
	for _, c := range cases {
		if got := dueBody(c.due, "", c.lang); got != c.want {
			t.Errorf("dueBody(%d, %s) = %q, want %q", c.due, c.lang, got, c.want)
		}
	}
}

type fakeStore struct {
	Store
	keys      *Keys
	subs      []Subscription
	claimable bool
	forgotten []string
	saved     []Subscription
	due       []uuid.UUID
}

func (f *fakeStore) ReminderCandidates(context.Context, time.Time, int) ([]uuid.UUID, error) {
	return f.due, nil
}

// fakePlanner is each learner's training today.
type fakePlanner map[uuid.UUID]string

func (p fakePlanner) PlannedToday(_ context.Context, id uuid.UUID) (string, error) { return p[id], nil }

func TestTheReminderNamesTodaysTraining(t *testing.T) {
	for _, c := range []struct {
		due           int
		workout, lang string
		want          string
	}{
		{0, "Full body", "en", "Today's training: Full body."},
		{1, "Full body", "en", "1 thing is waiting for your review, and today's training is Full body."},
		{5, "Toàn thân", "vi", "Có 5 việc cần ôn đang chờ bạn, và hôm nay có buổi tập: Toàn thân."},
	} {
		if got := dueBody(c.due, c.workout, c.lang); got != c.want {
			t.Errorf("dueBody(%d, %q, %s) = %q, want %q", c.due, c.workout, c.lang, got, c.want)
		}
	}

	// A learner with nothing to review but a workout today is reminded;
	// one with neither is not.
	trains, idle := uuid.New(), uuid.New()
	s := NewService(&fakeStore{due: []uuid.UUID{trains, idle}}, &fakeSender{}, "https://anytools.world").
		WithCounter(fakeCounter{trains: 0, idle: 0}).WithPlanner(fakePlanner{trains: "Full body"})
	got, err := s.DueDigests(context.Background(), time.Now())
	if err != nil || len(got) != 1 || got[0].UserID != trains || got[0].Workout != "Full body" {
		t.Fatalf("digests = %+v, %v; want only the learner who trains today", got, err)
	}
}

// fakeCounter is each learner's total, or an error for a learner it lacks.
type fakeCounter map[uuid.UUID]int

func (c fakeCounter) DueTotal(_ context.Context, id uuid.UUID) (int, error) {
	n, ok := c[id]
	if !ok {
		return 0, errors.New("count failed")
	}
	return n, nil
}

func (f *fakeStore) VAPIDKeys(context.Context) (Keys, bool, error) {
	if f.keys == nil {
		return Keys{}, false, nil
	}
	return *f.keys, true, nil
}

func (f *fakeStore) SaveVAPIDKeys(_ context.Context, k Keys) (Keys, error) {
	if f.keys == nil {
		f.keys = &k
	}
	return *f.keys, nil
}

func (f *fakeStore) Subscribe(_ context.Context, _ uuid.UUID, s Subscription) error {
	f.saved = append(f.saved, s)
	return nil
}

func (f *fakeStore) Subscriptions(context.Context, uuid.UUID) ([]Subscription, error) {
	return f.subs, nil
}

func (f *fakeStore) Forget(_ context.Context, endpoint string) error {
	f.forgotten = append(f.forgotten, endpoint)
	return nil
}

func (f *fakeStore) ClaimReminder(context.Context, uuid.UUID, time.Time, int) ([]Subscription, string, bool, error) {
	return f.subs, "vi", f.claimable, nil
}

func (f *fakeStore) Settings(context.Context, uuid.UUID) (int, string, string, error) {
	return 7, "UTC", "en", nil
}

type fakeSender struct {
	gone    map[string]bool
	sent    []string
	payload string
}

func (f *fakeSender) Send(_ context.Context, sub Subscription, payload []byte, keys Keys) error {
	if keys.Public == "" || keys.Private == "" {
		return errors.New("no keys")
	}
	if f.gone[sub.Endpoint] {
		return ErrGone
	}
	f.sent = append(f.sent, sub.Endpoint)
	f.payload = string(payload)
	return nil
}

const (
	chrome = "https://fcm.googleapis.com/fcm/send/a"
	iphone = "https://web.push.apple.com/b"
)

func TestNotifySendsOnlyWhenClaimedAndForgetsGoneBrowsers(t *testing.T) {
	store := &fakeStore{subs: []Subscription{{Endpoint: chrome}, {Endpoint: iphone}}}
	sender := &fakeSender{gone: map[string]bool{iphone: true}}
	s := NewService(store, sender, "https://anytools.world")
	summary := learning.DueSummary{UserID: uuid.New(), Due: 2}

	if err := s.Notify(context.Background(), summary); err != nil || len(sender.sent) != 0 {
		t.Fatalf("not this learner's hour: err=%v sent=%v", err, sender.sent)
	}

	store.claimable = true
	if err := s.Notify(context.Background(), summary); err != nil {
		t.Fatalf("notify: %v", err)
	}
	if len(sender.sent) != 1 || sender.sent[0] != chrome {
		t.Fatalf("sent to %v, want only the Chrome browser", sender.sent)
	}
	if !strings.Contains(sender.payload, "Có 2 việc cần ôn đang chờ bạn.") || !strings.Contains(sender.payload, `"lang":"vi"`) ||
		!strings.Contains(sender.payload, `"navigate":"https://anytools.world/home"`) {
		t.Fatalf("payload = %s", sender.payload)
	}
	if len(store.forgotten) != 1 || store.forgotten[0] != iphone {
		t.Fatalf("forgotten = %v, want the gone iPhone", store.forgotten)
	}
	if strings.Contains(sender.payload, "Chuỗi") {
		t.Errorf("a streak without a Streaker: %s", sender.payload)
	}

	// With a streak running it follows; with none, or when it fails, not.
	for days, want := range map[int]string{12: "Có 2 việc cần ôn đang chờ bạn. Chuỗi ngày học: 12 ngày.", 0: "Có 2 việc cần ôn đang chờ bạn.\"", -1: "Có 2 việc cần ôn đang chờ bạn.\""} {
		s.WithStreak(fakeStreak(days))
		if err := s.Notify(context.Background(), summary); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(sender.payload, want) {
			t.Errorf("streak %d: %s", days, sender.payload)
		}
	}
	if got := streakLine(1, "en"); got != " Your streak: 1 day." {
		t.Errorf("one day: %q", got)
	}
}

// fakeStreak is a running streak; a negative one fails.
type fakeStreak int

func (f fakeStreak) Streak(context.Context, uuid.UUID) (int, error) {
	if f < 0 {
		return 0, errors.New("the database is down")
	}
	return int(f), nil
}

func TestDueDigestsCountEverythingDueForTheLearnersInTheirHour(t *testing.T) {
	busy, idle, broken := uuid.New(), uuid.New(), uuid.New()
	store := &fakeStore{due: []uuid.UUID{busy, idle, broken}}
	s := NewService(store, &fakeSender{}, "https://anytools.world")

	if got, err := s.DueDigests(context.Background(), time.Now()); err != nil || len(got) != 0 {
		t.Fatalf("without a counter: %v, %v; want nobody", got, err)
	}

	s.WithCounter(fakeCounter{busy: 7, idle: 0})
	got, err := s.DueDigests(context.Background(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	// idle has nothing due, so its day stays unclaimed for a later hour;
	// broken's count failed, which must not cost busy theirs.
	if len(got) != 1 || got[0].UserID != busy || got[0].Due != 7 {
		t.Fatalf("digests = %+v, want only busy with 7", got)
	}
}

func TestVAPIDKeysAreMadeOnceAndKept(t *testing.T) {
	store := &fakeStore{}
	s := NewService(store, &fakeSender{}, "https://anytools.world")
	first, err := s.vapid(context.Background())
	if err != nil || first.Public == "" || first.Private == "" {
		t.Fatalf("first keys = %+v, %v", first, err)
	}
	again, _ := NewService(store, &fakeSender{}, "").vapid(context.Background())
	if again != first {
		t.Fatal("a second service made a second key pair")
	}
}

func TestSubscribeRefusesMalformedSubscriptions(t *testing.T) {
	store := &fakeStore{}
	s := NewService(store, &fakeSender{}, "")
	user := uuid.New()
	p256dh := strings.Repeat("B", 87)
	auth := strings.Repeat("a", 22)
	if err := s.Subscribe(context.Background(), user, Subscription{Endpoint: chrome, P256dh: p256dh, Auth: auth}); err != nil {
		t.Fatalf("a well-formed subscription: %v", err)
	}
	bad := []Subscription{
		{Endpoint: "https://attacker.example/x", P256dh: p256dh, Auth: auth},
		{Endpoint: chrome, P256dh: "short", Auth: auth},
		{Endpoint: chrome, P256dh: p256dh, Auth: "has space in it......"},
	}
	for _, sub := range bad {
		if err := s.Subscribe(context.Background(), user, sub); !errors.Is(err, ErrInvalid) {
			t.Errorf("%+v accepted (err=%v)", sub, err)
		}
	}
	if len(store.saved) != 1 {
		t.Fatalf("saved %d subscriptions, want 1", len(store.saved))
	}
}

func TestTestNeedsASubscribedBrowser(t *testing.T) {
	s := NewService(&fakeStore{}, &fakeSender{}, "")
	if _, err := s.Test(context.Background(), uuid.New()); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}
