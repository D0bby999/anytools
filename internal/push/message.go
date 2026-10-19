package push

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// pushHosts are the push services browsers subscribe through. An endpoint
// arrives from the browser, so the learner controls it: without this list the
// server would POST wherever a request said. An exact host, or with a
// leading dot the host itself and any subdomain of it.
var pushHosts = []string{
	"fcm.googleapis.com",         // Chrome, Edge on Android, most Chromium
	"android.googleapis.com",     // older Chrome subscriptions
	".push.services.mozilla.com", // Firefox (updates.push.services.mozilla.com)
	".push.apple.com",            // Safari, and Home Screen web apps on iOS
	".notify.windows.com",        // Edge on Windows
}

// ValidateEndpoint accepts an https URL on a known push service, with no
// credentials and no port other than 443.
func ValidateEndpoint(raw string) error {
	if len(raw) > 2048 {
		return fmt.Errorf("%w: the endpoint is too long", ErrInvalid)
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Host == "" {
		return fmt.Errorf("%w: the endpoint must be an https URL", ErrInvalid)
	}
	if p := u.Port(); p != "" && p != "443" {
		return fmt.Errorf("%w: the endpoint names a port", ErrInvalid)
	}
	host := strings.ToLower(u.Hostname())
	for _, h := range pushHosts {
		if host == strings.TrimPrefix(h, ".") || strings.HasPrefix(h, ".") && strings.HasSuffix(host, h) {
			return nil
		}
	}
	return fmt.Errorf("%w: %s is not a browser push service", ErrInvalid, host)
}

// message is a Declarative Web Push payload (WebKit, Safari 18.4+): Safari
// shows it without running any script, and the service worker (public/sw.js)
// reads the same JSON in every other browser.
func (s *Service) message(body, path string, badge int, language string) []byte {
	if _, ok := reminderText[language]; !ok {
		language = "en"
	}
	n := map[string]any{
		"title":    "AnyLearn",
		"body":     body,
		"navigate": s.appURL + path,
		"lang":     language,
		"dir":      "ltr",
		"tag":      "anylearn-review",
	}
	if badge > 0 {
		n["app_badge"] = strconv.Itoa(badge)
	}
	b, _ := json.Marshal(map[string]any{"web_push": 8030, "notification": n})
	return b
}

// WebPush is the production Sender: RFC 8291 encryption and a VAPID JWT, over
// an HTTP client that refuses private addresses.
type WebPush struct {
	Client     *http.Client
	Subscriber string
}

// Send implements Sender.
func (w WebPush) Send(ctx context.Context, sub Subscription, payload []byte, keys Keys) error {
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		HTTPClient:      w.Client,
		Subscriber:      w.Subscriber,
		VAPIDPublicKey:  keys.Public,
		VAPIDPrivateKey: keys.Private,
		// A reminder a day late is noise; the push service may drop it.
		TTL:     int((12 * time.Hour).Seconds()),
		Urgency: webpush.UrgencyNormal,
		Topic:   "anylearn-review",
	})
	if err != nil {
		return fmt.Errorf("push: send: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return ErrGone
	case resp.StatusCode >= 300:
		return fmt.Errorf("push: the push service answered %d", resp.StatusCode)
	}
	return nil
}

func generateKeys() (Keys, error) {
	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return Keys{}, fmt.Errorf("push: generate VAPID keys: %w", err)
	}
	return Keys{Public: public, Private: private}, nil
}
