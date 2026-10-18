package security

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// A private-range api_base must be refused at WRITE time, with the specific
// error naming why, so the user gets an actionable sentence instead of a
// timeout later.
func TestValidateBYOKEndpointRejectsPrivateRanges(t *testing.T) {
	cases := []struct {
		name string
		url  string
		want error
	}{
		{"loopback v4", "https://127.0.0.1/v1", ErrSSRFLoopback},
		{"loopback name", "https://localhost/v1", ErrSSRFLoopback},
		{"loopback v6", "https://[::1]/v1", ErrSSRFLoopback},
		{"rfc1918 10", "https://10.0.0.5/v1", ErrSSRFPrivateIP},
		{"rfc1918 172", "https://172.16.4.4/v1", ErrSSRFPrivateIP},
		{"rfc1918 192", "https://192.168.1.1/v1", ErrSSRFPrivateIP},
		{"carrier nat", "https://100.64.0.1/v1", ErrSSRFPrivateIP},
		// The one that matters most: the cloud metadata service. A BYOK base
		// pointed here exfiltrates the instance's credentials.
		{"IMDS", "https://169.254.169.254/latest/meta-data", ErrSSRFLinkLocal},
		// 0.0.0.0 is caught by the 0.0.0.0/8 range before the IsUnspecified
		// branch. Either verdict blocks it; the test pins which one so a future
		// reorder of CheckIP is a visible change rather than a silent one.
		{"unspecified", "https://0.0.0.0/v1", ErrSSRFPrivateIP},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateBYOKEndpoint(tc.url)
			if err == nil {
				t.Fatalf("%s was accepted", tc.url)
			}
			if !errors.Is(err, tc.want) {
				t.Fatalf("%s: got %v, want %v", tc.url, err, tc.want)
			}
		})
	}
}

// http is refused outright: a BYOK key travels in the Authorization header of
// every call made with it.
func TestValidateBYOKEndpointRequiresHTTPS(t *testing.T) {
	err := ValidateBYOKEndpoint("http://example.com/v1")
	if err == nil || !strings.Contains(err.Error(), "only https") {
		t.Fatalf("plain http accepted or wrong error: %v", err)
	}
}

func TestValidateBYOKEndpointAllowsEmptyAndPublic(t *testing.T) {
	if err := ValidateBYOKEndpoint(""); err != nil {
		t.Fatalf("empty base (meaning the provider default) was refused: %v", err)
	}
	if err := ValidateBYOKEndpoint("https://api.openai.com/v1"); err != nil {
		t.Fatalf("a public endpoint was refused: %v", err)
	}
}

// The escape hatch exists for a self-hosted endpoint, and it must be the ONLY
// thing that opens the door.
func TestAllowPrivateEndpointsEnvOpensTheHatch(t *testing.T) {
	if err := ValidateBYOKEndpoint("https://10.0.0.5/v1"); err == nil {
		t.Fatal("private range accepted with the hatch closed")
	}
	t.Setenv(AllowPrivateEndpointsEnv, "1")
	if err := ValidateBYOKEndpoint("https://10.0.0.5/v1"); err != nil {
		t.Fatalf("private range still refused with the hatch open: %v", err)
	}
}

// The second half of the defence: even a base that passed validation must be
// blocked at EGRESS, because a hostname that resolved publicly when it was
// saved can resolve to an internal address when it is used.
func TestSafeBYOKClientBlocksPrivateAddressesAtConnectTime(t *testing.T) {
	// httptest listens on 127.0.0.1, which is exactly the address class the
	// dialer must refuse — so the server never receives the request at all.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("the request reached a loopback server — the connect-time guard did not fire")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	_, err := SafeBYOKClient(5 * time.Second).Get(srv.URL)
	if err == nil {
		t.Fatal("a loopback request succeeded")
	}
	if !strings.Contains(err.Error(), ErrSSRFLoopback.Error()) {
		t.Fatalf("blocked, but not for the right reason: %v", err)
	}
}

// SafeClient is for egress that has no escape hatch at all: the private-endpoint
// env var must not reach it.
func TestSafeClientIgnoresThePrivateEndpointHatch(t *testing.T) {
	t.Setenv(AllowPrivateEndpointsEnv, "1")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	if _, err := SafeClient(5 * time.Second).Get(srv.URL); err == nil {
		t.Fatal("SafeClient reached a loopback address with the BYOK hatch open — " +
			"the hatch must apply to BYOK egress only")
	}
}

