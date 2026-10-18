package security

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strings"

	"github.com/D0bby999/anytools/internal/config"
)

// AllowPrivateEndpointsEnv is the one escape hatch for an operator running a
// self-hosted model on a private address. It is read in exactly one place so a
// second os.Getenv elsewhere cannot widen it by accident, and the deployment
// docs say it must never be set on the hosted instance
// (reports/spike-providers.md, "Decision locked").
const AllowPrivateEndpointsEnv = "ANYTOOLS_BYOK_ALLOW_PRIVATE_ENDPOINTS"

func allowPrivateEndpoints() bool { return config.Getenv(AllowPrivateEndpointsEnv) == "1" }

// ValidateLLMEndpoint is the strict SSRF check on a user-supplied BYOK API base.
//
// There is deliberately no host allowlist: BYOK means the user may point at any
// public OpenAI-compatible endpoint (OpenRouter, Together, Groq, their own
// gateway). What it does enforce is https, and that NO address the name resolves
// to is private, loopback, link-local or multicast — every A/AAAA record, not
// just the first, because checking one record leaves DNS rebinding open.
//
// An empty base means "use the provider's default", so it is valid.
func ValidateLLMEndpoint(rawURL string) error {
	if rawURL == "" {
		return nil
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	if parsed.Scheme != "https" {
		return fmt.Errorf("only https BYOK endpoints are allowed, got %q", parsed.Scheme)
	}

	host := parsed.Hostname()
	if host == "" {
		return fmt.Errorf("URL has no host")
	}
	host = strings.TrimPrefix(host, "[")
	host = strings.TrimSuffix(host, "]")

	// A bare IP is checked directly so private/IMDS targets get their specific
	// error rather than a DNS failure.
	if ip := net.ParseIP(host); ip != nil {
		return CheckIP(ip)
	}

	ctx, cancel := context.WithTimeout(context.Background(), dnsTimeout)
	defer cancel()

	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return fmt.Errorf("DNS resolution failed for %q: %w", host, err)
	}
	if len(addrs) == 0 {
		return fmt.Errorf("DNS returned no records for %q", host)
	}
	for _, addr := range addrs {
		if err := CheckIP(addr.IP); err != nil {
			return fmt.Errorf("DNS rebinding guard: record for %q: %w", host, err)
		}
	}
	return nil
}

// ValidateBYOKEndpoint is what handlers call. It is ValidateLLMEndpoint plus
// the single read of the private-endpoint escape hatch, so a caller cannot
// duplicate the check with its own env read and get a different answer than the
// dialer will give it later.
func ValidateBYOKEndpoint(rawURL string) error {
	if allowPrivateEndpoints() {
		return nil
	}
	return ValidateLLMEndpoint(rawURL)
}

// NormalizeAPIBase trims a stored api_base and appends the provider's version
// segment when the user left it off.
//
// Measured 2026-09-16 (reports/spike-providers.md): an Anthropic-protocol base
// stored as ".../api/anthropic" — no "/v1" — plus anthropic.go's own
// "/messages" returns HTTP 200 with an EMPTY body and finish_reason "stop". A
// misconfigured base is therefore not an error the user sees; it is a silent
// empty answer. Normalising here, and treating a zero-content non-tool
// completion as a failure in the chain, are the two halves of that fix.
//
// A base whose path already contains a version segment ANYWHERE is left exactly
// as the user typed it. Checking only the LAST segment was a real bug: Google's
// OpenAI-compatibility base is ".../v1beta/openai", whose last segment is
// "openai", so the version got appended a second time and every call 404'd.
func NormalizeAPIBase(rawURL, versionSegment string) string {
	base := strings.TrimRight(strings.TrimSpace(rawURL), "/")
	if base == "" || versionSegment == "" {
		return base
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return base
	}
	for _, seg := range strings.Split(parsed.Path, "/") {
		if looksLikeVersionSegment(seg) {
			return base
		}
	}
	return base + "/" + strings.Trim(versionSegment, "/")
}

// looksLikeVersionSegment reports whether a path segment is already an API
// version marker ("v1", "v1beta", "v1internal", "v2alpha"…).
func looksLikeVersionSegment(seg string) bool {
	if len(seg) < 2 || (seg[0] != 'v' && seg[0] != 'V') {
		return false
	}
	return seg[1] >= '0' && seg[1] <= '9'
}
