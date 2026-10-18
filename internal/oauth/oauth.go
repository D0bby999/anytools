// Package oauth owns the two experimental subscription lanes: the ChatGPT
// relay and Gemini Code Assist.
//
// Both are OFF by default. ANYTOOLS_EXPERIMENTAL_SUBSCRIPTION_LANES=1 is what
// turns them on, and the reasons they are gated are not squeamishness:
//
//   - The ChatGPT lane cannot be AUTHORISED by a hosted server at all. postclaw's
//     flow is a PKCE loopback on the user's own 127.0.0.1:1455 that shells out
//     to a local browser, and OpenAI publishes no device flow
//     (reports/spike-providers.md, lane "Codex / ChatGPT relay — mechanism").
//     The only server-compatible shape is the relay: the user completes the
//     dance themselves and hands over the resulting token triple. This package
//     therefore RECEIVES tokens; it never starts an authorisation for that lane.
//   - The Gemini Code Assist lane asks for `cloud-platform` scope, so its
//     refresh token is a full Google Cloud credential for that user rather than
//     an AI quota. postclaw uses a third party's published installed-app client
//     id and secret for it; AnyTools does not ship those — see clientPair below.
//
// Neither lane is licensed for proxying. The Settings UI says so in the user's
// own words before either card can be used.
package oauth

import (
	"errors"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/security"
)

// ExperimentalLanesEnv gates both subscription lanes.
const ExperimentalLanesEnv = "ANYTOOLS_EXPERIMENTAL_SUBSCRIPTION_LANES"

// ExperimentalLanesEnabled reports whether the subscription lanes are on.
//
// Read through this function everywhere rather than inlining os.Getenv, so
// "what turns the lanes on" has exactly one answer and a test can assert the
// default is off.
func ExperimentalLanesEnabled() bool {
	return strings.TrimSpace(config.Getenv(ExperimentalLanesEnv)) == "1"
}

// newClient builds every outbound client in this package: SSRF-guarded, as
// all of this package's hosts are fixed public ones. A variable so the
// package's own tests can reach a local server.
var newClient = security.SafeClient

// ErrLanesDisabled is returned when a subscription-lane endpoint is reached
// with the flag off.
var ErrLanesDisabled = errors.New("oauth: subscription lanes are experimental and disabled")

// ErrNoClientPair is returned when the Gemini lane is used without a client id
// and secret configured.
var ErrNoClientPair = errors.New("oauth: no Google OAuth client configured for the Gemini Code Assist lane")

// Flow names one subscription lane. The value is persisted in
// ConnectionSettings.OAuth.Flow, so it is a wire contract with the database.
type Flow string

const (
	// FlowChatGPTRelay is the ChatGPT subscription, relay-only.
	FlowChatGPTRelay Flow = "chatgpt_relay"
	// FlowGeminiCodeAssist is the Gemini Code Assist subscription.
	FlowGeminiCodeAssist Flow = "gemini_code_assist"
)

// ServeRefreshLead is how far before expiry a token is refreshed.
//
// Five minutes, because a refresh happens on the serve path: a token that
// expires mid-request produces a 401 the chain will classify as a credentials
// failure and bench the connection for two minutes over a clock boundary.
const ServeRefreshLead = 5 * time.Minute

// TokenResult is what a refresh or an authorisation-code exchange produced.
type TokenResult struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
	Scope        string
	AccountID    string
}

// clientPair returns the Google OAuth client id and secret for the Gemini lane.
//
// DELIBERATE DEVIATION from the port: postclaw hardcodes a third party's
// published installed-app id and secret here (Antigravity's, with the retired
// Gemini CLI pair beside it). AnyTools does not ship someone else's credentials
// — using them is what makes the lane unlicensed impersonation rather than a
// user connecting their own account. The owner supplies their own pair, or the
// lane stays unavailable and says so.
func clientPair() (id, secret string, ok bool) {
	id = strings.TrimSpace(config.Getenv("ANYTOOLS_GEMINI_SUB_CLIENT_ID"))
	secret = strings.TrimSpace(config.Getenv("ANYTOOLS_GEMINI_SUB_CLIENT_SECRET"))
	return id, secret, id != "" && secret != ""
}
