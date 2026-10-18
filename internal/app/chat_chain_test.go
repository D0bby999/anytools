package app

// chat_chain_test.go — the runtime ↔ BYOK seam, against real provider clients.
//
// These go through byok.Service, the real connection store and the real OpenAI
// client, with an httptest server standing in for the upstream. The cheaper
// version — a fake Chain — is not available and would not be worth much: the
// properties here are about what the chain does on a FAILURE, and the failure
// classification lives in internal/providers and reads a real HTTP status.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/oauth"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// lane is one fake upstream: it records the models it was asked for and answers
// however the test tells it to.
type lane struct {
	server *httptest.Server
	mu     sync.Mutex
	models []string
}

func (l *lane) seen() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.models...)
}

func (l *lane) record(body []byte) string {
	var req struct {
		Model string `json:"model"`
	}
	_ = json.Unmarshal(body, &req)
	l.mu.Lock()
	l.models = append(l.models, req.Model)
	l.mu.Unlock()
	return req.Model
}

// newLane serves POST /v1/chat/completions with `respond`.
func newLane(t *testing.T, respond func(l *lane, w http.ResponseWriter, body []byte)) *lane {
	t.Helper()
	l := &lane{}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		respond(l, w, body)
	})
	l.server = httptest.NewServer(mux)
	t.Cleanup(l.server.Close)
	return l
}

// answersWith streams one content delta and closes the stream properly.
func answersWith(text string) func(*lane, http.ResponseWriter, []byte) {
	return func(l *lane, w http.ResponseWriter, body []byte) {
		l.record(body)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "data: %s\n\n", mustChunk(text))
		fmt.Fprint(w, "data: [DONE]\n\n")
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
}

// refusesWith answers an HTTP error. 401 is used rather than 500 because it is
// classified as a credentials failure and is NOT retried by the client, which
// keeps the test measuring the CHAIN's behaviour rather than RetryDo's.
func refusesWith(status int) func(*lane, http.ResponseWriter, []byte) {
	return func(l *lane, w http.ResponseWriter, body []byte) {
		l.record(body)
		http.Error(w, `{"error":{"message":"nope"}}`, status)
	}
}

func mustChunk(text string) string {
	b, _ := json.Marshal(map[string]any{
		"choices": []any{map[string]any{"delta": map[string]any{"content": text}}},
	})
	return string(b)
}

// routeChat wires two openai_compat connections to the chat function, in order.
func routeChat(t *testing.T, conns *pg.ProviderConnectionStore, routes *pg.FunctionRouteStore,
	user uuid.UUID, entries ...struct{ base, model string }) {
	t.Helper()
	ctx := context.Background()
	inputs := make([]store.RouteEntryInput, 0, len(entries))
	for i, e := range entries {
		c, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
			Provider: "openai_compat", Kind: store.KindAPIKey,
			Name: fmt.Sprintf("lane-%d", i), APIBase: e.base + "/v1", Secret: "key",
		})
		if err != nil {
			t.Fatalf("create connection %d: %v", i, err)
		}
		inputs = append(inputs, store.RouteEntryInput{ConnectionID: c.ID, Model: e.model})
	}
	if err := routes.ReplaceRoute(ctx, user, "chat", inputs); err != nil {
		t.Fatalf("route chat: %v", err)
	}
}

func newBYOK(t *testing.T) (*byok.Service, *pg.ProviderConnectionStore, *pg.FunctionRouteStore, uuid.UUID) {
	t.Helper()
	// The BYOK egress client refuses loopback unless an operator opts in. The
	// fake upstream below IS loopback, so the hatch is opened for the test the
	// same way internal/api/byokapi's end-to-end flow opens it — and it is read
	// when the provider client is constructed, so it must be set before ChatFor.
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	pool := testutil.TestDB(t)
	key := testutil.TestEncryptionKey

	conns := pg.NewProviderConnectionStore(pool, key)
	routes := pg.NewFunctionRouteStore(pool, key)
	tokens, err := oauth.NewService(
		pg.NewOAuthCredentialStore(pool, key), conns, pg.NewConnectionLockStore(pool), nil, nil)
	if err != nil {
		t.Fatalf("oauth.NewService: %v", err)
	}
	svc := byok.NewService(conns, routes, pg.NewSearchConnectionStore(pool, key), tokens)
	// The chain's transient-blip grace is two real seconds. The behaviour is
	// worth asserting elsewhere; paying for it in every test here is not.
	svc.SetSleepForTest(func(time.Duration) {})
	return svc, conns, routes, testutil.NewUser(t, pool)
}

