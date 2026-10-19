package providers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func recorded(t *testing.T, status int, headers map[string]string, body string) (*httptest.Server, *[]byte) {
	t.Helper()
	var captured []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured, _ = io.ReadAll(r.Body)
		for k, v := range headers {
			w.Header().Set(k, v)
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, &captured
}

// providerFor builds an OpenAI-compatible provider against a test server,
// replacing the SSRF-hardened transport (which refuses loopback by design) with
// the default one. The guard itself is proven in internal/security.
func providerFor(name, base string) *OpenAIProvider {
	p := NewOpenAIProvider(name, "k", base, "test-model")
	p.client = &http.Client{Timeout: 10 * time.Second}
	return p
}

// Google's OpenAI shim parses the body with a strict protobuf parser and 400s on
// ANY field it does not know — for every call, even when the value is the
// neutral default. The agent loop sets frequency_penalty on every turn, so
// without this strip a perfectly valid Gemini key looks completely broken.
func TestGoogleShimStripsTheFieldsGoogleCannotParse(t *testing.T) {
	srv, captured := recorded(t, http.StatusOK, nil,
		`{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}`)

	p := providerFor("gemini_native", srv.URL)
	_, err := p.Chat(context.Background(), ChatRequest{
		Messages: []Message{{Role: "user", Content: "hi"}},
		Options: map[string]any{
			OptFrequencyPenalty:  0,
			OptRepetitionPenalty: 1.1,
			OptEnableThinking:    true,
			OptThinkingBudget:    100,
			OptTemperature:       0.5,
		},
	})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}

	var sent map[string]any
	if err := json.Unmarshal(*captured, &sent); err != nil {
		t.Fatalf("request not JSON: %v", err)
	}
	for _, forbidden := range []string{"frequency_penalty", "repetition_penalty", "enable_thinking", "thinking_budget"} {
		if _, present := sent[forbidden]; present {
			t.Errorf("%s reached Google's shim — it 400s the whole request on an unknown field", forbidden)
		}
	}
	// Everything the shim DOES accept must survive: stripping a supported field
	// would silently discard the caller's setting.
	if _, present := sent["temperature"]; !present {
		t.Error("temperature was stripped, but Google accepts it")
	}
}

// The shim check must match the HOST, not a substring of a user-supplied base
// URL: "https://evil.test/generativelanguage.googleapis.com/v1" contains the
// string without being Google.
func TestGoogleShimDetectionMatchesTheHostNotASubstring(t *testing.T) {
	if !providerFor("x", "https://generativelanguage.googleapis.com/v1beta/openai").isGoogleOpenAIShim() {
		t.Error("the real host was not recognised")
	}
	if providerFor("x", "https://evil.test/generativelanguage.googleapis.com/v1").isGoogleOpenAIShim() {
		t.Error("a path containing the host string was treated as Google")
	}
	if providerFor("x", "https://evil.test/openrouter.ai/v1").isOpenRouter() {
		t.Error("a path containing openrouter.ai was treated as OpenRouter")
	}
	if !providerFor("x", "https://openrouter.ai/api/v1").isOpenRouter() {
		t.Error("the real OpenRouter host was not recognised")
	}
}

// The measured silent failure, reproduced: a normal "stop" carrying nothing at
// all is an error, not an answer. Accepting it appends an empty assistant
// message to the transcript, which some gateways then 400 on.
func TestEmptyStopResponseIsAnError(t *testing.T) {
	srv, _ := recorded(t, http.StatusOK, nil,
		`{"choices":[{"message":{"content":""},"finish_reason":"stop"}]}`)

	p := providerFor("openai", srv.URL)
	p.retryConfig = RetryConfig{Attempts: 1}
	_, err := p.Chat(context.Background(), ChatRequest{Messages: []Message{{Role: "user", Content: "hi"}}})
	if !errors.Is(err, ErrEmptyResponse) {
		t.Fatalf("got %v, want ErrEmptyResponse", err)
	}
}

