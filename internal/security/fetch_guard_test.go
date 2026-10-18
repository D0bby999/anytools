package security

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// recordingDial never touches the network. It records what the guard asked it
// to dial, so a test can prove an internal address was never even attempted.
type recordingDial struct {
	mu     sync.Mutex
	dialed []string
}

func (r *recordingDial) Dial(_ context.Context, _, address string) (net.Conn, error) {
	r.mu.Lock()
	r.dialed = append(r.dialed, address)
	r.mu.Unlock()
	client, server := net.Pipe()
	_ = server.Close()
	return client, nil
}

func lookupOf(ips ...string) LookupFunc {
	return func(context.Context, string) ([]net.IPAddr, error) {
		out := make([]net.IPAddr, 0, len(ips))
		for _, s := range ips {
			out = append(out, net.IPAddr{IP: net.ParseIP(s)})
		}
		return out, nil
	}
}

func TestGuardedDialerRefusesInternalAddresses(t *testing.T) {
	cases := []struct {
		name    string
		address string
		records []string
		want    error
	}{
		{"localhost name", "localhost:80", []string{"127.0.0.1"}, ErrSSRFLoopback},
		{"loopback literal", "127.0.0.1:80", nil, ErrSSRFLoopback},
		{"ipv6 loopback", "[::1]:443", nil, ErrSSRFLoopback},
		{"10/8", "intranet.test:80", []string{"10.1.2.3"}, ErrSSRFPrivateIP},
		{"172.16/12", "db.test:5432", []string{"172.20.0.5"}, ErrSSRFPrivateIP},
		{"192.168/16", "router.test:80", []string{"192.168.1.1"}, ErrSSRFPrivateIP},
		{"cloud metadata", "169.254.169.254:80", nil, ErrSSRFLinkLocal},
		{"metadata by name", "metadata.test:80", []string{"169.254.169.254"}, ErrSSRFLinkLocal},
		{"ipv6 link-local", "[fe80::1]:80", nil, ErrSSRFLinkLocal},
		{"ipv6 ULA", "ula.test:443", []string{"fd12:3456:789a::1"}, ErrSSRFPrivateIP},
		{"unspecified", "0.0.0.0:80", nil, ErrSSRFPrivateIP},
		{"carrier-grade NAT", "cgn.test:80", []string{"100.64.0.1"}, ErrSSRFPrivateIP},
		// One public record and one private one: refused, not raced.
		{"mixed records", "mixed.test:443", []string{"93.184.216.34", "10.0.0.7"}, ErrSSRFPrivateIP},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recordingDial{}
			d := GuardedDialer{Lookup: lookupOf(tc.records...), Dial: rec.Dial}
			_, err := d.DialContext(context.Background(), "tcp", tc.address)
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if len(rec.dialed) != 0 {
				t.Fatalf("an internal address was dialled: %v", rec.dialed)
			}
		})
	}
}

// DNS rebinding: a name that answers public on one lookup and internal on the
// next. The guard resolves on every dial and dials only what it checked, so the
// second answer is refused rather than connected to.
func TestGuardedDialerDefeatsDNSRebinding(t *testing.T) {
	var mu sync.Mutex
	answers := []string{"93.184.216.34", "169.254.169.254"}
	lookup := func(context.Context, string) ([]net.IPAddr, error) {
		mu.Lock()
		defer mu.Unlock()
		ip := answers[0]
		if len(answers) > 1 {
			answers = answers[1:]
		}
		return []net.IPAddr{{IP: net.ParseIP(ip)}}, nil
	}
	rec := &recordingDial{}
	d := GuardedDialer{Lookup: lookup, Dial: rec.Dial}

	conn, err := d.DialContext(context.Background(), "tcp", "rebind.test:443")
	if err != nil {
		t.Fatalf("first (public) answer: %v", err)
	}
	_ = conn.Close()
	if _, err := d.DialContext(context.Background(), "tcp", "rebind.test:443"); !errors.Is(err, ErrSSRFLinkLocal) {
		t.Fatalf("rebound answer: err = %v, want link-local refusal", err)
	}
	if len(rec.dialed) != 1 || rec.dialed[0] != "93.184.216.34:443" {
		t.Fatalf("dialled %v, want only the checked public address, pinned", rec.dialed)
	}
}

func TestCheckFetchURL(t *testing.T) {
	for _, raw := range []string{
		"file:///etc/passwd",
		"gopher://example.org/",
		"ftp://example.org/",
		"https://user:pass@example.org/",
		"http://localhost:8080/admin",
		"http://api.localhost/",
		"http://127.0.0.1/",
		"http://[::1]/",
		"http://169.254.169.254/latest/meta-data/",
		"http://10.0.0.1/",
		"http://[fd00::1]/",
		"https:///nohost",
	} {
		if _, err := CheckFetchURL(raw); !errors.Is(err, ErrFetchURL) {
			t.Errorf("%s: err = %v, want refusal", raw, err)
		}
	}
	for _, raw := range []string{"https://example.org/a?b=c", "http://93.184.216.34/"} {
		if _, err := CheckFetchURL(raw); err != nil {
			t.Errorf("%s: refused: %v", raw, err)
		}
	}
}

// The production client, end to end: a real server on loopback is not
// reachable, directly or through a public-looking redirect.
func TestFetchClientRefusesLoopbackEvenViaRedirect(t *testing.T) {
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("secret"))
	}))
	defer internal.Close()

	client := FetchClient(5 * time.Second)
	if _, err := client.Get(internal.URL); err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("direct: err = %v, want a loopback refusal", err)
	}

	// A redirect hop is dialled through the same guard.
	rec := &recordingDial{}
	redirector := GuardedDialer{
		Lookup: lookupOf("93.184.216.34"),
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			if address == "93.184.216.34:80" {
				// Pretend the public host answered with a redirect inward.
				c1, c2 := net.Pipe()
				go func() {
					defer c2.Close()
					buf := make([]byte, 4096)
					_, _ = c2.Read(buf)
					_, _ = c2.Write([]byte("HTTP/1.1 302 Found\r\nLocation: " + internal.URL +
						"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"))
				}()
				return c1, nil
			}
			return rec.Dial(ctx, network, address)
		},
	}
	_, err := FetchClientWith(5*time.Second, redirector).Get("http://public.test/")
	if err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("redirect: err = %v, want a loopback refusal", err)
	}
	if len(rec.dialed) != 0 {
		t.Fatalf("the redirect target was dialled: %v", rec.dialed)
	}
}
