package byok_test

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/connectors/github"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Up-methods phase 18: a GitHub token is the learner's own key, stored
// encrypted with the search keys, verified against GitHub, and never echoed.
func TestAGitHubTokenIsStoredVerifiedAndNeverEchoed(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()
	user := testutil.NewUser(t, testutil.TestDB(t))
	const good, bad = "github_pat_GOODSECRET0001", "github_pat_BADSECRET0002"

	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rate_limit" || r.Header.Get("Authorization") != "Bearer "+good {
			// A body echoing the token must not reach the learner.
			http.Error(w, "Bad credentials for "+r.Header.Get("Authorization"), http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"resources":{}}`))
	}))
	defer srv.Close()
	addr := srv.Listener.Addr().String()
	base := security.FetchClientWith(5*time.Second, security.GuardedDialer{
		Lookup: func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("140.82.112.5")}}, nil
		},
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, addr)
		},
	})
	base.Transport.(*http.Transport).TLSClientConfig = srv.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
	svc.UseGitHubClient(github.NewClientFor(base, "https://gh.example.com", "https://api.example.com", "https://codeload.example.com"))

	if tok, err := svc.GitHubToken(ctx, user); err != nil || tok != "" {
		t.Fatalf("no token yet: %q %v", tok, err)
	}
	conn, err := svc.SaveSearchConnection(ctx, user, byok.ProviderGitHub, " "+bad+" ")
	if err != nil {
		t.Fatal(err)
	}
	res, err := svc.VerifySearchConnection(ctx, user, conn.ID)
	if err != nil || res.OK {
		t.Fatalf("a refused token verified: %+v %v", res, err)
	}
	if strings.Contains(res.Message, "SECRET") || res.Message == "" {
		t.Fatalf("verify message %q", res.Message)
	}
	rows, _ := svc.ListSearchConnections(ctx, user)
	for _, r := range rows {
		if strings.Contains(r.LastError, "SECRET") {
			t.Fatalf("stored last error carries the token: %q", r.LastError)
		}
	}

	if _, err := svc.SaveSearchConnection(ctx, user, byok.ProviderGitHub, good); err != nil {
		t.Fatal(err)
	}
	if tok, err := svc.GitHubToken(ctx, user); err != nil || tok != good {
		t.Fatalf("token read back: %v", err)
	}
	if res, err := svc.VerifySearchConnection(ctx, user, conn.ID); err != nil || !res.OK {
		t.Fatalf("a good token: %+v %v", res, err)
	}
	// A GitHub token is not a web-search key.
	if chain, err := svc.SearchFor(ctx, user); err == nil && chain != nil && chain.Len() > 0 {
		t.Fatalf("the GitHub token joined the web-search chain")
	}
}