// A provider that tells us when it recovers knows better than our backoff
// guess — but the header may only EXTEND the wait, never shorten it, or a
// provider answering "Retry-After: 1" would pin the cooldown at one second
// forever and disable exponential backoff entirely.
func TestRetryAfterMayExtendButNeverShortenTheCooldown(t *testing.T) {
	long := ClassifyProviderError(&HTTPError{Status: 429, Body: "slow down", RetryAfter: 20 * time.Minute}, 0)
	if !long.FromRetryAfter || long.Duration != 20*time.Minute {
		t.Fatalf("a long Retry-After did not win: %+v", long)
	}

	short := ClassifyProviderError(&HTTPError{Status: 429, Body: "slow down", RetryAfter: time.Second}, 5)
	if short.FromRetryAfter {
		t.Fatalf("a short Retry-After overrode the backoff curve: %+v", short)
	}

	// Codex can report a 5-6 hour reset; honouring that verbatim would bench a
	// connection for the rest of the working day.
	capped := ClassifyProviderError(&HTTPError{Status: 429, Body: "x", RetryAfter: 6 * time.Hour}, 0)
	if capped.Duration > 30*time.Minute {
		t.Fatalf("an enormous Retry-After was honoured verbatim: %v", capped.Duration)
	}
}

// A period-quota exhaustion is not a per-minute rate limit: it must be benched
// until the allowance resets, not re-probed on the two-second curve.
func TestQuotaExhaustionIsDistinguishedFromARateLimit(t *testing.T) {
	quota := ClassifyProviderError(errors.New("429 free_tier quota exceeded"), 0)
	if !quota.QuotaExhausted {
		t.Fatal("a quota message did not classify as quota exhaustion")
	}
	if CooldownReason(quota) != "quota" {
		t.Fatalf("reason = %q, want quota", CooldownReason(quota))
	}

	// Gemini's free tier resets daily, so the connection sleeps to the boundary.
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	applied := ApplyQuotaResetCooldown(quota, ProviderGemini, now)
	if applied.Duration < 13*time.Hour {
		t.Fatalf("a daily-cadence provider was not benched to its reset boundary: %v", applied.Duration)
	}

	// A pay-as-you-go balance does not reset on a clock, so it keeps the
	// ordinary curve — naming a cadence it does not keep would park it for a day.
	unchanged := ApplyQuotaResetCooldown(quota, ProviderOpenAI, now)
	if unchanged.Duration != quota.Duration {
		t.Fatalf("an unknown cadence was given a reset bench: %v", unchanged.Duration)
	}

	blip := ClassifyProviderError(&HTTPError{Status: 503, Body: "upstream restarting"}, 0)
	if !blip.TransientBlip || blip.QuotaExhausted {
		t.Fatalf("a 503 classified as %+v", blip)
	}
}

// The registry must not carry postclaw's system_guard: it is a billing
// entitlement check for a product with billing, and AnyTools has none.
func TestRegistryHasNoBillingGuard(t *testing.T) {
	r := NewRegistry()
	p := providerFor("openai", "https://api.openai.com/v1")
	r.Register(p)
	got, err := r.Get("openai")
	if err != nil || got == nil {
		t.Fatalf("a registered provider was not returned: %v", err)
	}
}

// AnyLearn's own attribution, not postclaw's.
func TestOpenRouterAttributionIsAnyLearn(t *testing.T) {
	var referer, title string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		referer, title = r.Header.Get("HTTP-Referer"), r.Header.Get("X-Title")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}`)
	}))
	defer srv.Close()

	p := providerFor("openrouter", srv.URL)
	if _, err := p.Chat(context.Background(), ChatRequest{Messages: []Message{{Role: "user", Content: "hi"}}}); err != nil {
		t.Fatalf("chat: %v", err)
	}
	if strings.Contains(strings.ToLower(referer), "postclaw") || strings.Contains(strings.ToLower(title), "postclaw") {
		t.Fatalf("the port kept postclaw's OpenRouter attribution: %q / %q", referer, title)
	}
	if title != "AnyLearn" {
		t.Errorf("X-Title = %q, want AnyLearn", title)
	}
}

// A malformed tool-argument payload must NOT become an empty argument map that
// the agent loop then dispatches with zero arguments.
func TestToolArgumentParseFailureIsRecordedNotSwallowed(t *testing.T) {
	args, errMsg := parseToolArgs(`{"path": "unterminated`)
	if errMsg == "" {
		t.Fatal("a malformed argument payload parsed silently")
	}
	if len(args) != 0 {
		t.Fatalf("arguments were invented from a broken payload: %v", args)
	}

	args, errMsg = parseToolArgs("")
	if errMsg != "" || args == nil {
		t.Fatalf("a legitimate no-argument call was reported as an error: %v / %q", args, errMsg)
	}
}
