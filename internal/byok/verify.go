package byok

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/feeds"
	"github.com/D0bby999/anytools/internal/connectors/github"
	"github.com/D0bby999/anytools/internal/connectors/zotero"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/providers/stt"
	"github.com/D0bby999/anytools/internal/rag/embed"
	"github.com/D0bby999/anytools/internal/rag/papers"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/rag/search"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store"
)

// VerifyResult is what a verify ping proved.
type VerifyResult struct {
	OK      bool
	Model   string
	Dims    int
	Message string
}

// verifyTimeout bounds a whole verify. It is a button press, so it must answer
// in a time a person will wait rather than inherit a generation budget.
const verifyTimeout = 90 * time.Second

// VerifyConnection makes one real call with the user's credential and records
// what happened.
//
// It is a REAL call, not a credential-shaped-correctly check, for the reason
// the spike measured: a stored api_base missing its version segment answers
// HTTP 200 with an empty body and finish_reason "stop". A verify that accepted
// a 200 would mark that connection green and the user would discover the truth
// as blank answers. So every probe below asserts on CONTENT, and an empty
// completion is a failure.
func (s *Service) VerifyConnection(ctx context.Context, userID, id uuid.UUID, fn Function) (*VerifyResult, error) {
	conn, err := s.conns.GetConnectionWithSecret(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if isSubscriptionKind(conn.Kind) && !s.lanesEnabled() {
		return nil, invalid("this connection's lane is disabled")
	}
	if !ConnectionSupports(conn.Provider, conn.Kind, fn) {
		return nil, invalid("%s cannot serve %s", conn.Provider, fn)
	}

	// Probe the model the user actually ROUTED, when there is one.
	//
	// Verifying the default instead is a quieter kind of wrong: it can pass
	// against a model the chain will never call, and for `openai_compat` — where
	// there IS no honest default, because the base URL is arbitrary — it sends
	// `"model": ""` and every verify fails with an unexplained 400. The routed
	// model is the thing the user needs told about.
	model, err := s.modelForVerify(ctx, userID, id, conn.Provider, fn)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(ctx, verifyTimeout)
	defer cancel()

	// A verify runs against a synthetic one-entry chain so the SAME client
	// construction, and the same cooldown/verify write-back, apply as on the
	// serve path. A separate construction path here is how "verify passes but
	// chat fails" happens.
	entry := store.ChainEntry{Position: 0, Model: model, Dims: conn.Settings.Dims, Connection: *conn}

	result := &VerifyResult{Model: entry.Model}
	var probeErr error

	switch KindOf(fn) {
	case KindParse:
		client, err := s.parserClient(ctx, userID, entry)
		if err != nil {
			return nil, err
		}
		result.Model = client.Model()
		probeErr = client.Ping(ctx)

	case KindTTS:
		client, err := s.ttsClient(ctx, userID, entry)
		if err != nil {
			return nil, err
		}
		result.Model = client.Model()
		probeErr = client.Ping(ctx)

	case KindSTT:
		// Gemini on the stt route reads video URLs with the parse model, so
		// its probe is the parse probe; the others hear one second of
		// silence and must answer 200 with a transcript (empty is fine).
		if conn.Provider == providers.ProviderGemini {
			client, err := s.parserClient(ctx, userID, entry)
			if err != nil {
				return nil, err
			}
			result.Model = client.Model()
			probeErr = client.Ping(ctx)
			break
		}
		client, err := s.sttClient(ctx, userID, entry)
		if err != nil {
			return nil, err
		}
		oc, ok := client.(*stt.OpenAICompat)
		if !ok {
			return nil, invalid("%s cannot transcribe speech", conn.Provider)
		}
		result.Model = oc.Model()
		probeErr = oc.Ping(ctx)

	case KindEmbed:
		client, err := s.embedClient(ctx, userID, entry)
		if err != nil {
			return nil, err
		}
		result.Model = client.Model()
		var dims int
		dims, probeErr = client.Ping(ctx)
		result.Dims = dims

	default:
		client, err := s.chatClient(ctx, userID, entry)
		if err != nil {
			return nil, err
		}
		result.Model = client.DefaultModel()
		probeErr = chatPing(ctx, client)
	}

	s.recordVerify(ctx, userID, id, result, probeErr)
	return result, nil
}

// modelForVerify picks which model a verify should exercise: the one this
// connection is routed with for that function, falling back to the provider's
// default.
//
// A provider with no default and no route is refused by NAME rather than
// probed with an empty model id — "choose a model under Routes" is a sentence
// the user can act on; "the provider refused the request (HTTP 400)" is not.
func (s *Service) modelForVerify(ctx context.Context, userID, id uuid.UUID, provider string, fn Function) (string, error) {
	chain, err := s.routes.ChainFor(ctx, userID, string(fn))
	if err != nil {
		return "", err
	}
	for _, e := range chain {
		if e.Connection.ID == id && e.Model != "" {
			return e.Model, nil
		}
	}
	if model := defaultModelFor(provider, fn); model != "" {
		return model, nil
	}
	return "", invalid("choose a model for this connection under Settings → Routes before verifying it")
}

// ErrEmptyCompletion is the zero-content non-tool completion the spike
// measured behind a misconfigured base URL. A sentinel, so VerifyErrorMessage
// can recognise it without matching on prose.
var ErrEmptyCompletion = errors.New("byok: the provider answered with an empty completion")

// chatPing sends the smallest useful completion and refuses an empty one.
func chatPing(ctx context.Context, p providers.Provider) error {
	resp, err := p.Chat(ctx, providers.ChatRequest{
		Messages: []providers.Message{
			{Role: "user", Content: "Reply with the single word: ready"},
		},
		Options: map[string]any{providers.OptMaxTokens: 32},
	})
	if err != nil {
		return err
	}
	// The zero-content non-tool completion the spike measured. Treating it as
	// success is the specific bug this line exists to prevent.
	if resp == nil || (strings.TrimSpace(resp.Content) == "" && len(resp.ToolCalls) == 0) {
		return ErrEmptyCompletion
	}
	return nil
}

// recordVerify writes the outcome to the connection so Settings and readiness
// agree with what just happened.
//
// The write runs on a DETACHED context, for the same reason the chain's does: a
// verify that used its whole budget is exactly the one whose result matters
// most, and writing it under the context that just expired would drop it.
func (s *Service) recordVerify(ctx context.Context, userID, id uuid.UUID, result *VerifyResult, probeErr error) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()

	if probeErr == nil {
		result.OK = true
		now := s.now()
		// json.Marshal, not fmt.Sprintf with %q: %q is GO quoting, not JSON
		// quoting, and a non-printable byte in a model id would render as \x7f
		// — invalid JSON, and the `settings || $3::jsonb` merge would reject the
		// whole patch. chain.go already does it this way.
		patch := map[string]any{
			"verify_status":   store.VerifyStatusVerified,
			"verified_model":  result.Model,
			"cooldown_until":  nil,
			"backoff_level":   0,
			"cooldown_reason": "",
		}
		if result.Dims > 0 {
			patch["dims"] = result.Dims
		}
		s.writeVerify(ctx, userID, id, patch, &now, "")
		return
	}

	result.OK = false
	result.Message = VerifyErrorMessage(probeErr)
	s.writeVerify(ctx, userID, id, map[string]any{"verify_status": store.VerifyStatusFailed}, nil, result.Message)
}

