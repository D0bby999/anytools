package security

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// SSRF-hardened HTTP clients for egress to user-influenced URLs.
//
// The bug these exist to close: a validate-then-fetch guard that IP-checks only
// the ORIGINAL host is bypassed by Go's default client, which follows up to ten
// redirects without re-checking. A public host that 302s to
// http://169.254.169.254/ is followed, with the caller's Authorization header
// and prompt attached.
//
// The fix is a connect-time guard. net.Dialer.Control runs on the POST-DNS
// resolved address for EVERY dial, including each redirect hop, so it closes
// the redirect bypass and DNS rebinding in the same place. CheckRedirect only
// caps the hop count on top of it.
const maxRedirects = 3

// sameHost compares host:port case-insensitively. Deliberately stricter than
// net/http's isDomainOrSubdomain: a request carrying a credential has no
// legitimate reason to follow ANY cross-host hop, subdomain or not.
func sameHost(a, b *url.URL) bool { return strings.EqualFold(a.Host, b.Host) }

// dialControl rejects connections to private/loopback/link-local/IMDS addresses
// at connect time. address is "ip:port", already resolved by the dialer.
func dialControl(allowPrivate bool) func(network, address string, c syscall.RawConn) error {
	return func(_, address string, _ syscall.RawConn) error {
		if allowPrivate {
			return nil
		}
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			host = address
		}
		ip := net.ParseIP(host)
		if ip == nil {
			return fmt.Errorf("safe dialer: cannot parse IP from %q", address)
		}
		return CheckIP(ip)
	}
}

func safeTransport(allowPrivate bool) *http.Transport {
	d := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
		Control:   dialControl(allowPrivate),
	}
	return &http.Transport{
		DialContext:           d.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
}

func newSafeClient(timeout time.Duration, allowPrivate bool) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: safeTransport(allowPrivate),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return fmt.Errorf("safe client: stopped after %d redirects", maxRedirects)
			}
			// Go strips Authorization and Cookie on a cross-host redirect but
			// knows nothing about provider-specific key headers (x-api-key,
			// x-goog-api-key), which would otherwise ride along to whatever
			// host the redirect names. Compare every hop against the ORIGINAL
			// request, so a chain of small steps that ends off-origin is still
			// caught.
			if len(via) > 0 && hasCredentialHeader(req) && !sameHost(req.URL, via[0].URL) {
				return fmt.Errorf("safe client: refusing to follow a redirect from %s to a different host %s with a credential header attached",
					via[0].URL.Host, req.URL.Host)
			}
			// A key in the QUERY (OpenAlex's api_key) is not stripped by
			// anyone: a redirect off-origin is refused outright, and the error
			// names hosts only, never the URL that carries the key.
			if len(via) > 0 && hasCredentialQuery(via[0].URL) && !sameHost(req.URL, via[0].URL) {
				return fmt.Errorf("safe client: refusing to follow a redirect from %s to a different host %s with a credential in the query",
					via[0].URL.Host, req.URL.Host)
			}
			return nil // the dial-time guard re-asserts the IP check on every hop
		},
	}
}

// credentialHeaders are outbound headers that must never survive a redirect
// onto a different host. Authorization and Cookie are listed even though
// net/http already strips them: if that behaviour ever changes, this must not
// be the place that quietly stopped covering them.
var credentialHeaders = []string{"Authorization", "Cookie", "X-Api-Key", "X-Goog-Api-Key", "Anthropic-Version"}

// credentialQuery are query parameters that carry a key.
var credentialQuery = []string{"api_key", "apikey", "key", "token", "access_token"}

func hasCredentialQuery(u *url.URL) bool {
	q := u.Query()
	for _, name := range credentialQuery {
		if q.Get(name) != "" {
			return true
		}
	}
	return false
}

func hasCredentialHeader(req *http.Request) bool {
	for _, name := range credentialHeaders {
		if req.Header.Get(name) != "" {
			return true
		}
	}
	return false
}

// SafeClient is for egress that must NEVER reach an internal address (web
// search, document fetch). Always strict — the private-endpoint escape hatch
// does not apply.
func SafeClient(timeout time.Duration) *http.Client { return newSafeClient(timeout, false) }

// SafeBYOKClient is for BYOK LLM provider egress. Identical to SafeClient except
// that it honours ANYTOOLS_BYOK_ALLOW_PRIVATE_ENDPOINTS=1, so an operator
// running a self-hosted endpoint can opt in explicitly.
func SafeBYOKClient(timeout time.Duration) *http.Client {
	return newSafeClient(timeout, allowPrivateEndpoints())
}