// A user who has routed nothing gets NO_PROVIDER, which the orchestrator marks
// not-retryable — correct, because the fix is in Settings and a "try again"
// button would spend another turn proving it.
func TestChatResolverRefusesWhenNothingIsRouted(t *testing.T) {
	svc, _, _, user := newBYOK(t)

	_, err := newChatResolver(svc).ChatFor(context.Background(), user, "chat")
	if !errors.Is(err, runtime.ErrNoProvider) {
		t.Fatalf("error = %v, want runtime.ErrNoProvider", err)
	}
}

// A function name that is not routable is the same answer, not a panic and not
// a 500: phase 7 will add capabilities that ask for "quiz", and a typo in one
// must not look like an outage.
func TestChatResolverRefusesAnUnknownFunction(t *testing.T) {
	svc, _, _, user := newBYOK(t)

	_, err := newChatResolver(svc).ChatFor(context.Background(), user, "telepathy")
	if !errors.Is(err, runtime.ErrNoProvider) {
		t.Fatalf("error = %v, want runtime.ErrNoProvider", err)
	}
}

// The headline behaviour: the first connection refuses, the second answers, and
// the turn row must name the SECOND. Recording the first is exactly the silent
// downgrade RT-14 is about — the user's data went somewhere they did not
// choose and nothing said so.
func TestASilentDowngradeIsRecordedAsTheLaneThatAnswered(t *testing.T) {
	svc, conns, routes, user := newBYOK(t)
	dead := newLane(t, refusesWith(http.StatusUnauthorized))
	live := newLane(t, answersWith("grounded answer"))

	routeChat(t, conns, routes, user,
		struct{ base, model string }{dead.server.URL, "model-a"},
		struct{ base, model string }{live.server.URL, "model-b"})

	provider, err := newChatResolver(svc).ChatFor(context.Background(), user, "chat")
	if err != nil {
		t.Fatalf("ChatFor: %v", err)
	}
	// Before any call, the chain reports its first choice — which is what the
	// capability emits as session metadata while the answer is still coming.
	if provider.DefaultModel() != "model-a" {
		t.Fatalf("model before the call = %q, want the first entry's", provider.DefaultModel())
	}

	var streamed strings.Builder
	resp, err := provider.ChatStream(context.Background(),
		runtime.ChatRequest{
			Messages: []runtime.Message{{Role: "user", Content: "hi"}},
			Model:    provider.DefaultModel(), // what the capability passes
		},
		func(c runtime.StreamChunk) { streamed.WriteString(c.Content) })
	if err != nil {
		t.Fatalf("ChatStream: %v", err)
	}
	if resp.Content != "grounded answer" || streamed.String() != "grounded answer" {
		t.Fatalf("content = %q / streamed %q", resp.Content, streamed.String())
	}

	if provider.DefaultModel() != "model-b" {
		t.Fatalf("model after the call = %q, want the lane that answered", provider.DefaultModel())
	}

	// And the fallback lane must have been asked for ITS OWN model. Carrying
	// the first entry's model across sends an OpenAI model id to Anthropic.
	if got := live.seen(); len(got) != 1 || got[0] != "model-b" {
		t.Fatalf("the second lane was asked for %v, want [model-b]", got)
	}
}

// A session's explicit model choice is not overwritten by the chain.
func TestAnExplicitModelHintSurvivesTheChain(t *testing.T) {
	svc, conns, routes, user := newBYOK(t)
	live := newLane(t, answersWith("ok"))
	routeChat(t, conns, routes, user, struct{ base, model string }{live.server.URL, "model-a"})

	provider, err := newChatResolver(svc).ChatFor(context.Background(), user, "chat")
	if err != nil {
		t.Fatalf("ChatFor: %v", err)
	}
	if _, err := provider.ChatStream(context.Background(), runtime.ChatRequest{
		Messages: []runtime.Message{{Role: "user", Content: "hi"}},
		Model:    "the-users-own-choice",
	}, func(runtime.StreamChunk) {}); err != nil {
		t.Fatalf("ChatStream: %v", err)
	}
	if got := live.seen(); len(got) != 1 || got[0] != "the-users-own-choice" {
		t.Fatalf("lane was asked for %v, want the session's model_hint", got)
	}
}