// writeVerify persists a verify outcome, and is LOUD when it cannot.
//
// The four writes here used to be `_ =`. A failed merge means the UI reports an
// outcome the database never recorded — a connection the user just watched turn
// green that is still unverified on the next page load — with nothing in the
// log to say so.
func (s *Service) writeVerify(ctx context.Context, userID, id uuid.UUID, patch map[string]any, verifiedAt *time.Time, lastError string) {
	raw, err := json.Marshal(patch)
	if err != nil {
		slog.Error("byok: marshal verify patch", "connection", id, "error", err)
		return
	}
	if err := s.conns.MergeConnectionSettings(ctx, userID, id, raw); err != nil {
		slog.Error("byok: could not record verify settings", "connection", id, "error", err)
	}
	if err := s.conns.SetVerifyResult(ctx, userID, id, verifiedAt, lastError); err != nil {
		slog.Error("byok: could not record verify result", "connection", id, "error", err)
	}
}

// VerifyErrorMessage turns a provider failure into one sentence for the user.
//
// The provider's own body is NEVER passed through. It can echo the request
// (prompt included), it can contain a key fragment, and it is written for a
// developer reading a terminal, not for someone deciding whether to paste a
// different key. What the user needs is which of the four things went wrong.
func VerifyErrorMessage(err error) string {
	var httpErr *providers.HTTPError
	if errors.As(err, &httpErr) {
		switch {
		case httpErr.Status == 401 || httpErr.Status == 403:
			return "The provider rejected this key."
		// Google answers a bad Gemini key with HTTP 400 and
		// reason API_KEY_INVALID, not 401 — measured live on 2026-09-17 while
		// verifying this phase. Without this branch the single most likely user
		// mistake (a typo, or a key from the wrong project) reports as "the
		// provider refused the request (HTTP 400)", which tells them nothing
		// about what to change.
		case httpErr.Status == 400 && looksLikeBadCredential(httpErr.Body):
			return "The provider rejected this key."
		case httpErr.Status == 404:
			return "The provider does not know that model, or the base URL is wrong."
		case httpErr.Status == 402:
			return "This account has no credit left."
		case httpErr.Status == 429:
			return "This account is out of quota or rate-limited right now. Try again later."
		case httpErr.Status >= 500:
			return "The provider is having trouble right now. Try again in a minute."
		}
		return fmt.Sprintf("The provider refused the request (HTTP %d).", httpErr.Status)
	}
	// Everything below is an ALLOWLIST. The previous version fell back to
	// reformatting err.Error(), which meant any error that embedded an upstream
	// body — and a provider body can echo the prompt or the document, and can
	// carry a key fragment — was reshaped and handed to the browser, then
	// persisted to last_error and rendered again. There is no string-shaping
	// fallback any more: an error this code does not recognise gets one fixed
	// sentence.
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "The provider did not answer in time."
	case errors.Is(err, ErrEmptyCompletion), errors.Is(err, providers.ErrEmptyResponse):
		return "The provider answered with nothing at all. Check the base URL."
	case errors.Is(err, providers.ErrStreamClosed):
		return "The provider closed the connection before finishing."
	case errors.Is(err, parse.ErrNoCandidate):
		return "The provider returned no document. It may have refused the request."
	case errors.Is(err, parse.ErrEmptyDocument), errors.Is(err, parse.ErrProbeTextMissing):
		return "The provider could not read a one-page test document."
	case errors.Is(err, embed.ErrDimensionMismatch):
		return "The provider returned vectors of an unexpected width for this model."
	case errors.Is(err, providers.ErrNoCodeAssistProject):
		return "This Google account has no Code Assist tier. Sign in once at antigravity.google with it, then reconnect."
	case errors.Is(err, stt.ErrBadResponse), errors.Is(err, stt.ErrResponseTooLarge):
		return "The provider's answer to one second of silence was not a transcript. Check the base URL and the model."
	case errors.Is(err, ErrInvalidInput):
		return UserMessage(err)
	}
	// A GitHub refusal's text is one of the connector's fixed sentences; it
	// never carries the token or anything GitHub sent.
	var ghErr *github.Error
	if errors.As(err, &ghErr) {
		return ghErr.Msg
	}
	// So is a Zotero refusal's, and the key in /keys/{key} never reaches it.
	var zErr *zotero.Error
	if errors.As(err, &zErr) {
		return upperFirst(zErr.Msg)
	}
	// Likewise a YouTube Data API refusal (up-methods phase 17).
	var ytErr *feeds.DataError
	if errors.As(err, &ytErr) {
		return ytErr.Msg
	}
	return "The verification call failed. Check the provider and the base URL."
}

