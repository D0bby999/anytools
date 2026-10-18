package app

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/zoteroapi"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/capabilities/zoterolib"
	"github.com/D0bby999/anytools/internal/connectors/zotero"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_zotero.go — the learner's Zotero library (up methods, phase 20): a
// knowledge base's "Add from Zotero", and research's zotero_search (wired
// in buildChatRuntime), both on the learner's own key from Settings →
// Search keys.

// newZoteroClient is the production client: api.zotero.org only, over the
// guarded dialer, with time for a 50 MB stored PDF.
func newZoteroClient() *zotero.Client {
	return zotero.NewClient(security.FetchClient(2 * time.Minute))
}

// buildZotero wires "Add from Zotero".
func buildZotero(pool *pg.Pool, kb knowledgeSubsystem, byokSvc *byok.Service, lib *zotero.Client) *zoteroapi.Handler {
	return zoteroapi.NewHandler(zoterolib.NewService(
		ownership{authz: kb.authz}, byokSvc, lib, zoteroDocs{store: pg.NewKnowledgeStore(pool), svc: kb.service}))
}

// zoteroDocs is the knowledge base's upload path with the item's key kept on
// the document, and its duplicate error translated.
type zoteroDocs struct {
	store *pg.KnowledgeStore
	svc   *knowledge.Service
}

func (d zoteroDocs) ZoteroItemAdded(ctx context.Context, userID, kbID uuid.UUID, itemKey string) (bool, error) {
	return d.store.ZoteroItemAdded(ctx, userID, kbID, itemKey)
}

func (d zoteroDocs) AddZotero(ctx context.Context, userID, kbID uuid.UUID, itemKey, filename string, data []byte) error {
	_, err := d.svc.UploadZotero(ctx, userID, kbID, itemKey, filename, data)
	if knowledge.IsDuplicateDocument(err) {
		return zoterolib.ErrAlreadyAdded
	}
	return err
}
