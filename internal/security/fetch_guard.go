package security

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// fetch_guard.go — egress for `web_fetch`, the one tool whose destination is
// chosen by text AnyTools does not control (a search result, a page's own
// links, a model's argument).
//
// SafeClient's guard runs in net.Dialer.Control, AFTER Go has resolved the
// name, which already closes the redirect bypass and most of DNS rebinding.
// The fetch guard is stricter in one way that matters for arbitrary URLs: it
// resolves the name ITSELF, refuses if ANY record is internal, and then dials
// the exact address it checked. There is no second lookup between the check
// and the connect for a rebinding name server to answer differently, and a
// name that returns one public and one private record is refused outright
// rather than raced.

// ErrFetchURL is returned for a URL web_fetch will not try at all.
var ErrFetchURL = errors.New("url not allowed")

// LookupFunc resolves a host name. net.DefaultResolver.LookupIPAddr in
// production; tests supply a scripted one.
type LookupFunc func(ctx context.Context, host string) ([]net.IPAddr, error)

// DialFunc opens a connection to an already-resolved "ip:port".
type DialFunc func(ctx context.Context, network, address string) (net.Conn, error)

// GuardedDialer resolves, checks every record, and dials the checked address.
type GuardedDialer struct {
	Lookup LookupFunc
	Dial   DialFunc
}

// DialContext implements http.Transport.DialContext.
func (d GuardedDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("fetch guard: %w", err)
	}

	var ips []net.IP
	if ip := net.ParseIP(host); ip != nil {
		ips = []net.IP{ip}
	} else {
		lookupCtx, cancel := context.WithTimeout(ctx, dnsTimeout)
		addrs, err := d.Lookup(lookupCtx, host)
		cancel()
		if err != nil {
			return nil, fmt.Errorf("fetch guard: resolve %q: %w", host, err)
		}
		for _, a := range addrs {
			ips = append(ips, a.IP)
		}
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("fetch guard: %q has no addresses", host)
	}

	// Every record, not the first: checking one leaves the others for the
	// dialer to pick, which is DNS rebinding with extra steps.
	for _, ip := range ips {
		if err := CheckIP(ip); err != nil {
			return nil, fmt.Errorf("fetch guard: %q: %w", host, err)
		}
	}
	// Pinned: the address dialled is the address checked.
	return d.Dial(ctx, network, net.JoinHostPort(ips[0].String(), port))
}

// CheckFetchURL is the static half: scheme, credentials in the URL, and a
// literal internal address. The dial is the authoritative check; this one
// exists so the obvious refusals produce a sentence instead of a dial error.
func CheckFetchURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrFetchURL, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("%w: only http and https pages can be fetched", ErrFetchURL)
	}
	if u.User != nil {
		// user:pass@host is a credential the model would be choosing to send.
		return nil, fmt.Errorf("%w: a URL may not carry credentials", ErrFetchURL)
	}
	host := u.Hostname()
	if host == "" {
		return nil, fmt.Errorf("%w: the URL has no host", ErrFetchURL)
	}
	if strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".localhost") {
		return nil, fmt.Errorf("%w: %w", ErrFetchURL, ErrSSRFLoopback)
	}
	if ip := net.ParseIP(host); ip != nil {
		if err := CheckIP(ip); err != nil {
			return nil, fmt.Errorf("%w: %w", ErrFetchURL, err)
		}
	}
	return u, nil
}

// FetchClient is the HTTP client web_fetch uses in production: the guarded
// dialer over the system resolver, the connect-time Control check underneath
// it as a second net, and SafeClient's redirect cap. Never honours
// ANYTOOLS_BYOK_ALLOW_PRIVATE_ENDPOINTS — that hatch is for an operator's own
// model server, not for pages a document can name.
func FetchClient(timeout time.Duration) *http.Client {
	base := &net.Dialer{Timeout: 10 * time.Second, Control: dialControl(false)}
	return FetchClientWith(timeout, GuardedDialer{
		Lookup: net.DefaultResolver.LookupIPAddr,
		Dial:   base.DialContext,
	})
}

// FetchClientWith builds the same client over a supplied dialer. Tests use it
// to script DNS; production uses FetchClient.
func FetchClientWith(timeout time.Duration, d GuardedDialer) *http.Client {
	c := newSafeClient(timeout, false)
	t := c.Transport.(*http.Transport)
	t.DialContext = d.DialContext
	// No proxy, ever: a proxy would do the resolving, and the guard would be
	// checking the proxy's address instead of the page's.
	t.Proxy = nil
	return c
}
