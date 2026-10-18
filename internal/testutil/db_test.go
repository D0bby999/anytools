package testutil

import (
	"os"
	"testing"
)

// The reason this package was forked from postclaw's: postclaw's TestDB skipped
// unconditionally, so every DB-backed assertion silently evaporated on a runner
// without a database — a green build that proved nothing. InCI is the switch
// that turns that skip into a failure.
func TestInCIRecognizesCIRunners(t *testing.T) {
	t.Setenv("CI", "1")
	if !InCI() {
		t.Fatal(`CI=1 must be recognized as CI`)
	}
	t.Setenv("CI", "true")
	if !InCI() {
		t.Fatal(`CI=true must be recognized as CI`)
	}
	t.Setenv("CI", "")
	if InCI() {
		t.Fatal("unset CI must not be recognized as CI")
	}
}

func TestTestDSNPrefersEnvOverride(t *testing.T) {
	t.Setenv("ANYTOOLS_TEST_DSN", "postgres://override/db")
	if got := TestDSN(); got != "postgres://override/db" {
		t.Fatalf("TestDSN = %q", got)
	}
	_ = os.Unsetenv("ANYTOOLS_TEST_DSN")
	t.Setenv("ANYTOOLS_TEST_DSN", "")
	t.Setenv("LONGPLAY_TEST_DSN", "") // the pre-rename twin would otherwise answer
	if got := TestDSN(); got != defaultTestDSN {
		t.Fatalf("TestDSN = %q, want default %q", got, defaultTestDSN)
	}
}
