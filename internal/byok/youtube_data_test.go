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
	"github.com/D0bby999/anytools/internal/connectors/feeds"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Up-methods phase 17: a YouTube Data API key is the learner's own, stored
// encrypted with the search keys, verified against Google from the server,
// and never echoed in a message or a stored error.
func TestAYouTubeDataKeyIsStoredVerifiedAndNeverEchoed(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()
	user := testutil.NewUser(t, testutil.TestDB(t))
	const good, bad = "AIzaGOODSECRET0001", "AIzaBADSECRET0002"

	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/youtube/v3/i18nLanguages" || r.Header.Get("X-Goog-Api-Key") != good {
			// A body echoing the key must not reach the learner.
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"API key not valid: ` + r.Header.Get("X-Goog-Api-Key") + `"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"items":[]}`))
	}))
	defer srv.Close()
	addr := srv.Listener.Addr().String()
	client := security.FetchClientWith(5*time.Second, security.GuardedDialer{
		Lookup: func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("142.250.1.95")}}, nil
		},
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, addr)
		},
	})
	client.Transport.(*http.Transport).TLSClientConfig = srv.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
	svc.UseYouTubeDataClient(&feeds.Data{HTTP: client, Base: "https://example.com/youtube/v3"})

	if key, err := svc.YouTubeDataKey(ctx, user); err != nil || key != "" {
		t.Fatalf("no key yet: %q %v", key, err)
	}
	conn, err := svc.SaveSearchConnection(ctx, user, byok.ProviderYouTubeData, " "+bad+" ")
	if err != nil {
		t.Fatal(err)
	}
	res, err := svc.VerifySearchConnection(ctx, user, conn.ID)
	if err != nil || res.OK {
		t.Fatalf("a refused key verified: %+v %v", res, err)
	}
	if strings.Contains(res.Message, "SECRET") || !strings.Contains(res.Message, "refused the key") {
		t.Fatalf("verify message %q", res.Message)
	}
	rows, _ := svc.ListSearchConnections(ctx, user)
	for _, r := range rows {
		if strings.Contains(r.LastError, "SECRET") {
			t.Fatalf("stored last error carries the key: %q", r.LastError)
		}
	}

	if _, err := svc.SaveSearchConnection(ctx, user, byok.ProviderYouTubeData, good); err != nil {
		t.Fatal(err)
	}
	if key, err := svc.YouTubeDataKey(ctx, user); err != nil || key != good {
		t.Fatalf("key read back: %v", err)
	}
	if res, err := svc.VerifySearchConnection(ctx, user, conn.ID); err != nil || !res.OK {
		t.Fatalf("a good key: %+v %v", res, err)
	}
	// It is not a web-search key.
	if chain, err := svc.SearchFor(ctx, user); err == nil && chain != nil && chain.Len() > 0 {
		t.Fatalf("the YouTube Data API key joined the web-search chain")
	}
}
