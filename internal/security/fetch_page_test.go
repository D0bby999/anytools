package security

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fixtureFetchClient is FetchClient's shape (redirect cap, no proxy) with a
// dialer that sends every name to srv, so the limits are tested without DNS.
func fixtureFetchClient(srv *httptest.Server) *http.Client {
	addr := strings.TrimPrefix(srv.URL, "http://")
	return FetchClientWith(5*time.Second, GuardedDialer{
		Lookup: lookupOf("93.184.216.34"),
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, addr)
		},
	})
}

func TestFetchPageEnforcesSizeTypeAndStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/page":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte("<html><title>ok</title></html>"))
		case "/exact":
			w.Header().Set("Content-Type", "application/pdf")
			_, _ = w.Write(make([]byte, MaxFetchBytes))
		case "/huge":
			// No Content-Length: the cap must hold while reading.
			w.Header().Set("Content-Type", "text/html")
			chunk := make([]byte, 1<<20)
			for i := 0; i < 8; i++ {
				_, _ = w.Write(chunk)
			}
		case "/image":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("png"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	client := fixtureFetchClient(srv)
	req := func(path string) PageRequest {
		return PageRequest{URL: "http://site.test" + path, Types: []string{"text/html", "application/pdf"}}
	}

	page, err := FetchPage(context.Background(), client, req("/page"))
	if err != nil || page.MediaType != "text/html" || !strings.Contains(string(page.Body), "ok") {
		t.Fatalf("page: %+v %v", page, err)
	}
	if page, err := FetchPage(context.Background(), client, req("/exact")); err != nil || len(page.Body) != MaxFetchBytes {
		t.Fatalf("exactly the cap must be accepted: %v", err)
	}
	if _, err := FetchPage(context.Background(), client, req("/huge")); !errors.Is(err, ErrPageTooLarge) {
		t.Fatalf("huge: err = %v, want ErrPageTooLarge", err)
	}
	if _, err := FetchPage(context.Background(), client, req("/image")); !errors.Is(err, ErrPageType) {
		t.Fatalf("image: err = %v, want ErrPageType", err)
	}
	var status *HTTPStatusError
	if _, err := FetchPage(context.Background(), client, req("/missing")); !errors.As(err, &status) || status.Status != 404 {
		t.Fatalf("missing: err = %v, want HTTP 404", err)
	}
	if _, err := FetchPage(context.Background(), client, PageRequest{URL: "http://127.0.0.1/", Types: []string{""}}); !errors.Is(err, ErrFetchURL) {
		t.Fatalf("a literal loopback URL must be refused before any request: %v", err)
	}
}

// The redirect cap is SafeClient's maxRedirects: CheckRedirect refuses the
// request once `via` holds that many, so a chain of two redirects is followed
// and a chain of four (or three) is not.
func TestFetchPageRefusesALongRedirectChain(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var n int
		if _, err := fmt.Sscanf(r.URL.Path, "/hop/%d", &n); err == nil && n > 0 {
			http.Redirect(w, r, fmt.Sprintf("/hop/%d", n-1), http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<p>end</p>"))
	}))
	defer srv.Close()
	client := fixtureFetchClient(srv)
	fetch := func(hops int) error {
		_, err := FetchPage(context.Background(), client, PageRequest{
			URL: fmt.Sprintf("http://site.test/hop/%d", hops), Types: []string{"text/html"}})
		return err
	}
	if err := fetch(2); err != nil {
		t.Fatalf("two redirects: %v", err)
	}
	if err := fetch(4); err == nil || !strings.Contains(err.Error(), "stopped after") {
		t.Fatalf("four redirects: err = %v, want the redirect cap", err)
	}
}

func TestAllowlistClientRefusesOtherHostsAndRedirectsOffTheList(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		switch r.URL.Path {
		case "/ok":
			_, _ = w.Write([]byte("ok"))
		case "/same":
			http.Redirect(w, r, "/ok", http.StatusFound)
		case "/away":
			http.Redirect(w, r, "http://evil.test/steal", http.StatusFound)
		}
	}))
	defer srv.Close()
	host := strings.TrimPrefix(srv.URL, "http://")
	client := AllowlistClientOver(srv.Client(), host)

	for _, path := range []string{"/ok", "/same"} {
		resp, err := client.Get(srv.URL + path)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		resp.Body.Close()
	}

	before := hits
	if _, err := client.Get("http://evil.test/"); !errors.Is(err, ErrHostNotAllowed) {
		t.Fatalf("other host: err = %v, want ErrHostNotAllowed", err)
	}
	// Same address, different spelling: the allowlist compares names, not IPs.
	if _, err := client.Get(strings.Replace(srv.URL, "127.0.0.1", "localhost", 1)); !errors.Is(err, ErrHostNotAllowed) {
		t.Fatalf("look-alike host: err = %v", err)
	}
	if hits != before {
		t.Fatalf("a refused host was requested anyway")
	}
	// Refused by CheckRedirect, before the hop is handed to the transport.
	if _, err := client.Get(srv.URL + "/away"); !errors.Is(err, ErrHostNotAllowed) ||
		!strings.Contains(err.Error(), "redirect to evil.test") {
		t.Fatalf("redirect off the list: err = %v, want a refused redirect", err)
	}
}

// The production constructor keeps SafeClient's dial-time guard underneath: an
// allowlisted name that resolves to loopback is still refused.
func TestAllowlistClientKeepsTheInternalAddressGuard(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("internal"))
	}))
	defer srv.Close()
	host := strings.TrimPrefix(srv.URL, "http://")
	_, err := AllowlistClient(5*time.Second, host).Get(srv.URL)
	if err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("err = %v, want a loopback refusal", err)
	}
}

func TestOpenStreamCapsWhileReading(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer t" {
			http.Error(w, "no", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/x-gzip")
		n := 1000
		if r.URL.Path == "/big" {
			n = 3000
		}
		_, _ = w.Write(make([]byte, n))
	}))
	defer srv.Close()
	client := fixtureFetchClient(srv)
	req := func(path string) PageRequest {
		return PageRequest{URL: "http://site.test" + path, Types: []string{"application/x-gzip"},
			Header: http.Header{"Authorization": {"Bearer t"}}}
	}

	s, err := OpenStream(context.Background(), client, req("/exact"), 1000)
	if err != nil {
		t.Fatal(err)
	}
	b, err := io.ReadAll(s.Body)
	_ = s.Body.Close()
	if err != nil || len(b) != 1000 {
		t.Fatalf("exactly the cap: %d bytes, %v", len(b), err)
	}

	s, err = OpenStream(context.Background(), client, req("/big"), 1000)
	if err != nil {
		t.Fatal(err)
	}
	b, err = io.ReadAll(s.Body)
	_ = s.Body.Close()
	if !errors.Is(err, ErrStreamTooLarge) || len(b) > 1000 {
		t.Fatalf("past the cap: %d bytes, %v", len(b), err)
	}

	noAuth := req("/exact")
	noAuth.Header = nil
	var status *HTTPStatusError
	if _, err := OpenStream(context.Background(), client, noAuth, 1000); !errors.As(err, &status) || status.Status != 401 {
		t.Fatalf("status: %v", err)
	}
}
