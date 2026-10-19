// Package push sends AnyLearn's one notification: the daily review reminder,
// as a web push to each browser the learner turned reminders on in.
//
// There is no platform service behind it. The server makes its own VAPID key
// pair on first use, and a browser's push service (Google's, Mozilla's,
// Apple's or Microsoft's) delivers the message; nobody holds an account.
//
// The reminder says only how many review points are due. It is not a streak
// and never nags: one a day at most, at the learner's own local hour, and only
// when something is actually due (learning.DueDigestJob decides that).
package push

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

// ErrInvalid is a subscription or setting the service refuses.
var ErrInvalid = errors.New("push: invalid")

// ErrGone is a subscription its push service no longer knows (404 or 410):
// the browser unsubscribed, or the learner cleared its data.
var ErrGone = errors.New("push: subscription gone")

// DefaultHour is the local hour a reminder goes out at until the learner picks
// another: a person's morning (see learning.DigestHour).
const DefaultHour = learning.DigestHour

// Window is how many hours after the learner's hour a reminder may still go
// out. The job ticks hourly from whenever the process started, so a restart
// can skip one tick; a three-hour window still catches the day.
const Window = 3

// Subscription is one browser's push endpoint and its encryption keys.
type Subscription struct {
	Endpoint string `json:"endpoint"`
	P256dh   string `json:"p256dh"`
	Auth     string `json:"auth"`
}

// Keys is the server's VAPID key pair, base64url as the browser expects it.
type Keys struct {
	Public  string
	Private string
}

// Settings is what Settings → Reminders shows.
type Settings struct {
	PublicKey string `json:"public_key"`
	Hour      int    `json:"hour"`
	Timezone  string `json:"timezone"`
	// Endpoints are the learner's subscribed browsers. The page compares its
	// own subscription against them to say whether THIS browser is on.
	Endpoints []string `json:"endpoints"`
}

// Store is the persistence the service needs.
type Store interface {
	// VAPIDKeys returns the stored pair; ok is false before the first one.
	VAPIDKeys(ctx context.Context) (keys Keys, ok bool, err error)
	// SaveVAPIDKeys stores a pair unless one exists, and returns the one that
	// is stored: two first callers racing must agree on a single pair.
	SaveVAPIDKeys(ctx context.Context, keys Keys) (Keys, error)
	Subscribe(ctx context.Context, userID uuid.UUID, sub Subscription) error
	Unsubscribe(ctx context.Context, userID uuid.UUID, endpoint string) error
	Subscriptions(ctx context.Context, userID uuid.UUID) ([]Subscription, error)
	// Forget deletes a subscription its push service reported gone.
	Forget(ctx context.Context, endpoint string) error
	Settings(ctx context.Context, userID uuid.UUID) (hour int, timezone, language string, err error)
	SetHour(ctx context.Context, userID uuid.UUID, hour int) error
	// ClaimReminder marks today's reminder as sent and returns the learner's
	// subscriptions, in one statement, when the learner's local hour is in
	// [hour, hour+window), today's has not gone out yet, and they have at
	// least one subscription. ok is false otherwise. One statement, so two
	// ticks cannot both claim the same day. language is the learner's
	// interface language, which the reminder is written in.
	ClaimReminder(ctx context.Context, userID uuid.UUID, now time.Time, window int) (subs []Subscription, language string, ok bool, err error)
	// ReminderCandidates lists the learners ClaimReminder would claim now,
	// without claiming: the ones worth counting what is due for.
	ReminderCandidates(ctx context.Context, now time.Time, window int) ([]uuid.UUID, error)
}

// Counter counts what a learner has due today, everything Home's "Due for
// review" counts, so the reminder and the page agree on the number.
type Counter interface {
	DueTotal(ctx context.Context, userID uuid.UUID) (int, error)
}

// Planner names the training the learner's week schedules today, not yet
// done, or "" (internal/body).
type Planner interface {
	PlannedToday(ctx context.Context, userID uuid.UUID) (string, error)
}

// Sender delivers one encrypted message to one subscription.
type Sender interface {
	Send(ctx context.Context, sub Subscription, payload []byte, keys Keys) error
}

// Service is the reminders' API and the due digest's notifier.
type Service struct {
	store   Store
	sender  Sender
	appURL  string
	counter Counter
	planner Planner

	mu   sync.Mutex
	keys *Keys
}

// NewService builds the service. appURL is the site's origin; a reminder
// opens the review page on it.
func NewService(store Store, sender Sender, appURL string) *Service {
	return &Service{store: store, sender: sender, appURL: strings.TrimRight(appURL, "/")}
}

