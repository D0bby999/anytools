package crawl_test

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/connectors/crawl"
	"github.com/D0bby999/anytools/internal/security"
)

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestScopeIsTheStartURLsOriginAndDirectory(t *testing.T) {
	s := crawl.NewScope(mustURL(t, "https://Docs.Example.com/guide/intro"))
	if s.Prefix != "/guide/" || s.Host != "docs.example.com" {
		t.Fatalf("scope %+v", s)
	}
	for raw, want := range map[string]bool{
		"https://docs.example.com/guide/":          true,
		"https://docs.example.com/guide":           true,
		"https://docs.example.com/guide/a/b":       true,
		"https://docs.example.com/guidebook":       false,
		"https://docs.example.com/blog/":           false,
		"http://docs.example.com/guide/x":          false, // another scheme is another origin
		"https://evil.example.com/guide/x":         false,
		"https://docs.example.com:8443/guide/x":    false,
		"https://docs.example.com:443/guide/x#top": true,
	} {
		if got := s.Allows(mustURL(t, raw)); got != want {
			t.Errorf("Allows(%s) = %v, want %v", raw, got, want)
		}
	}
	if p := crawl.NewScope(mustURL(t, "https://x.example.com")).Prefix; p != "/" {
		t.Errorf("a bare host scopes to %q", p)
	}
	if p := crawl.NewScope(mustURL(t, "https://x.example.com/docs/")).Prefix; p != "/docs/" {
		t.Errorf("a directory scopes to %q", p)
	}
}

func TestLinksAreInScopeCanonicalAndDeduplicated(t *testing.T) {
	page := mustURL(t, "https://docs.example.com/guide/intro")
	body := []byte(`<html><body>
		<a href="setup">Setup</a>
		<a href="/guide/setup#install">Setup again</a>
		<a href="../blog/post">Off prefix</a>
		<a href="https://other.example.com/guide/x">Off origin</a>
		<a href="mailto:a@example.com">Mail</a>
		<a href="logo.png">Image</a>
		<a href="#top">Fragment</a>
		<a href="intro">Self</a>
		<a href="ref/api.pdf">PDF</a>
	</body></html>`)
	got := crawl.Links(body, page, crawl.NewScope(page))
	var urls []string
	for _, u := range got {
		urls = append(urls, u.String())
	}
	want := []string{"https://docs.example.com/guide/setup", "https://docs.example.com/guide/ref/api.pdf"}
	if strings.Join(urls, " ") != strings.Join(want, " ") {
		t.Fatalf("links %v, want %v", urls, want)
	}

	// <base href> moves where relative links resolve.
	based := crawl.Links([]byte(`<base href="/guide/v2/"><a href="a">a</a>`), page, crawl.NewScope(page))
	if len(based) != 1 || based[0].Path != "/guide/v2/a" {
		t.Fatalf("base href ignored: %v", based)
	}
}

// fixture is a TLS server reached as https://docs.example.com through the
// production fetch client's shape: the guarded dialer believes the name
// resolves to a public address and dials the fixture.
func fixture(t *testing.T, h http.Handler) *http.Client {
	t.Helper()
	srv := httptest.NewTLSServer(h)
	t.Cleanup(srv.Close)
	addr := srv.Listener.Addr().String()
	c := security.FetchClientWith(5*time.Second, security.GuardedDialer{
		Lookup: func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		},
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, addr)
		},
	})
	c.Transport.(*http.Transport).TLSClientConfig = srv.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
	return c
}

func TestARedirectOffThePrefixIsNotFollowed(t *testing.T) {
	var offHits int
	var mu sync.Mutex
	client := fixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/guide/moved":
			http.Redirect(w, r, "/blog/elsewhere", http.StatusFound)
		case "/guide/inside":
			http.Redirect(w, r, "/guide/landed", http.StatusFound)
		case "/blog/elsewhere":
			mu.Lock()
			offHits++
			mu.Unlock()
			fallthrough
		default:
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte("<p>ok</p>"))
		}
	}))
	scope := crawl.NewScope(mustURL(t, "https://example.com/guide/"))
	scoped := scope.Client(client)

	_, err := security.FetchPage(context.Background(), scoped, security.PageRequest{
		URL: "https://example.com/guide/moved", Types: []string{"text/html"}})
	if !errors.Is(err, crawl.ErrOffScope) {
		t.Fatalf("redirect off the prefix: %v", err)
	}
	if offHits != 0 {
		t.Fatalf("the off-prefix page was fetched %d times", offHits)
	}
	got, err := security.FetchPage(context.Background(), scoped, security.PageRequest{
		URL: "https://example.com/guide/inside", Types: []string{"text/html"}})
	if err != nil || got.FinalURL.Path != "/guide/landed" {
		t.Fatalf("redirect inside the prefix: %v %v", got, err)
	}
}