// A redirect must not carry a credential header to a different host. Go strips
// Authorization itself; the provider-specific key headers are the ones it knows
// nothing about.
func TestSafeClientRefusesCrossHostRedirectWithCredential(t *testing.T) {
	var target *httptest.Server
	target = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Goog-Api-Key") != "" {
			t.Error("a provider key header survived a cross-host redirect")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()
	_ = target

	// The redirect decision is unit-testable without a network hop: build the
	// hop the client would have followed and ask CheckRedirect about it.
	client := newSafeClient(time.Second, true)
	original := httptest.NewRequest(http.MethodGet, "https://provider.test/v1/models", nil)
	hop := httptest.NewRequest(http.MethodGet, "https://attacker.test/v1/models", nil)
	hop.Header.Set("X-Goog-Api-Key", "secret-value-never-logged")

	if err := client.CheckRedirect(hop, []*http.Request{original}); err == nil {
		t.Fatal("a cross-host redirect carrying a provider key header was allowed")
	}

	// Same host is fine — a provider legitimately redirects within itself.
	sameHostHop := httptest.NewRequest(http.MethodGet, "https://provider.test/v2/models", nil)
	sameHostHop.Header.Set("X-Goog-Api-Key", "secret-value-never-logged")
	if err := client.CheckRedirect(sameHostHop, []*http.Request{original}); err != nil {
		t.Fatalf("a same-host redirect was refused: %v", err)
	}
}

// NormalizeAPIBase is the fix for a measured silent failure: a base missing its
// version segment answers HTTP 200 with an empty body.
func TestNormalizeAPIBaseAppendsAMissingVersionSegment(t *testing.T) {
	cases := []struct{ in, version, want string }{
		{"https://proxy.test/api/anthropic", "v1", "https://proxy.test/api/anthropic/v1"},
		{"https://proxy.test/api/anthropic/", "v1", "https://proxy.test/api/anthropic/v1"},
		// Already versioned: left exactly as typed, including a version this
		// code did not suggest.
		{"https://api.openai.com/v1", "v1", "https://api.openai.com/v1"},
		{"https://generativelanguage.googleapis.com/v1beta", "v1beta", "https://generativelanguage.googleapis.com/v1beta"},
		{"https://cloudcode-pa.googleapis.com/v1internal", "v1", "https://cloudcode-pa.googleapis.com/v1internal"},
		{"https://proxy.test/v2", "v1", "https://proxy.test/v2"},
		// The case that made every Gemini call 404: the version segment is not
		// last. Checking only the final segment appended a second one, giving
		// ".../v1beta/openai/v1beta".
		{"https://generativelanguage.googleapis.com/v1beta/openai", "v1beta",
			"https://generativelanguage.googleapis.com/v1beta/openai"},
		{"https://proxy.test/v1/openai/chat", "v1", "https://proxy.test/v1/openai/chat"},
		// Empty means "use the provider's default" and must stay empty.
		{"", "v1", ""},
		{"https://proxy.test", "v1", "https://proxy.test/v1"},
	}
	for _, tc := range cases {
		if got := NormalizeAPIBase(tc.in, tc.version); got != tc.want {
			t.Errorf("NormalizeAPIBase(%q, %q) = %q, want %q", tc.in, tc.version, got, tc.want)
		}
	}
}

// A key in the QUERY (OpenAlex's api_key) is never forwarded or stripped by
// anyone: a redirect to another host is refused, and the error names hosts
// only, never the URL with the key in it.
func TestSafeClientRefusesCrossHostRedirectWithQueryCredential(t *testing.T) {
	client := SafeClient(time.Second)
	original, _ := http.NewRequest(http.MethodGet, "https://api.openalex.org/works?search=rag&api_key=oa-secret-1", nil)
	hop, _ := http.NewRequest(http.MethodGet, "https://elsewhere.example/works", nil)
	err := client.CheckRedirect(hop, []*http.Request{original})
	if err == nil {
		t.Fatal("a cross-host redirect from a URL carrying a key was allowed")
	}
	if strings.Contains(err.Error(), "oa-secret-1") {
		t.Fatalf("the refusal quotes the key: %v", err)
	}
	same, _ := http.NewRequest(http.MethodGet, "https://api.openalex.org/works/W1", nil)
	if err := client.CheckRedirect(same, []*http.Request{original}); err != nil {
		t.Fatalf("a same-host redirect was refused: %v", err)
	}
	plain, _ := http.NewRequest(http.MethodGet, "https://api.openalex.org/works?search=rag", nil)
	if err := client.CheckRedirect(hop, []*http.Request{plain}); err != nil {
		t.Fatalf("a keyless request's redirect was refused: %v", err)
	}
}
