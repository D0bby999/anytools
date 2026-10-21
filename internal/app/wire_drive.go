package app

import (
	"context"
	"log/slog"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/driveapi"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_drive.go — phase 13's wiring, in its own file.
//
// Three seams are closed here and nowhere else, which is the point of keeping
// it separate from wire.go: the connector talks to the Knowledge Center only
// through knowledge.Service.ImportExternal, to authorization only through
// authz.Authorizer, and to the readiness matrix only through a string-typed
// row. None of the three packages knows Drive exists.

// driveConnector is the Drive connector before the Knowledge Center exists:
// enough to authenticate, and so to keep learners' files in their Drives.
type driveConnector struct {
	svc   *drive.Service
	store *pg.DriveStore
}

// newDriveConnector builds the connector's token half.
//
// It returns nil when no Google OAuth client is configured, and that is a
// normal state rather than a failure: a deployment without a GCP project
// simply has no Drive routes and no Drive storage, so the UI never offers a
// button that cannot work. As of this phase that is EVERY deployment — the
// owner has not created the project yet (reports/spike-drive.md is BLOCKED
// on exactly that, with the eight steps in docs/byok.md).
//
// It is built BEFORE the Knowledge Center (drive-user-storage phase 1): the
// Knowledge Center's file store routes a learner's files to their Drive,
// which authenticates through this connector. buildDrive finishes it once
// the Knowledge Center exists.
func newDriveConnector(cfg *config.Config, pool *pg.Pool) *driveConnector {
	oauthCfg := drive.ConfigFromEnv()
	if !oauthCfg.Configured() {
		slog.Info("boot: Google Drive connector is off (no ANYTOOLS_GOOGLE_CLIENT_ID/SECRET)")
		return nil
	}
	store := pg.NewDriveStore(pool, cfg.Security.EncryptionKey)
	users := pg.NewUserStore(pool)
	return &driveConnector{
		svc: drive.NewService(drive.Config{
			Store:          store,
			OAuth:          oauthCfg,
			MaxImportBytes: knowledge.MaxUploadBytes,
			EmailOf: func(ctx context.Context, userID uuid.UUID) (string, error) {
				u, err := users.GetUser(ctx, userID)
				if err != nil {
					return "", err
				}
				return u.Email, nil
			},
		}),
		store: store,
	}
}

// buildDriveStorage is the Drive backend for learners' own files: the
// connector's Storage for the Drive calls, drive_files for where each file
// is, and a bounded cache under the data directory. Nil without a connector.
func buildDriveStorage(cfg *config.Config, pool *pg.Pool, local *blob.Local, dc *driveConnector) (*blob.Drive, error) {
	if dc == nil {
		return nil, nil
	}
	mb := cfg.Storage.DriveCacheMB
	if mb <= 0 {
		mb = blob.DefaultCacheMB
	}
	cache, err := blob.NewCache(filepath.Join(local.Root(), blob.CacheDir), int64(mb)<<20)
	if err != nil {
		return nil, err
	}
	files := pg.NewDriveFileStore(pool)
	remote := drive.NewStorage(dc.svc, drive.StorageConfig{Folders: files, Files: files})
	// Status counts what is in Drive, and a reconnect finds it again; once
	// access is lost, the server keeps no copy of it (phase 3).
	dc.svc.UseStorage(remote)
	dc.svc.OnLostAccess(func(userID uuid.UUID) {
		if err := cache.DeleteUser(userID); err != nil {
			slog.Warn("drive: cached copies left behind after access was lost", "error", err, "user", userID)
		}
	})
	backend, err := blob.NewDrive(blob.DriveConfig{
		Local:  local,
		Remote: remote,
		Index:  files,
		Cache:  cache,
		Title:  files.Title,
	})
	if err != nil {
		return nil, err
	}
	slog.Info("boot: Drive storage ready", "cache_mb", mb)
	return backend, nil
}

// buildDrive finishes the connector over the Knowledge Center and returns
// its routes. Nil without a connector.
func buildDrive(dc *driveConnector, svc *knowledge.Service, authorizer *authz.Authorizer) (*driveapi.Handler, *drive.Service) {
	if dc == nil {
		return nil, nil
	}
	// The import seam. knowledge.ImportExternal owns the caps, the type
	// detection, the blob write and the enqueue; the adapter's only job is
	// to hand it the store that knows about drive_file_id.
	dc.svc.UseKnowledge(driveImporter{svc: svc, docs: dc.store}, authorizer)
	slog.Info("boot: Google Drive connector ready", "scope", drive.ScopeDriveFile)
	return driveapi.NewHandler(dc.svc), dc.svc
}

// driveImporter adapts the Knowledge Center's external-import entry point to
// the one-method interface the connector declares.
type driveImporter struct {
	svc  *knowledge.Service
	docs knowledge.ExternalDocuments
}

func (d driveImporter) Import(ctx context.Context, req drive.ImportRequest) (uuid.UUID, error) {
	res, err := d.svc.ImportExternal(ctx, d.docs, knowledge.ExternalImport{
		UserID:     req.UserID,
		KBID:       req.KBID,
		SourceKind: knowledge.SourceDrive,
		ExternalID: req.ExternalID,
		Filename:   req.Filename,
		Data:       req.Data,
	})
	if err != nil {
		return uuid.Nil, err
	}
	return res.Document.ID, nil
}

// driveReadiness adapts the connector's status to a readiness row.
//
// The string conversion happens HERE rather than in either package, because
// this is the only place that is allowed to know both vocabularies.
type driveReadiness struct{ svc *drive.Service }

func (d driveReadiness) ConnectorReadiness(ctx context.Context, userID uuid.UUID) (byok.ConnectorReadiness, error) {
	st, err := d.svc.Status(ctx, userID)
	if err != nil {
		return byok.ConnectorReadiness{}, err
	}
	status, reason := st.ReadinessLine()
	return byok.ConnectorReadiness{
		Connector: "drive",
		Status:    byok.Status(status),
		Reason:    reason,
	}, nil
}

// startDriveSync runs the periodic poll.
//
// Every fifteen minutes, and the first sweep runs after one interval rather
// than immediately: a restart is not evidence that anything in anyone's Drive
// changed, and syncing every connected user during boot would compete with the
// job reaper for the same pool at the worst moment.
//
// The whole sweep shares one bounded context. A single user's Drive going slow
// must not hold the sweep past the next tick and stack sweeps on top of each
// other.
func startDriveSync(ctx context.Context, wg *sync.WaitGroup, connector *drive.Service) {
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(drive.SyncInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				sweepCtx, cancel := context.WithTimeout(ctx, drive.SyncInterval-time.Minute)
				users, failed := connector.SyncAll(sweepCtx)
				cancel()
				if users > 0 {
					slog.Info("drive: periodic sync finished", "users", users, "failed", failed)
				}
			}
		}
	}()
	slog.Info("boot: Drive sync scheduled", "interval", drive.SyncInterval)
}
