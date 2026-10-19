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
		s    learning.DueSummary
		want string
	}{
		{"en", learning.DueSummary{Due: 1, Paths: 1}, "1 review point is due."},
		{"en", learning.DueSummary{Due: 4, Paths: 1}, "4 review points are due."},
		{"en", learning.DueSummary{Due: 5, Paths: 2}, "5 review points are due, across 2 paths."},
		{"vi", learning.DueSummary{Due: 4, Paths: 1}, "Có 4 điểm cần ôn."},
		{"es", learning.DueSummary{Due: 1, Paths: 1}, "Tienes 1 punto para repasar."},
		{"pt", learning.DueSummary{Due: 3, Paths: 2}, "Você tem 3 pontos para revisar, em 2 trilhas."},
		{"fr", learning.DueSummary{Due: 2, Paths: 1}, "2 review points are due."},
	}
	for _, c := range cases {
		if got := dueBody(c.s, c.lang); got != c.want {
			t.Errorf("dueBody(%+v, %s) = %q, want %q", c.s, c.lang, got, c.want)
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
	summary := learning.DueSummary{UserID: uuid.New(), Due: 2, Paths: 1}

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
	if !strings.Contains(sender.payload, "Có 2 điểm cần ôn.") || !strings.Contains(sender.payload, `"lang":"vi"`) {
		t.Fatalf("payload = %s", sender.payload)
	}
	if len(store.forgotten) != 1 || store.forgotten[0] != iphone {
		t.Fatalf("forgotten = %v, want the gone iPhone", store.forgotten)
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
