package learning

import (
	"testing"
	"time"
)

func TestLocalDayUsesTheLearnersZone(t *testing.T) {
	const hcm = "Asia/Ho_Chi_Minh" // UTC+7
	at := func(s string) time.Time {
		v, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	// 06:30 and 07:30 in Ho Chi Minh City straddle midnight UTC (23:30 and
	// 00:30 UTC) but are the same local morning.
	a, b := LocalDay(at("2026-09-26T23:30:00Z"), hcm), LocalDay(at("2026-09-27T00:30:00Z"), hcm)
	if a != b {
		t.Fatalf("06:30 and 07:30 local fell on %v and %v", a, b)
	}
	if a.String() != "2026-09-27" {
		t.Fatalf("day = %s, want 2026-09-27", a)
	}
	// 23:30 and 00:30 local straddle the local midnight.
	c, d := LocalDay(at("2026-09-27T16:30:00Z"), hcm), LocalDay(at("2026-09-27T17:30:00Z"), hcm)
	if c == d || !c.Before(d) || d.Before(c) {
		t.Fatalf("23:30 and 00:30 local: %v, %v", c, d)
	}
	if got := StartOf(d, hcm); !got.Equal(at("2026-09-27T17:00:00Z")) {
		t.Fatalf("StartOf = %v, want local midnight 17:00Z", got)
	}
}

func TestLoadZoneRefusesUnknownAndServerZones(t *testing.T) {
	for _, bad := range []string{"", "Local", "Mars/Olympus", "../etc/passwd", "Asia/Ho_Chi_Minh; DROP"} {
		if _, err := LoadZone(bad); err == nil {
			t.Errorf("LoadZone(%q) accepted", bad)
		}
	}
	if _, err := LoadZone("Europe/Berlin"); err != nil {
		t.Errorf("Europe/Berlin: %v", err)
	}
	// A stored name that later stops loading falls back to UTC, not a panic.
	if got := LocalDay(time.Date(2026, 1, 2, 3, 0, 0, 0, time.UTC), "Mars/Olympus"); got.String() != "2026-01-02" {
		t.Errorf("fallback day = %s", got)
	}
}
