package calendar

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/google/uuid"
)

// service.go — the subscription feed (phase 2). Each learner has at most one
// feed URL, /cal/<token>.ics. The token is 32 random bytes; the table keeps
// its SHA-256 for the lookup and the token itself encrypted, so Learning apps
// can show the URL again. Rotating replaces both, and the old URL answers 404
// like one that never existed.

// ErrNoFeed reports a token that matches no feed.
var ErrNoFeed = errors.New("calendar: no such feed")

// Feed is a learner's feed settings.
type Feed struct {
	UserID    uuid.UUID `json:"-"`
	Token     string    `json:"token"`
	Named     bool      `json:"named"`
	Include   Include   `json:"include"`
	CreatedAt time.Time `json:"created_at"`
	// FetchedAt is when a calendar app last read the feed.
	FetchedAt *time.Time `json:"fetched_at,omitempty"`
}

// Store persists feeds and reads what they are built from.
type Store interface {
	GetFeed(ctx context.Context, userID uuid.UUID) (*Feed, error)
	// FeedByHash finds a feed by its token's hash; ErrNoFeed when none.
	FeedByHash(ctx context.Context, hash []byte) (*Feed, error)
	// SaveFeed creates or replaces the feed, token included.
	SaveFeed(ctx context.Context, f Feed, hash []byte) error
	UpdateFeedOptions(ctx context.Context, userID uuid.UUID, named bool, include Include) error
	MarkFetched(ctx context.Context, userID uuid.UUID, at time.Time) error
	// Source loads the events' inputs; the caller sets Include and Named.
	Source(ctx context.Context, userID uuid.UUID) (*Source, error)
}

// Service serves feeds.
type Service struct {
	store  Store
	appURL string
	now    func() time.Time
}

// NewService returns a Service.
func NewService(store Store, appURL string) *Service {
	return &Service{store: store, appURL: appURL, now: time.Now}
}

// SetClock replaces the clock, for tests.
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// Get returns the learner's feed, creating it on first use with every kind
// of event and generic titles.
func (s *Service) Get(ctx context.Context, userID uuid.UUID) (*Feed, error) {
	f, err := s.store.GetFeed(ctx, userID)
	if err == nil {
		return f, nil
	}
	if !errors.Is(err, ErrNoFeed) {
		return nil, err
	}
	return s.issue(ctx, Feed{UserID: userID, Include: Include{Review: true, Loop: true, Body: true}})
}

// Rotate replaces the token, keeping the options.
func (s *Service) Rotate(ctx context.Context, userID uuid.UUID) (*Feed, error) {
	f, err := s.Get(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.issue(ctx, Feed{UserID: userID, Named: f.Named, Include: f.Include})
}

// Update sets the options.
func (s *Service) Update(ctx context.Context, userID uuid.UUID, named bool, include Include) (*Feed, error) {
	if _, err := s.Get(ctx, userID); err != nil {
		return nil, err
	}
	if err := s.store.UpdateFeedOptions(ctx, userID, named, include); err != nil {
		return nil, err
	}
	return s.store.GetFeed(ctx, userID)
}

func (s *Service) issue(ctx context.Context, f Feed) (*Feed, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	f.Token = base64.RawURLEncoding.EncodeToString(raw)
	f.CreatedAt = s.now()
	if err := s.store.SaveFeed(ctx, f, HashToken(f.Token)); err != nil {
		return nil, err
	}
	return s.store.GetFeed(ctx, f.UserID)
}

// HashToken is the lookup key of a feed token.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// Events lists one learner's events as their feed options choose them.
func (s *Service) Events(ctx context.Context, userID uuid.UUID, named bool, include Include) (*Source, []Event, error) {
	src, err := s.store.Source(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	src.Named, src.Include, src.AppURL = named, include, s.appURL
	return src, Build(*src, s.now()), nil
}

// Render answers a calendar app's GET of a feed URL.
func (s *Service) Render(ctx context.Context, token string) ([]byte, error) {
	if len(token) < 20 || len(token) > 100 {
		return nil, ErrNoFeed
	}
	f, err := s.store.FeedByHash(ctx, HashToken(token))
	if err != nil {
		return nil, err
	}
	src, events, err := s.Events(ctx, f.UserID, f.Named, f.Include)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := WriteICS(&buf, Calendar{Name: Name(src.Language), Zone: Location(src.Zone).String(), Stamp: s.now(), Events: events}); err != nil {
		return nil, err
	}
	// Best effort: the card says when a calendar app last read the feed.
	_ = s.store.MarkFetched(ctx, f.UserID, s.now())
	return buf.Bytes(), nil
}
