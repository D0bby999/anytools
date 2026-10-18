package search

import (
	"context"
	"strings"
)

// freshness.go — "only recent results", carried in the context so every
// client honours it without widening the Client interface.
//
// Values: "day", "week", "month", "year", or "" for no limit. Research sets it
// when the question is about something current ("latest", "this year");
// evergreen study topics leave it empty, which is the common case.

type freshnessKey struct{}

// Freshness values.
const (
	FreshDay   = "day"
	FreshWeek  = "week"
	FreshMonth = "month"
	FreshYear  = "year"
)

// WithFreshness returns ctx carrying a recency limit. An unknown value means
// no limit.
func WithFreshness(ctx context.Context, freshness string) context.Context {
	switch freshness {
	case FreshDay, FreshWeek, FreshMonth, FreshYear:
		return context.WithValue(ctx, freshnessKey{}, freshness)
	}
	return ctx
}

// FreshnessFrom returns the recency limit on ctx, or "".
func FreshnessFrom(ctx context.Context) string {
	f, _ := ctx.Value(freshnessKey{}).(string)
	return f
}

// NormalizeFreshness normalises a model-written recency word to one of the
// four values, or "".
func NormalizeFreshness(v string) string {
	switch v = strings.ToLower(strings.TrimSpace(v)); v {
	case FreshDay, FreshWeek, FreshMonth, FreshYear:
		return v
	}
	return ""
}