// Once a word has reached the browser, a failure must NOT be retried on another
// connection: the second lane starts its answer from the beginning, into a
// stream the reader is already watching, and no frame means "ignore the last
// four sentences".
func TestAPartlyStreamedAnswerIsNotRestartedOnAnotherConnection(t *testing.T) {
	svc, conns, routes, user := newBYOK(t)

	// Streams one delta, then hangs up without [DONE] — a dropped upstream.
	broken := newLane(t, func(l *lane, w http.ResponseWriter, body []byte) {
		l.record(body)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "data: %s\n\n", mustChunk("half an ans"))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		// Returning without [DONE] closes the body mid-stream.
	})
	spare := newLane(t, answersWith("a whole second answer"))

	routeChat(t, conns, routes, user,
		struct{ base, model string }{broken.server.URL, "model-a"},
		struct{ base, model string }{spare.server.URL, "model-b"})

	provider, err := newChatResolver(svc).ChatFor(context.Background(), user, "chat")
	if err != nil {
		t.Fatalf("ChatFor: %v", err)
	}

	var streamed strings.Builder
	_, callErr := provider.ChatStream(context.Background(),
		runtime.ChatRequest{Messages: []runtime.Message{{Role: "user", Content: "hi"}}},
		func(c runtime.StreamChunk) { streamed.WriteString(c.Content) })

	if callErr == nil {
		t.Fatal("a truncated stream was reported as success")
	}
	if streamed.String() != "half an ans" {
		t.Fatalf("the reader saw %q — a second lane appended to the first one's answer", streamed.String())
	}
	if n := len(spare.seen()); n != 0 {
		t.Fatalf("the spare lane was called %d times after content had already been delivered", n)
	}
}

// Solve's photographed problem crosses the runtime → providers seam and reaches
// the OpenAI-compatible wire as an image_url part on the user message. The
// runtime DTOs had narrowed images away; this pins that they are back and that
// the bytes arrive unmodified.
func TestAnImageReachesTheWireAsAnImagePart(t *testing.T) {
	svc, conns, routes, user := newBYOK(t)
	png, err := os.ReadFile("../capabilities/solve/testdata/algebra.png")
	if err != nil {
		t.Fatal(err)
	}
	encoded := base64.StdEncoding.EncodeToString(png)

	var sent []byte
	live := newLane(t, func(l *lane, w http.ResponseWriter, body []byte) {
		sent = body
		answersWith("x = 4")(l, w, body)
	})
	routeChat(t, conns, routes, user, struct{ base, model string }{live.server.URL, "vision-1"})

	provider, err := newChatResolver(svc).ChatFor(context.Background(), user, "chat")
	if err != nil {
		t.Fatalf("ChatFor: %v", err)
	}
	if _, err := provider.ChatStream(context.Background(), runtime.ChatRequest{
		Messages: []runtime.Message{{
			Role: "user", Content: "Solve the problem in the photo.",
			Images: []runtime.Image{{MimeType: "image/png", Data: encoded}},
		}},
	}, func(runtime.StreamChunk) {}); err != nil {
		t.Fatalf("ChatStream: %v", err)
	}

	var wire struct {
		Messages []struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(sent, &wire); err != nil || len(wire.Messages) != 1 {
		t.Fatalf("request body %s: %v", sent, err)
	}
	var parts []struct {
		Type     string `json:"type"`
		Text     string `json:"text"`
		ImageURL struct {
			URL string `json:"url"`
		} `json:"image_url"`
	}
	if err := json.Unmarshal(wire.Messages[0].Content, &parts); err != nil {
		t.Fatalf("user content is not a parts array: %s", wire.Messages[0].Content)
	}
	if len(parts) != 2 || parts[0].Type != "image_url" || parts[1].Text != "Solve the problem in the photo." {
		t.Fatalf("parts = %+v", parts)
	}
	if parts[0].ImageURL.URL != "data:image/png;base64,"+encoded {
		t.Fatal("the image bytes did not arrive intact")
	}
}