// WithCounter sets what the reminder counts; without one DueDigests finds
// nobody.
func (s *Service) WithCounter(c Counter) *Service {
	s.counter = c
	return s
}

// WithPlanner adds today's training to the reminder; without one it is about
// review only.
func (s *Service) WithPlanner(p Planner) *Service {
	s.planner = p
	return s
}

// DueDigests is the due digest's source (learning.DueSource): the learners in
// their reminder hour with a browser subscribed and something due or a
// workout scheduled today, each with the total Home shows. Counting only them keeps the hourly pass to a handful
// of learners rather than everyone with a review point.
func (s *Service) DueDigests(ctx context.Context, now time.Time) ([]learning.DueSummary, error) {
	if s.counter == nil {
		return nil, nil
	}
	ids, err := s.store.ReminderCandidates(ctx, now, Window)
	if err != nil {
		return nil, err
	}
	out := []learning.DueSummary{}
	for _, id := range ids {
		total, err := s.counter.DueTotal(ctx, id)
		if err != nil {
			// One learner's count failing must not cost the others theirs.
			slog.Warn("push: counting due reviews failed", "user", id, "error", err)
			continue
		}
		workout := ""
		if s.planner != nil {
			if workout, err = s.planner.PlannedToday(ctx, id); err != nil {
				// The review half still goes out without it.
				slog.Warn("push: reading today's training failed", "user", id, "error", err)
				workout = ""
			}
		}
		if total > 0 || workout != "" {
			out = append(out, learning.DueSummary{UserID: id, Due: total, Workout: workout})
		}
	}
	return out, nil
}

// vapid returns the key pair, making it on the first call ever.
func (s *Service) vapid(ctx context.Context) (Keys, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.keys != nil {
		return *s.keys, nil
	}
	keys, ok, err := s.store.VAPIDKeys(ctx)
	if err != nil {
		return Keys{}, err
	}
	if !ok {
		fresh, err := generateKeys()
		if err != nil {
			return Keys{}, err
		}
		if keys, err = s.store.SaveVAPIDKeys(ctx, fresh); err != nil {
			return Keys{}, err
		}
	}
	s.keys = &keys
	return keys, nil
}

// Settings returns the public key, the learner's hour and zone, and their
// subscribed browsers.
func (s *Service) Settings(ctx context.Context, userID uuid.UUID) (Settings, error) {
	keys, err := s.vapid(ctx)
	if err != nil {
		return Settings{}, err
	}
	hour, tz, _, err := s.store.Settings(ctx, userID)
	if err != nil {
		return Settings{}, err
	}
	subs, err := s.store.Subscriptions(ctx, userID)
	if err != nil {
		return Settings{}, err
	}
	endpoints := make([]string, 0, len(subs))
	for _, sub := range subs {
		endpoints = append(endpoints, sub.Endpoint)
	}
	return Settings{PublicKey: keys.Public, Hour: hour, Timezone: tz, Endpoints: endpoints}, nil
}

// Subscribe turns reminders on in one browser.
func (s *Service) Subscribe(ctx context.Context, userID uuid.UUID, sub Subscription) error {
	if err := ValidateEndpoint(sub.Endpoint); err != nil {
		return err
	}
	if !validKey(sub.P256dh, 80, 100) || !validKey(sub.Auth, 16, 32) {
		return fmt.Errorf("%w: the subscription's keys are malformed", ErrInvalid)
	}
	return s.store.Subscribe(ctx, userID, sub)
}

// Unsubscribe turns reminders off in one browser. Unknown endpoints are not an
// error: the result is the same.
func (s *Service) Unsubscribe(ctx context.Context, userID uuid.UUID, endpoint string) error {
	return s.store.Unsubscribe(ctx, userID, endpoint)
}

// SetHour sets the learner's local reminder hour.
func (s *Service) SetHour(ctx context.Context, userID uuid.UUID, hour int) error {
	if hour < 0 || hour > 23 {
		return fmt.Errorf("%w: hour must be 0 to 23", ErrInvalid)
	}
	return s.store.SetHour(ctx, userID, hour)
}

// Test sends a test reminder to every browser the learner subscribed, and
// returns how many accepted it.
func (s *Service) Test(ctx context.Context, userID uuid.UUID) (int, error) {
	subs, err := s.store.Subscriptions(ctx, userID)
	if err != nil {
		return 0, err
	}
	if len(subs) == 0 {
		return 0, fmt.Errorf("%w: reminders are not on in any browser", ErrInvalid)
	}
	_, _, language, err := s.store.Settings(ctx, userID)
	if err != nil {
		return 0, err
	}
	payload := s.message(words(language).test, "/settings/reminders", 0, language)
	return s.deliver(ctx, subs, payload), nil
}

