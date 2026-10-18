package providers

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

// The stored GitHub token is exchanged for a session token, and chat goes out
// with that session token and the editor identity — never the GitHub token.
func TestCopilotExchangesTheGitHubTokenAndSendsTheEditorIdentity(t *testing.T) {
	exchanges := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			exchanges++
			if r.Header.Get("Authorization") != "token gho_x" {
				t.Errorf("exchange auth = %q", r.Header.Get("Authorization"))
			}
			exp := time.Now().Add(25 * time.Minute).Unix()
			_, _ = io.WriteString(w, `{"token":"sess-1","expires_at":`+strconv.FormatInt(exp, 10)+`}`)
		case "/chat/completions":
			if r.Header.Get("Authorization") != "Bearer sess-1" {
				t.Errorf("chat auth = %q", r.Header.Get("Authorization"))
			}
			if r.Header.Get("Copilot-Integration-Id") != "vscode-chat" || r.Header.Get("Editor-Version") == "" {
				t.Error("chat went out without the editor identity")
			}
			_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}`)
		}
	}))
	defer srv.Close()

	p := NewCopilotProvider(StaticToken("gho_x"), "")
	p.sessionURL, p.apiBase, p.client = srv.URL+"/token", srv.URL, &http.Client{Timeout: 5 * time.Second}
	for i := 0; i < 2; i++ {
		resp, err := p.Chat(context.Background(), ChatRequest{Messages: []Message{{Role: "user", Content: "hi"}}})
		if err != nil || resp.Content != "ok" {
			t.Fatalf("chat %d: %v %+v", i, err, resp)
		}
	}
	if exchanges != 1 {
		t.Fatalf("a live session token was exchanged %d times, want once", exchanges)
	}
	if p.DefaultModel() != DefaultCopilotModel {
		t.Fatalf("default model = %q", p.DefaultModel())
	}
}

// A refused exchange (no seat, revoked token) is an HTTPError, so the chain
// classifies it as a credentials failure rather than an outage.
func TestCopilotRefusedExchangeIsAClassifiableHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()
	p := NewCopilotProvider(StaticToken("gho_x"), "m")
	p.sessionURL, p.client = srv.URL, &http.Client{Timeout: 5 * time.Second}
	_, err := p.Chat(context.Background(), ChatRequest{Messages: []Message{{Role: "user", Content: "hi"}}})
	var he *HTTPError
	if !errors.As(err, &he) || he.Status != http.StatusForbidden {
		t.Fatalf("err = %v, want HTTPError 403", err)
	}
}
