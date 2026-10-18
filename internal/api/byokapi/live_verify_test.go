package byokapi_test

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/testutil"
)

// live_verify_test.go — the same Settings journey as e2e_flow_test.go, against
// the owner's real Gemini account.
//
// OFF unless ANYTOOLS_LIVE_TESTS=1. A test that spends a real quota and fails
// when Google has an outage does not belong in the default suite; a test that
// nobody can run does not prove the wire format is right. Gating is how both
// are true at once.
//
// Credential rule, unchanged from the spikes: a value loaded here is passed
// straight into a request. It is never printed, never logged, never written to
// a file. Only the NAME of a credential and whether it was found may be
// reported, because "not found" is the reason a lane is skipped and has to be
// reportable.

func TestLiveGeminiKeyReachesGreenReadiness(t *testing.T) {
	if config.Getenv("ANYTOOLS_LIVE_TESTS") != "1" {
		t.Skip("live provider tests are off; set ANYTOOLS_LIVE_TESTS=1 to run them")
	}

	key, found := liveGeminiKey()
	if !found {
		t.Skip("BLOCKED: no Gemini API key found in ANYTOOLS_SPIKE_GEMINI_API_KEY, " +
			"a GEMINI_API_KEY in the dotenv files under ANYTOOLS_SPIKE_POSTCLAW_DIR, " +
			"or the 9router database at ANYTOOLS_SPIKE_9ROUTER_DB")
	}

	h := newHarness(t)
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)

	created := h.do(t, user, http.MethodPost, "/v1/byok/connections", map[string]any{
		"provider": "gemini", "name": "live gemini", "secret": key,
	})
	if created.Code != http.StatusCreated {
		// The body is AnyTools' own, not the provider's, so it is safe to show.
		t.Fatalf("add key: %d %s", created.Code, created.Body.String())
	}
	connID := decodeBody[map[string]any](t, created)["id"].(string)

	for _, fn := range []string{"chat", "embed", "parse"} {
		rec := h.do(t, user, http.MethodPost, "/v1/byok/connections/"+connID+"/verify",
			map[string]any{"function": fn})
		if rec.Code != http.StatusOK {
			t.Fatalf("verify %s: HTTP %d", fn, rec.Code)
		}
		result := decodeBody[map[string]any](t, rec)
		ok, _ := result["ok"].(bool)
		if !ok {
			msg, _ := result["message"].(string)
			// A credential the provider refuses is a BLOCKED lane, not a code
			// failure — the same verdict the phase-2 spikes used. Distinguishing
			// them matters: failing here on a revoked key would make a red suite
			// mean "the owner must rotate a key", which is not something the
			// code can fix and not something a reviewer should have to diagnose.
			// The message below is AnyTools' own one-sentence classification,
			// never the provider's body, so logging it cannot leak a fragment.
			if strings.Contains(msg, "rejected this key") || strings.Contains(msg, "no credit") ||
				strings.Contains(msg, "out of quota") {
				t.Skipf("BLOCKED: the provider refused the discovered Gemini credential for %s (%s) — "+
					"the owner must supply a working key in ANYTOOLS_SPIKE_GEMINI_API_KEY", fn, msg)
			}
			t.Fatalf("LIVE verify %s FAILED: %s", fn, msg)
		}
		t.Logf("LIVE verify %s PASS model=%v dims=%v", fn, result["model"], result["dims"])
	}

	for _, fn := range []string{"chat", "parse", "embed"} {
		if rec := h.do(t, user, http.MethodPut, "/v1/byok/routes/"+fn, map[string]any{
			"entries": []map[string]any{{"connection_id": connID}},
		}); rec.Code != http.StatusNoContent {
			t.Fatalf("route %s: %d %s", fn, rec.Code, rec.Body.String())
		}
	}

	readiness := decodeBody[byok.Readiness](t, h.do(t, user, http.MethodGet, "/v1/readiness", nil))
	if readiness.Core != byok.StatusGreen {
		t.Fatalf("LIVE core readiness = %q, want green: %+v", readiness.Core, readiness.Functions)
	}
	t.Log("LIVE Settings journey PASS: key added, verified for chat/parse/embed, routed, readiness green")
}

// liveGeminiKey finds a key the same way the phase-2 spikes did: the process
// environment first, then dotenv files in a directory outside this repo, then
// a local 9router database. The last two are read only when their variables
// name them; nothing on disk is searched by default. It returns only the value and whether
// it was found — never the source, which would narrow down where the secret
// lives.
func liveGeminiKey() (string, bool) {
	if v := strings.TrimSpace(config.Getenv("ANYTOOLS_SPIKE_GEMINI_API_KEY")); v != "" {
		return v, true
	}

	if dir := config.Getenv("ANYTOOLS_SPIKE_POSTCLAW_DIR"); dir != "" {
		for _, f := range []string{
			filepath.Join(dir, ".env.local"),
			filepath.Join(dir, "earn", ".env.local"),
			filepath.Join(dir, ".claude", ".env"),
		} {
			if v := readDotenvValue(f, "GEMINI_API_KEY"); v != "" {
				return v, true
			}
		}
	}

	if db := config.Getenv("ANYTOOLS_SPIKE_9ROUTER_DB"); db != "" {
		if v := readNineRouterKey(db, "gemini"); v != "" {
			return v, true
		}
	}
	return "", false
}

// readDotenvValue reads one key out of a dotenv file. Deliberately minimal —
// the same 25-line shape the spikes used, and not a dotenv implementation.
func readDotenvValue(path, key string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		k, v, ok := strings.Cut(line, "=")
		if !ok || strings.TrimSpace(k) != key {
			continue
		}
		v = strings.TrimSpace(v)
		if len(v) >= 2 && (v[0] == '"' && v[len(v)-1] == '"' || v[0] == '\'' && v[len(v)-1] == '\'') {
			v = v[1 : len(v)-1]
		}
		return v
	}
	return ""
}

// readNineRouterKey shells out to the sqlite3 CLI rather than linking a driver:
// a pure-Go SQLite driver would be a permanent dependency of the product for the
// sake of one optional test, and this repo builds with CGO off.
//
// The value is captured, never echoed: exec.Command's Output() keeps stdout in
// this process, so nothing reaches a terminal or a CI log.
func readNineRouterKey(dbPath, provider string) string {
	if _, err := os.Stat(dbPath); err != nil {
		return ""
	}
	bin, err := exec.LookPath("sqlite3")
	if err != nil {
		return ""
	}
	q := `select data from providerConnections where provider='` + provider +
		`' order by isActive desc, priority asc, createdAt asc limit 1;`
	out, err := exec.Command(bin, dbPath, q).Output()
	if err != nil {
		return ""
	}
	var m map[string]any
	if json.Unmarshal(out, &m) != nil {
		return ""
	}
	v, _ := m["apiKey"].(string)
	return v
}
