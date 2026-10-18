package app

import (
	"net/http"
	"regexp"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/oauth"
)

// A sign-in handle is bound to the user who started it. Bob presenting
// Alice's handle gets the same 404 as a handle that never existed, while
// Alice presenting it gets past that check (her wrong code is a 400) — so the
// 404 is the ownership check answering, not the route being unreachable.
func TestASignInHandleIsRefusedToAnotherUser(t *testing.T) {
	t.Setenv(oauth.ExperimentalLanesEnv, "1")
	env := newIsolationEnv(t)

	status, body := send(t, env.url, env.alice, http.MethodPost, "/v1/byok/connections/claude-sub/start", map[string]any{})
	if status != http.StatusOK {
		t.Fatalf("start: %d %s", status, body)
	}
	// send truncates bodies, so the handle is read with a pattern, not JSON.
	m := regexp.MustCompile(`"session_id":"([^"]+)"`).FindStringSubmatch(body)
	if m == nil {
		t.Fatalf("start body %q", body)
	}
	start := struct{ SessionID string }{m[1]}

	for _, path := range []string{"/v1/byok/connections/claude-sub/finish", "/v1/byok/connections/copilot/finish"} {
		status, body = send(t, env.url, env.bob, http.MethodPost, path,
			map[string]any{"session_id": start.SessionID, "code": "c#s"})
		if status != http.StatusNotFound {
			t.Errorf("Bob finishing Alice's sign-in at %s: %d %s, want 404", path, status, body)
		}
	}

	// Non-vacuous: the owner reaches the code check (state mismatch → 400).
	status, body = send(t, env.url, env.alice, http.MethodPost, "/v1/byok/connections/claude-sub/finish",
		map[string]any{"session_id": start.SessionID, "code": "c#not-the-state"})
	if status != http.StatusBadRequest || !strings.Contains(body, "different sign-in") {
		t.Fatalf("Alice with a mismatched code: %d %s, want 400", status, body)
	}
}
