// Package security holds AnyTools' egress controls: the SSRF address
// blacklist, the BYOK endpoint validator that runs at WRITE time, and the
// hardened HTTP clients that re-assert the same rules at CONNECT time.
//
// Ported from postclaw internal/security/{url_validator,llm_endpoint_validator,
// safe_http}.go. The phase-4 plan named the two files
// `internal/security/{byok_endpoint,safe_client}.go`; neither name exists, and
// both real files depend on this third one for checkIP/isPrivateIP/dnsTimeout
// and the ErrSSRF sentinels (spike A, reports/spike-providers.md "Port-set
// errata"). Porting the two named files alone does not compile.
package security

import (
	"errors"
	"net"
	"time"
)

var (
	// ErrSSRFPrivateIP is returned when a URL resolves to an RFC-1918 private address.
	ErrSSRFPrivateIP = errors.New("URL resolves to private IP address")
	// ErrSSRFLoopback is returned when a URL resolves to a loopback address.
	ErrSSRFLoopback = errors.New("URL resolves to loopback address")
	// ErrSSRFLinkLocal is returned when a URL resolves to a link-local address
	// (AWS IMDS 169.254.169.254, the GCP metadata server).
	ErrSSRFLinkLocal = errors.New("URL resolves to link-local address (IMDS)")
	// ErrSSRFMulticast is returned when a URL resolves to a multicast address.
	ErrSSRFMulticast = errors.New("URL resolves to multicast address")
)

// dnsTimeout bounds DNS resolution during validation. A hostile name server
// that never answers must not hold a request handler open.
const dnsTimeout = 3 * time.Second

var privateRanges = func() []*net.IPNet {
	cidrs := []string{
		"0.0.0.0/8", // "this network" (RFC 791)
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"100.64.0.0/10", // carrier-grade NAT
		"192.0.0.0/24",  // IETF protocol assignments
		"198.18.0.0/15", // benchmarking
		"198.51.100.0/24",
		"203.0.113.0/24",
		"240.0.0.0/4", // reserved
		"fc00::/7",    // IPv6 unique local
	}
	out := make([]*net.IPNet, 0, len(cidrs))
	for _, c := range cidrs {
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			// A malformed constant here would silently disable a whole range,
			// so it is a boot-time panic rather than a skipped entry.
			panic("security: bad private CIDR " + c)
		}
		out = append(out, n)
	}
	return out
}()

func isPrivateIP(ip net.IP) bool {
	for _, cidr := range privateRanges {
		if cidr.Contains(ip) {
			return true
		}
	}
	return false
}

// CheckIP reports whether an already-resolved address is a legal egress target.
// It is the single definition of "an address a user-supplied URL may reach",
// shared by the write-time validator and the connect-time dialer so the two can
// never drift apart.
func CheckIP(ip net.IP) error {
	// An IPv6 address that carries an IPv4 one reaches that IPv4 address
	// through a translator or tunnel, so the embedded address must pass too.
	if v4 := embeddedIPv4(ip); v4 != nil {
		if err := CheckIP(v4); err != nil {
			return err
		}
	}
	if ip.IsLoopback() {
		return ErrSSRFLoopback
	}
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return ErrSSRFLinkLocal
	}
	if ip.IsMulticast() {
		return ErrSSRFMulticast
	}
	if isPrivateIP(ip) {
		return ErrSSRFPrivateIP
	}
	if ip.IsUnspecified() {
		return ErrSSRFLoopback
	}
	return nil
}

// Prefixes whose addresses embed an IPv4 address (RFC 6052, 8215, 3056, 4380).
var (
	nat64WellKnown = mustCIDR("64:ff9b::/96")
	nat64Local     = mustCIDR("64:ff9b:1::/48")
	sixToFour      = mustCIDR("2002::/16")
	teredo         = mustCIDR("2001::/32")
)

func mustCIDR(s string) *net.IPNet {
	_, n, err := net.ParseCIDR(s)
	if err != nil {
		panic(err)
	}
	return n
}

// embeddedIPv4 returns the IPv4 address an IPv6 address routes to, or nil.
// IPv4-mapped addresses (::ffff:a.b.c.d) are not handled here: net.IP already
// treats them as IPv4, so the ordinary checks see the embedded address.
func embeddedIPv4(ip net.IP) net.IP {
	if ip.To4() != nil || len(ip) != net.IPv6len {
		return nil
	}
	switch {
	case nat64WellKnown.Contains(ip), nat64Local.Contains(ip):
		return net.IPv4(ip[12], ip[13], ip[14], ip[15])
	case sixToFour.Contains(ip):
		return net.IPv4(ip[2], ip[3], ip[4], ip[5])
	case teredo.Contains(ip):
		// The Teredo client address is the last 32 bits, inverted.
		return net.IPv4(^ip[12], ^ip[13], ^ip[14], ^ip[15])
	}
	return nil
}
