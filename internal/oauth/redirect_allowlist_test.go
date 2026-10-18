package oauth

import (
	"errors"
	"testing"
)

// Security audit F-10: the consent URL only ever carries a redirect the
// operator listed; everything else, including an empty list, is refused.
func TestGeminiConsentURLOnlyUsesListedRedirects(t *testing.T) {
	t.Setenv("ANYTOOLS_GEMINI_SUB_CLIENT_ID", "client")
	t.Setenv("ANYTOOLS_GEMINI_SUB_CLIENT_SECRET", "secret")

	t.Setenv(GeminiRedirectsEnv, "")
	if _, err := GeminiAuthURL("https://learn.example.com/cb"); !errors.Is(err, ErrRedirectNotAllowed) {
		t.Fatalf("empty allowlist: err = %v", err)
	}

	t.Setenv(GeminiRedirectsEnv, "https://learn.example.com/cb, http://localhost:8085/")
	if _, err := GeminiAuthURL("https://learn.example.com/cb"); err != nil {
		t.Fatalf("listed redirect refused: %v", err)
	}
	if _, err := GeminiAuthURL("http://localhost:8085/"); err != nil {
		t.Fatalf("second listed redirect refused: %v", err)
	}
	for _, bad := range []string{"https://evil.test/cb", "https://learn.example.com/cb/../x", "https://learn.example.com/cb?x=1", ""} {
		if _, err := GeminiAuthURL(bad); !errors.Is(err, ErrRedirectNotAllowed) {
			t.Errorf("%q: err = %v, want ErrRedirectNotAllowed", bad, err)
		}
	}
}
