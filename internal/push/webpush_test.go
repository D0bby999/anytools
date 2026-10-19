package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// browserSubscription is what a real browser sends: a P-256 public key and a
// 16-byte auth secret, base64url.
func browserSubscription(t *testing.T, endpoint string) Subscription {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	secret := make([]byte, 16)
	_, _ = rand.Read(secret)
	enc := base64.RawURLEncoding
	return Subscription{Endpoint: endpoint, P256dh: enc.EncodeToString(key.PublicKey().Bytes()), Auth: enc.EncodeToString(secret)}
}

func TestWebPushEncryptsSignsAndReportsGone(t *testing.T) {
	keys, err := generateKeys()
	if err != nil {
		t.Fatal(err)
	}
	status := http.StatusCreated
	var auth, encoding, topic string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth, encoding, topic = r.Header.Get("Authorization"), r.Header.Get("Content-Encoding"), r.Header.Get("Topic")
		w.WriteHeader(status)
	}))
	defer srv.Close()

	sender := WebPush{Client: srv.Client(), Subscriber: "https://anytools.world"}
	sub := browserSubscription(t, srv.URL+"/push/abc")
	if err := sender.Send(context.Background(), sub, []byte(`{"web_push":8030}`), keys); err != nil {
		t.Fatalf("send: %v", err)
	}
	if !strings.HasPrefix(auth, "vapid t=") || !strings.Contains(auth, "k="+keys.Public) {
		t.Errorf("Authorization = %q, want a VAPID header with the public key", auth)
	}
	if encoding != "aes128gcm" || topic != "anylearn-review" {
		t.Errorf("Content-Encoding = %q, Topic = %q", encoding, topic)
	}

	status = http.StatusGone
	if err := sender.Send(context.Background(), sub, []byte("{}"), keys); !errors.Is(err, ErrGone) {
		t.Fatalf("410: err = %v, want ErrGone", err)
	}
	status = http.StatusBadRequest
	if err := sender.Send(context.Background(), sub, []byte("{}"), keys); err == nil || errors.Is(err, ErrGone) {
		t.Fatalf("400: err = %v, want a plain failure", err)
	}
}