func TestAPrivateAddressIsRefusedThroughTheScopedClient(t *testing.T) {
	// The scoped client keeps the guarded transport: a name that resolves to
	// a private address is refused at dial time.
	c := security.FetchClientWith(2*time.Second, security.GuardedDialer{
		Lookup: func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("10.0.0.7")}}, nil
		},
		Dial: (&net.Dialer{}).DialContext,
	})
	scoped := crawl.NewScope(mustURL(t, "https://intranet.example.com/")).Client(c)
	_, err := security.FetchPage(context.Background(), scoped, security.PageRequest{
		URL: "https://intranet.example.com/", Types: []string{"text/html"}})
	if err == nil || !security.IsInternalAddress(err) {
		t.Fatalf("private address: %v", err)
	}
	// A literal one never gets as far as a dial.
	if _, err := security.FetchPage(context.Background(), scoped, security.PageRequest{
		URL: "https://127.0.0.1/", Types: []string{"text/html"}}); err == nil {
		t.Fatal("loopback literal fetched")
	}
}

func TestLimiterSpacesOneHostAndCapsConcurrency(t *testing.T) {
	if crawl.MaxConcurrent != 4 || crawl.HostGap != 500*time.Millisecond {
		t.Fatalf("limits drifted: %d at once, %v per host", crawl.MaxConcurrent, crawl.HostGap)
	}
	gap := 60 * time.Millisecond
	l := crawl.NewLimiter(2, gap)
	ctx := context.Background()

	var starts []time.Time
	for i := 0; i < 3; i++ {
		release, err := l.Acquire(ctx, "a.example.com")
		if err != nil {
			t.Fatal(err)
		}
		starts = append(starts, time.Now())
		release()
	}
	for i := 1; i < len(starts); i++ {
		if d := starts[i].Sub(starts[i-1]); d < gap-5*time.Millisecond {
			t.Errorf("request %d came %v after the previous one; the gap is %v", i, d, gap)
		}
	}

	// Two slots: a third host waits until one is released.
	r1, _ := l.Acquire(ctx, "b.example.com")
	r2, _ := l.Acquire(ctx, "c.example.com")
	waitCtx, cancel := context.WithTimeout(ctx, 40*time.Millisecond)
	defer cancel()
	if _, err := l.Acquire(waitCtx, "d.example.com"); err == nil {
		t.Fatal("a third request ran while two held the slots")
	}
	r1()
	r3, err := l.Acquire(ctx, "d.example.com")
	if err != nil {
		t.Fatal(err)
	}
	r2()
	r3()
}

func TestRobotsGroupsAndLongestMatch(t *testing.T) {
	body := `User-agent: *
Disallow: /private/
Allow: /private/open

User-agent: AnyTools
Disallow: /guide/internal
Allow: /guide/internal/public$
`
	for raw, want := range map[string]bool{
		// The named group applies, so * rules do not.
		"https://x.example.com/private/secret":         true,
		"https://x.example.com/guide/internal/x":       false,
		"https://x.example.com/guide/internal/public":  true,
		"https://x.example.com/guide/internal/public2": false,
		"https://x.example.com/guide/ok":               true,
	} {
		if got := crawl.Permits(body, crawl.Agent, mustURL(t, raw)); got != want {
			t.Errorf("Permits(%s) = %v, want %v", raw, got, want)
		}
	}
	star := "User-agent: *\nDisallow: /private/\nAllow: /private/open\n"
	if crawl.Permits(star, crawl.Agent, mustURL(t, "https://x.example.com/private/x")) {
		t.Error("the * group was not applied")
	}
	if !crawl.Permits(star, crawl.Agent, mustURL(t, "https://x.example.com/private/open")) {
		t.Error("the longer Allow lost")
	}
}
