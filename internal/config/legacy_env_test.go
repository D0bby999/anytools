package config

import (
	"bytes"
	"log/slog"
	"os"
	"strings"
	"testing"
)

// anytools-merge phase 1: for one release a LONGPLAY_* variable still counts
// when its ANYTOOLS_* twin is unset or empty, and never when the twin is set.
func TestLegacyEnvFallback(t *testing.T) {
	t.Setenv("ANYTOOLS_GATEWAY_TOKEN", "")
	t.Setenv("LONGPLAY_GATEWAY_TOKEN", "old-token")
	if got := Getenv("ANYTOOLS_GATEWAY_TOKEN"); got != "old-token" {
		t.Fatalf("unset new name: Getenv = %q, want the LONGPLAY_ value", got)
	}

	t.Setenv("ANYTOOLS_GATEWAY_TOKEN", "new-token")
	if got := Getenv("ANYTOOLS_GATEWAY_TOKEN"); got != "new-token" {
		t.Fatalf("set new name: Getenv = %q, want the ANYTOOLS_ value", got)
	}

	// Load reads through the same helper, so a deployment's old .env boots.
	t.Setenv("ANYTOOLS_POSTGRES_DSN", "")
	t.Setenv("ANYTOOLS_ENCRYPTION_KEY", "")
	t.Setenv("LONGPLAY_POSTGRES_DSN", "postgres://localhost/anytools_test?sslmode=disable")
	t.Setenv("LONGPLAY_ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load with LONGPLAY_* secrets: %v", err)
	}
	if cfg.Security.GatewayToken != "new-token" || !strings.Contains(cfg.Database.DSN, "anytools_test") {
		t.Fatalf("Load did not take the expected values")
	}

	// Only ANYTOOLS_ names fall back; any other name is read as is.
	t.Setenv("LONGPLAY_OTHER", "x")
	if got := Getenv("OTHER"); got != "" {
		t.Fatalf("Getenv(OTHER) = %q, want empty", got)
	}
}

// The boot warning names every LONGPLAY_* variable, never a value, and says
// nothing when there are none.
func TestWarnLegacyEnvNamesOnly(t *testing.T) {
	clearLegacy(t) // keep the caller's own environment out of the test

	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	WarnLegacyEnv(log)
	if buf.Len() != 0 {
		t.Fatalf("no LONGPLAY_* variables, yet a warning: %s", buf.String())
	}

	t.Setenv("LONGPLAY_SESSION_SECRET", "super-secret-value")
	t.Setenv("LONGPLAY_DOMAIN", "example.test")
	WarnLegacyEnv(log)
	out := buf.String()
	if strings.Count(out, "level=WARN") != 1 {
		t.Fatalf("want exactly one warning, got: %s", out)
	}
	for _, name := range []string{"LONGPLAY_SESSION_SECRET", "LONGPLAY_DOMAIN"} {
		if !strings.Contains(out, name) {
			t.Errorf("warning does not name %s: %s", name, out)
		}
	}
	for _, value := range []string{"super-secret-value", "example.test"} {
		if strings.Contains(out, value) {
			// Never print the line: if it leaks a test value it may leak a real one.
			t.Errorf("warning leaks the value of a LONGPLAY_* variable")
		}
	}
}

// clearLegacy unsets every LONGPLAY_* variable for the rest of the test.
// t.Setenv to "" leaves the name set, so a test that wants none must unset.
func clearLegacy(t *testing.T) {
	t.Helper()
	for _, name := range LegacyEnvNames() {
		t.Setenv(name, "") // restores the original value on cleanup
		_ = os.Unsetenv(name)
	}
}
