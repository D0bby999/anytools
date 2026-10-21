package byok

import (
	"net"
	"net/url"
	"strings"
	"testing"
)

func mustHost(t *testing.T, raw string) string {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u.Hostname()
}

// Every catalog row is connectable and safe to call: an https base that the
// SSRF guard accepts as written, a known auth kind, a label and a tile.
func TestCatalogEntriesAreWellFormed(t *testing.T) {
	seen := map[string]bool{}
	for _, e := range Catalog(true) {
		if seen[e.Type] {
			t.Errorf("%q appears twice", e.Type)
		}
		seen[e.Type] = true
		if e.Label == "" || e.Icon == "" || len([]rune(e.Icon)) > 3 {
			t.Errorf("%q: label %q, icon %q", e.Type, e.Label, e.Icon)
		}
		switch e.Auth {
		case AuthAPIKey, AuthSignIn, AuthCustom:
		default:
			t.Errorf("%q: unknown auth %q", e.Type, e.Auth)
		}
		if len(e.Serves) == 0 || e.Serves[0] != "chat" {
			t.Errorf("%q: every catalog provider serves chat first, got %v", e.Type, e.Serves)
		}
		for _, raw := range []string{e.APIBase, e.KeyURL} {
			if raw == "" {
				continue
			}
			u, err := url.Parse(raw)
			if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
				t.Errorf("%q: %q is not a plain https URL", e.Type, raw)
			}
		}
		if e.APIBase != "" {
			// A public host by name: the dialer's SSRF guard
			// (security.SafeBYOKClient) checks what it resolves to on
			// every call, so the table must not pin an address or loopback.
			host := strings.ToLower(mustHost(t, e.APIBase))
			if net.ParseIP(host) != nil || host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".internal") {
				t.Errorf("%q: base host %q is not a public name", e.Type, host)
			}
			if got := presetBase(e.Type, ""); got != e.APIBase {
				t.Errorf("%q: serves on %q, want %q", e.Type, got, e.APIBase)
			}
		}
		if strings.Contains(e.Type, "coding") {
			t.Errorf("%q: coding-plan endpoints are left out on purpose", e.Type)
		}
	}
}

// Every preset is offered for a key, and a preset without a default model
// says so, so the routes editor asks for one.
func TestEveryPresetIsOfferedAndSaysWhetherItNeedsAModel(t *testing.T) {
	offered := map[string]bool{}
	for _, p := range APIKeyProviders() {
		offered[p] = true
	}
	for id, pr := range presets {
		if !offered[id] {
			t.Errorf("preset %q is not offered for a key", id)
		}
		e, _ := CatalogEntryFor(id, false)
		if e.NeedsModel != (pr.ChatModel == "") {
			t.Errorf("preset %q: needs_model %v with chat model %q", id, e.NeedsModel, pr.ChatModel)
		}
	}
	if len(Catalog(false)) < 45 {
		t.Errorf("the catalog has %d providers, want about 45 or more", len(Catalog(false)))
	}
}

// The subscription lanes appear only when they are enabled.
func TestCatalogHidesSignInLanesUnlessEnabled(t *testing.T) {
	for _, e := range Catalog(false) {
		if e.Auth == AuthSignIn {
			t.Errorf("%q is listed with the lanes off", e.Type)
		}
	}
	if _, ok := CatalogEntryFor("github_copilot", true); !ok {
		t.Error("Copilot is missing with the lanes on")
	}
}

// A tile's colour is a part name, and the same provider always gets the same one.
func TestCatalogHuesAreTokenNames(t *testing.T) {
	allowed := map[string]bool{}
	for _, h := range hues {
		allowed[h] = true
	}
	for _, e := range Catalog(true) {
		if !allowed[e.Hue] || hueOf(e.Type) != e.Hue {
			t.Errorf("%q: hue %q", e.Type, e.Hue)
		}
	}
}
