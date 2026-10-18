package byok_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/rag/embed"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// VerifyErrorMessage is the only thing a user ever reads about a provider
// failure, so what it says — and what it refuses to say — is behaviour.

func TestVerifyErrorMessageClassifiesByStatus(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"401", &providers.HTTPError{Status: 401, Body: "unauthorized"}, "The provider rejected this key."},
		{"403", &providers.HTTPError{Status: 403, Body: "forbidden"}, "The provider rejected this key."},
		{"404", &providers.HTTPError{Status: 404, Body: "model not found"},
			"The provider does not know that model, or the base URL is wrong."},
		{"402", &providers.HTTPError{Status: 402, Body: "payment required"}, "This account has no credit left."},
		{"429", &providers.HTTPError{Status: 429, Body: "rate limited"},
			"This account is out of quota or rate-limited right now. Try again later."},
		{"503", &providers.HTTPError{Status: 503, Body: "upstream down"},
			"The provider is having trouble right now. Try again in a minute."},
		{"deadline", context.DeadlineExceeded, "The provider did not answer in time."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := byok.VerifyErrorMessage(tc.err); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

// Measured live on 2026-09-17: Google answers a bad Gemini key with HTTP 400,
// not 401 — through the plain endpoint as reason API_KEY_INVALID and through
// the OpenAI shim as "Please pass a valid API key". Classifying those as a
// generic 400 tells the user nothing about the one thing they can fix, which is
// why this case exists at all.
func TestVerifyErrorMessageRecognisesAGoogle400AsABadKey(t *testing.T) {
	bodies := []string{
		`{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}`,
		`gemini_native: [{ "error": { "code": 400, "message": "Please pass a valid API key", "status": "INVALID_ARGUMENT" } }]`,
		`{"error":{"type":"invalid_request_error","code":"invalid_api_key","message":"Incorrect API key provided"}}`,
	}
	for _, body := range bodies {
		got := byok.VerifyErrorMessage(&providers.HTTPError{Status: 400, Body: body})
		if got != "The provider rejected this key." {
			t.Errorf("body %.60s… classified as %q", body, got)
		}
	}
}

// The other direction matters just as much: a genuine request-shape 400 must
// NOT be reported as a bad key, or the user rotates a credential that was fine
// and the real problem stays.
func TestVerifyErrorMessageDoesNotBlameTheKeyForAShape400(t *testing.T) {
	got := byok.VerifyErrorMessage(&providers.HTTPError{
		Status: 400,
		Body:   `{"error":{"message":"Invalid JSON payload received. Unknown name \"frequency_penalty\": Cannot find field."}}`,
	})
	if got == "The provider rejected this key." {
		t.Fatalf("a request-shape 400 was blamed on the key")
	}
}

// A provider's error body can echo the request — prompt included — and can
// carry a key fragment. None of it may reach the user.
func TestVerifyErrorMessageNeverEchoesTheProviderBody(t *testing.T) {
	const leak = "AIzaSyD-secret-fragment-and-the-whole-user-prompt"
	for _, status := range []int{400, 401, 404, 429, 500, 418} {
		msg := byok.VerifyErrorMessage(&providers.HTTPError{Status: status, Body: leak})
		if strings.Contains(msg, "AIza") {
			t.Fatalf("status %d leaked the provider body: %q", status, msg)
		}
	}
}

// The allowlist's whole point: an error this package does not recognise gets a
// fixed sentence, never a reshaped fragment of the provider's response.
func TestVerifyErrorMessageNeverReshapesAnUnknownError(t *testing.T) {
	const leak = `{"error":{"message":"rejected key AIzaSyD-secret: and the user's whole prompt"}}`
	for _, err := range []error{
		errors.New(leak),
		fmt.Errorf("gemini: no candidate in response: %s", leak),
		fmt.Errorf("wrapped: %w", errors.New(leak)),
	} {
		got := byok.VerifyErrorMessage(err)
		if strings.Contains(got, "AIza") || strings.Contains(got, "prompt") {
			t.Fatalf("an unrecognised error leaked into the message: %q", got)
		}
		if got != "The verification call failed. Check the provider and the base URL." {
			t.Fatalf("unrecognised error produced %q, want the one fixed sentence", got)
		}
	}
}

// The recognised failures each get their own sentence, so the allowlist is not
// merely a way of saying nothing.
func TestVerifyErrorMessageClassifiesTheErrorsThisCodeRaises(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{byok.ErrEmptyCompletion, "The provider answered with nothing at all. Check the base URL."},
		{fmt.Errorf("openai: %w", providers.ErrEmptyResponse), "The provider answered with nothing at all. Check the base URL."},
		{fmt.Errorf("gemini: %w", parse.ErrNoCandidate), "The provider returned no document. It may have refused the request."},
		{fmt.Errorf("gemini: %w", parse.ErrEmptyDocument), "The provider could not read a one-page test document."},
		{fmt.Errorf("x: %w", embed.ErrDimensionMismatch), "The provider returned vectors of an unexpected width for this model."},
		{fmt.Errorf("g: %w", providers.ErrNoCodeAssistProject),
			"This Google account has no Code Assist tier. Sign in once at antigravity.google with it, then reconnect."},
	}
	for _, tc := range cases {
		if got := byok.VerifyErrorMessage(tc.err); got != tc.want {
			t.Errorf("%v\n got %q\nwant %q", tc.err, got, tc.want)
		}
	}
}

// A log line must not carry an upstream body either.
func TestSafeErrorTextDropsTheProviderBody(t *testing.T) {
	const leak = "AIzaSyD-secret-and-the-whole-document"
	got := byok.SafeErrorText(&providers.HTTPError{Status: 429, Body: leak})
	if strings.Contains(got, leak) {
		t.Fatalf("the provider body reached a log line: %q", got)
	}
	if got != "provider returned HTTP 429" {
		t.Fatalf("got %q", got)
	}
	// An error this code wrote is safe and is kept whole — that is what makes a
	// log useful at all.
	if got := byok.SafeErrorText(errors.New("begin tx: connection refused")); got != "begin tx: connection refused" {
		t.Fatalf("an internal error was redacted too: %q", got)
	}
}