// Notify implements learning.Notifier: the due digest calls it hourly for
// every learner with something due, and it sends at most one reminder a day.
func (s *Service) Notify(ctx context.Context, summary learning.DueSummary) error {
	subs, language, ok, err := s.store.ClaimReminder(ctx, summary.UserID, time.Now(), Window)
	if err != nil || !ok {
		return err
	}
	if s.deliver(ctx, subs, s.message(dueBody(summary.Due, summary.Workout, language), "/home", summary.Due, language)) == 0 {
		return fmt.Errorf("push: no browser accepted the reminder")
	}
	return nil
}

// deliver sends one payload to each subscription, forgets the ones reported
// gone, and returns how many accepted it.
func (s *Service) deliver(ctx context.Context, subs []Subscription, payload []byte) int {
	keys, err := s.vapid(ctx)
	if err != nil {
		slog.Error("push: no VAPID keys", "error", err)
		return 0
	}
	sent := 0
	for _, sub := range subs {
		// Checked again at send time: a row written before a rule tightened
		// must not reach a host the rule now refuses.
		if err := ValidateEndpoint(sub.Endpoint); err != nil {
			slog.Warn("push: skipped an endpoint", "error", err)
			continue
		}
		err := s.sender.Send(ctx, sub, payload, keys)
		switch {
		case err == nil:
			sent++
		case errors.Is(err, ErrGone):
			if err := s.store.Forget(ctx, sub.Endpoint); err != nil {
				slog.Warn("push: could not forget a gone subscription", "error", err)
			}
		default:
			slog.Warn("push: delivery failed", "error", err)
		}
	}
	return sent
}

// reminderWords is the reminder in one interface language.
type reminderWords struct {
	one, other, test string
	// workout is today's training alone; oneAnd and otherAnd are review and
	// training together.
	workout, oneAnd, otherAnd string
}

var reminderText = map[string]reminderWords{
	"en": {one: "1 thing is waiting for your review.", other: "%d things are waiting for your review.", test: "This is a test. Your review reminder will look like this.",
		workout: "Today's training: %s.", oneAnd: "1 thing is waiting for your review, and today's training is %s.", otherAnd: "%d things are waiting for your review, and today's training is %s."},
	"vi": {one: "Có 1 việc cần ôn đang chờ bạn.", other: "Có %d việc cần ôn đang chờ bạn.", test: "Đây là thông báo thử. Lời nhắc ôn của bạn sẽ trông như thế này.",
		workout: "Hôm nay có buổi tập: %s.", oneAnd: "Có 1 việc cần ôn đang chờ bạn, và hôm nay có buổi tập: %s.", otherAnd: "Có %d việc cần ôn đang chờ bạn, và hôm nay có buổi tập: %s."},
	"es": {one: "Tienes 1 cosa por repasar.", other: "Tienes %d cosas por repasar.", test: "Esto es una prueba. Así se verá tu recordatorio de repaso.",
		workout: "Hoy toca entrenar: %s.", oneAnd: "Tienes 1 cosa por repasar, y hoy toca entrenar: %s.", otherAnd: "Tienes %d cosas por repasar, y hoy toca entrenar: %s."},
	"pt": {one: "Você tem 1 coisa para revisar.", other: "Você tem %d coisas para revisar.", test: "Isto é um teste. Seu lembrete de revisão vai ficar assim.",
		workout: "Hoje tem treino: %s.", oneAnd: "Você tem 1 coisa para revisar, e hoje tem treino: %s.", otherAnd: "Você tem %d coisas para revisar, e hoje tem treino: %s."},
}

// words is the reminder's text in language, English for any other.
func words(language string) reminderWords {
	if w, ok := reminderText[language]; ok {
		return w
	}
	return reminderText["en"]
}

func dueBody(due int, workout, language string) string {
	w := words(language)
	switch {
	case workout != "" && due == 0:
		return fmt.Sprintf(w.workout, workout)
	case workout != "" && due == 1:
		return fmt.Sprintf(w.oneAnd, workout)
	case workout != "":
		return fmt.Sprintf(w.otherAnd, due, workout)
	case due == 1:
		return w.one
	}
	return fmt.Sprintf(w.other, due)
}

func validKey(k string, minLen, maxLen int) bool {
	if len(k) < minLen || len(k) > maxLen {
		return false
	}
	for _, r := range k {
		if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '=') {
			return false
		}
	}
	return true
}
