package app

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"log/slog"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/appsapi"
	"github.com/D0bby999/anytools/internal/api/storageapi"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/connectors/appconn"
	"github.com/D0bby999/anytools/internal/connectors/canva"
	"github.com/D0bby999/anytools/internal/connectors/notion"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// learningApps is Canva and Notion (learning-tool-connections phases 8 and
// 9): one OAuth service for both, each app's bridge, and their routes. An app
// without ANYTOOLS_<APP>_CLIENT_ID and _SECRET answers "not set up here".
type learningApps struct {
	handler *appsapi.Handler
	canva   *canva.Service
	notion  *notion.Service
}

func buildApps(cfg *config.Config, pool *pg.Pool, kb knowledgeSubsystem) learningApps {
	env := func(name string) string { return strings.TrimSpace(config.Getenv(name)) }
	conn := appconn.NewService(pg.NewAppConnStore(pool, cfg.Security.EncryptionKey),
		canva.Provider(env("ANYTOOLS_CANVA_CLIENT_ID"), env("ANYTOOLS_CANVA_CLIENT_SECRET")),
		notion.Provider(env("ANYTOOLS_NOTION_CLIENT_ID"), env("ANYTOOLS_NOTION_CLIENT_SECRET")),
	)
	cv := canva.NewService(conn, security.SafeClient(2*time.Minute))
	nt := notion.NewService(conn, pg.NewNotionStore(pool), kbBridge{kb: kb})
	return learningApps{
		handler: appsapi.NewHandler(conn, cv, nt, kbBridge{kb: kb}, cfg.Server.AppURL),
		canva:   cv,
		notion:  nt,
	}
}

// sinks adds "Open in Canva" and "Export to Notion" to every export.
func (a learningApps) sinks(h *storageapi.Handler) {
	h.WithSink("canva", canvaSink{a.canva})
	h.WithSink("notion", notionSink{a.notion})
}

func appErr(err error) error {
	switch {
	case errors.Is(err, appconn.ErrNotConnected), errors.Is(err, appconn.ErrNotConfigured):
		return storageapi.ErrAppNotConnected
	case errors.Is(err, appconn.ErrNeedsReconnect):
		return storageapi.ErrAppReconnect
	case errors.Is(err, notion.ErrNoParent):
		return storageapi.ErrAppNoTarget
	}
	return err
}

type canvaSink struct{ svc *canva.Service }

func (c canvaSink) CreateDoc(ctx context.Context, userID uuid.UUID, name, markdown string) (string, string, string, error) {
	d, err := c.svc.ImportMarkdown(ctx, userID, name, markdown)
	if err != nil {
		return "", "", "", appErr(err)
	}
	return d.ID, d.Title, d.EditURL, nil
}

type notionSink struct{ svc *notion.Service }

func (n notionSink) CreateDoc(ctx context.Context, userID uuid.UUID, name, markdown string) (string, string, string, error) {
	p, err := n.svc.Export(ctx, userID, "", name, markdown)
	if err != nil {
		return "", "", "", appErr(err)
	}
	return p.ID, p.Title, p.URL, nil
}

// startNotionSync imports again, hourly, the Notion pages that changed.
func startNotionSync(ctx context.Context, wg *sync.WaitGroup, svc *notion.Service) {
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(notion.SyncInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				passCtx, cancel := context.WithTimeout(ctx, notion.SyncInterval-5*time.Minute)
				users, changed := svc.SyncAll(passCtx)
				cancel()
				if users > 0 {
					slog.Info("notion: sync pass", "users", users, "changed", changed)
				}
			}
		}
	}()
}