// UserMessage strips the internal prefix from a validation error, leaving the
// sentence written for the user. Applied ONLY to errors this package created,
// never to anything that came back from a provider.
func UserMessage(err error) string {
	const prefix = "byok: invalid input: "
	msg := err.Error()
	if strings.HasPrefix(msg, prefix) {
		msg = msg[len(prefix):]
	}
	if msg == "" {
		return "That is not a valid request."
	}
	return strings.ToUpper(msg[:1]) + msg[1:]
}

// looksLikeBadCredential reports whether a 400 body is really an authentication
// failure wearing a validation status code.
//
// Matching on the provider's text is unpleasant and is kept as narrow as
// possible: only phrases that can ONLY mean a credential problem, so a genuine
// request-shape 400 is never mislabelled as a bad key and sent the user off
// rotating a credential that was fine.
func looksLikeBadCredential(body string) bool {
	lower := strings.ToLower(body)
	for _, marker := range []string{
		"api_key_invalid",   // Google
		"api key not valid", // Google, prose form
		"valid api key",     // Google's OpenAI shim: "Please pass a valid API key"
		"invalid api key",   // OpenAI-compatible gateways
		"invalid_api_key",   // OpenAI error code
		"incorrect api key", // OpenAI, prose form
		"unauthorized",      // generic gateways
		"authentication",    // "authentication_error" / "authentication failed"
	} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

// SafeErrorText renders an error for a LOG line with any upstream body removed.
//
// providers.HTTPError.Error() formats "HTTP %d: %s" including the provider's
// whole response, which is fine inside the chain's classification and is not
// fine in a log file: that body can contain the prompt, the document, or a
// fragment of the key that was rejected.
func SafeErrorText(err error) string {
	if err == nil {
		return ""
	}
	var httpErr *providers.HTTPError
	if errors.As(err, &httpErr) {
		return fmt.Sprintf("provider returned HTTP %d", httpErr.Status)
	}
	return err.Error()
}

// ListModels asks the provider which models this key may actually call.
//
// Only Gemini answers today, because it is the only lane with a list endpoint
// that a plain API key can read and whose result is meaningfully filtered (by
// generateContent support). For everyone else the routes editor falls back to
// the dated defaults in models.go plus free text, which is honest: an
// OpenAI-compatible base URL can serve any model id its operator chose.
func (s *Service) ListModels(ctx context.Context, userID, id uuid.UUID) ([]string, error) {
	conn, err := s.conns.GetConnectionWithSecret(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if conn.Provider != providers.ProviderGemini {
		return nil, invalid("%s does not publish a model list for an API key", conn.Provider)
	}
	return parse.GeminiListModels(ctx, conn.Secret, conn.APIBase)
}

// VerifySearchConnection makes one real search with the user's key.
func (s *Service) VerifySearchConnection(ctx context.Context, userID, id uuid.UUID) (*VerifyResult, error) {
	row, err := s.search.GetSearchConnectionWithSecret(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	var client interface{ Ping(context.Context) error }
	switch row.Provider {
	case ProviderOpenAlex:
		client = papers.NewOpenAlex(row.Secret)
	case ProviderGitHub:
		client = githubPing{c: s.githubClient(), token: row.Secret}
	case ProviderZotero:
		cred, err := zotero.ParseCredential(row.Secret)
		if err != nil {
			return nil, invalid("%s", err.Error())
		}
		client = zoteroPing{c: s.zoteroClient(), cred: cred}
	case ProviderYouTubeData:
		client = youtubeDataPing{d: s.youtubeDataClient(), key: row.Secret}
	default:
		if client, err = search.New(row.Provider, row.Secret); err != nil {
			return nil, err
		}
	}

	ctx, cancel := context.WithTimeout(ctx, verifyTimeout)
	defer cancel()

	result := &VerifyResult{Model: row.Provider}
	probeErr := client.Ping(ctx)

	// Detached, as above: the outcome of a verify that timed out is the outcome
	// the user most needs recorded.
	writeCtx, writeCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer writeCancel()

	var (
		verifiedAt *time.Time
		lastError  string
	)
	if probeErr != nil {
		result.Message = VerifyErrorMessage(probeErr)
		lastError = result.Message
	} else {
		now := s.now()
		result.OK = true
		verifiedAt = &now
	}
	if err := s.search.SetSearchVerifyResult(writeCtx, userID, id, verifiedAt, lastError); err != nil {
		slog.Error("byok: could not record search verify result", "connection", id, "error", err)
	}
	return result, nil
}

// githubPing checks a GitHub token with one rate-limit read.
type githubPing struct {
	c     *github.Client
	token string
}

func (g githubPing) Ping(ctx context.Context) error { return g.c.Ping(ctx, g.token) }

// githubClient is the allowlisted GitHub client; tests aim it at a fixture.
func (s *Service) githubClient() *github.Client {
	if s.github != nil {
		return s.github
	}
	return github.NewClient(security.FetchClient(verifyTimeout))
}

// UseGitHubClient replaces the GitHub client verify uses (tests).
func (s *Service) UseGitHubClient(c *github.Client) { s.github = c }

// zoteroPing checks a Zotero key with one call to /keys/{key}.
type zoteroPing struct {
	c    *zotero.Client
	cred zotero.Credential
}

func (z zoteroPing) Ping(ctx context.Context) error { return z.c.Verify(ctx, z.cred) }

// zoteroClient is the allowlisted Zotero client; tests aim it at a fixture.
func (s *Service) zoteroClient() *zotero.Client {
	if s.zotero != nil {
		return s.zotero
	}
	return zotero.NewClient(security.FetchClient(verifyTimeout))
}

// UseZoteroClient replaces the Zotero client verify uses (tests).
func (s *Service) UseZoteroClient(c *zotero.Client) { s.zotero = c }

func upperFirst(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// youtubeDataPing checks a YouTube Data API key with one one-unit read.
type youtubeDataPing struct {
	d   *feeds.Data
	key string
}

func (y youtubeDataPing) Ping(ctx context.Context) error { return y.d.Ping(ctx, y.key) }

// youtubeDataClient is the Data API client over the guarded dialer; tests
// aim it at a fixture.
func (s *Service) youtubeDataClient() *feeds.Data {
	if s.youtubeData != nil {
		return s.youtubeData
	}
	return feeds.NewData(security.FetchClient(verifyTimeout))
}

// UseYouTubeDataClient replaces the Data API client verify uses (tests).
func (s *Service) UseYouTubeDataClient(d *feeds.Data) { s.youtubeData = d }
