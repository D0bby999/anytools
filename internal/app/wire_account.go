package app

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/account"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_account.go assembles account deletion (phase 11).

func buildAccount(pool *pg.Pool, kb knowledgeSubsystem, driveConnector *drive.Service, encKey string) *account.Service {
	var d account.DriveDisconnector
	if driveConnector != nil {
		d = driveConnector
	}
	revoker := geminiSubRevoker{
		conns: pg.NewProviderConnectionStore(pool, encKey),
		creds: pg.NewOAuthCredentialStore(pool, encKey),
	}
	return account.New(pool, kb.blobs, d, revoker)
}

// geminiSubRevoker withdraws Gemini Code Assist grants at Google.
//
// Only that lane can be revoked: Google exposes a revocation endpoint for the
// token. The ChatGPT relay's tokens have no public revocation API; deleting
// them is all this side can do, and the Settings copy for that lane says so.
type geminiSubRevoker struct {
	conns *pg.ProviderConnectionStore
	creds *pg.OAuthCredentialStore
}

func (r geminiSubRevoker) RevokeAll(ctx context.Context, userID uuid.UUID) error {
	list, err := r.conns.ListConnections(ctx, userID)
	if err != nil {
		return err
	}
	var errs []error
	for _, c := range list {
		if c.Kind != store.KindOAuthGeminiSub {
			continue
		}
		cred, err := r.creds.GetOAuthCredential(ctx, userID, c.ID)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if err := (drive.OAuthConfig{}).Revoke(ctx, cred.RefreshToken); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
