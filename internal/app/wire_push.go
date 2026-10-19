package app

import (
	"time"

	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/push"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// buildPush is the daily review reminder. The push services a browser can
// subscribe through are third-party hosts named by the browser, so the sender
// uses SafeClient (no private addresses, no redirects off a refused host), and
// push.ValidateEndpoint keeps it to the known push services.
func buildPush(pool *pg.Pool, cfg *config.Config) *push.Service {
	return push.NewService(
		pg.NewPushStore(pool, cfg.Security.EncryptionKey),
		push.WebPush{Client: security.SafeClient(20 * time.Second), Subscriber: cfg.Server.AppURL},
		cfg.Server.AppURL,
	)
}
