package security

import (
	"net"
	"testing"
)

// IPv6 addresses that carry an IPv4 address inside them reach that IPv4
// address through a translator (NAT64), a relay (6to4) or a tunnel (Teredo).
// Checking only the IPv6 form lets a DNS answer of 64:ff9b::a9fe:a9fe walk to
// the cloud metadata service on a host with a NAT64 gateway.
func TestIPv6ThatEmbedsAPrivateIPv4IsRefused(t *testing.T) {
	blocked := []string{
		"64:ff9b::a9fe:a9fe",                   // NAT64 well-known prefix → 169.254.169.254
		"64:ff9b::7f00:1",                      // → 127.0.0.1
		"64:ff9b:1::a00:1",                     // local-use NAT64 prefix (RFC 8215) → 10.0.0.1
		"2002:a9fe:a9fe::1",                    // 6to4 → 169.254.169.254
		"2002:c0a8:0101::",                     // 6to4 → 192.168.1.1
		"2001:0:4136:e378:8000:63bf:f5ff:fffe", // Teredo, client 10.0.0.1 (obfuscated)
	}
	for _, s := range blocked {
		if CheckIP(net.ParseIP(s)) == nil {
			t.Errorf("%s was allowed", s)
		}
	}
	allowed := []string{
		"64:ff9b::808:808", // NAT64 to 8.8.8.8 is an ordinary public address
		"2002:0808:0808::1",
		"2606:4700:4700::1111",
		"8.8.8.8",
	}
	for _, s := range allowed {
		if err := CheckIP(net.ParseIP(s)); err != nil {
			t.Errorf("%s was refused: %v", s, err)
		}
	}
}
