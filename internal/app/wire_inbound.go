package app

import (
	"context"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/inboundapi"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/connectors/gphotos"
	"github.com/D0bby999/anytools/internal/inbound"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// buildInbound is email in (learning-tool-connections phase 4). Without
// ANYTOOLS_INBOUND_SECRET every delivery is refused and Learning apps says
// email is not set up here; the domain defaults to in.<the app's host>.
func buildInbound(cfg *config.Config, pool *pg.Pool, kb knowledgeSubsystem) *inboundapi.Handler {
	domain := strings.TrimSpace(config.Getenv("ANYTOOLS_INBOUND_DOMAIN"))
	if domain == "" {
		domain = "in.anytools.world"
	}
	svc := inbound.NewService(
		pg.NewInboundStore(pool, cfg.Security.EncryptionKey),
		kbBridge{kb: kb},
		strings.TrimSpace(config.Getenv("ANYTOOLS_INBOUND_SECRET")),
		domain,
	)
	return inboundapi.NewHandler(svc)
}

// kbBridge adapts the Knowledge Center to what the learning-tool connectors
// use: email in (phase 4) and Google Classroom (phase 6).
type kbBridge struct{ kb knowledgeSubsystem }

func (k kbBridge) OwnsKB(ctx context.Context, userID, kbID uuid.UUID) error {
	return k.kb.authz.OwnsKB(ctx, userID, kbID)
}

func (k kbBridge) CreateKB(ctx context.Context, userID uuid.UUID, name string) (uuid.UUID, error) {
	created, err := k.kb.service.CreateKB(ctx, userID, name)
	if err != nil {
		return uuid.Nil, err
	}
	return created.ID, nil
}

func (k kbBridge) Upload(ctx context.Context, userID, kbID uuid.UUID, filename string, data []byte) (uuid.UUID, error) {
	res, err := k.kb.service.Upload(ctx, userID, kbID, filename, data)
	if err != nil {
		return uuid.Nil, err
	}
	return res.Document.ID, nil
}

// AddLink files a URL as a link document: a YouTube video or a web page.
func (k kbBridge) AddLink(ctx context.Context, userID, kbID uuid.UUID, rawURL string) error {
	_, err := k.kb.service.AddLink(ctx, userID, kbID, rawURL, false)
	return err
}

// UploadPhotos files photos picked in Google Photos as one photo document
// (learning-tool-connections phase 7).
func (k kbBridge) UploadPhotos(ctx context.Context, userID, kbID uuid.UUID, photos []gphotos.Photo) (uuid.UUID, error) {
	files := make([]knowledge.PhotoFile, 0, len(photos))
	for _, p := range photos {
		files = append(files, knowledge.PhotoFile{Name: p.Name, Data: p.Data})
	}
	res, err := k.kb.service.UploadPhotos(ctx, userID, kbID, files)
	if err != nil {
		return uuid.Nil, err
	}
	return res.Document.ID, nil
}

// DeleteDocument removes a document (Notion's re-import replaces its copy).
func (k kbBridge) DeleteDocument(ctx context.Context, userID, kbID, docID uuid.UUID) error {
	return k.kb.service.DeleteDocument(ctx, userID, kbID, docID)
}
