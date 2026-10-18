package security

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

// ErrHostNotAllowed is returned by an allowlisted client for any other host.
var ErrHostNotAllowed = fmt.Errorf("host not allowed")

// AllowlistClient is SafeClient restricted to a fixed set of hosts: every
// request, and every redirect hop, must name one of them exactly. The YouTube
// connector uses it with "www.youtube.com", so nothing a watch page, a player
// response or a caption track says can send the server anywhere else.
//
// Two checks, both needed. The transport refuses a request whose host is not
// listed before any dial; CheckRedirect refuses a hop off the list before the
// transport is even asked, so the refusal names the redirect.
func AllowlistClient(timeout time.Duration, hosts ...string) *http.Client {
	return allowlistOver(SafeClient(timeout), hosts...)
}

// AllowlistClientOver restricts an existing client. Tests pass a client aimed
// at a fixture server; production uses AllowlistClient.
func AllowlistClientOver(base *http.Client, hosts ...string) *http.Client {
	return allowlistOver(base, hosts...)
}

func allowlistOver(base *http.Client, hosts ...string) *http.Client {
	allowed := make(map[string]bool, len(hosts))
	for _, h := range hosts {
		allowed[strings.ToLower(h)] = true
	}
	inner := base.Transport
	if inner == nil {
		inner = http.DefaultTransport
	}
	previous := base.CheckRedirect
	return &http.Client{
		Timeout:   base.Timeout,
		Transport: allowlistTransport{inner: inner, allowed: allowed},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if !allowed[strings.ToLower(req.URL.Host)] {
				return fmt.Errorf("%w: redirect to %s", ErrHostNotAllowed, req.URL.Host)
			}
			if previous != nil {
				return previous(req, via)
			}
			if len(via) >= maxRedirects {
				return fmt.Errorf("safe client: stopped after %d redirects", maxRedirects)
			}
			return nil
		},
	}
}

type allowlistTransport struct {
	inner   http.RoundTripper
	allowed map[string]bool
}

// RoundTrip compares URL.Host, which includes a port: "www.youtube.com:8443"
// is not "www.youtube.com", and neither is an IP literal that resolves to it.
func (t allowlistTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if !t.allowed[strings.ToLower(req.URL.Host)] {
		return nil, fmt.Errorf("%w: %s", ErrHostNotAllowed, req.URL.Host)
	}
	return t.inner.RoundTrip(req)
}
