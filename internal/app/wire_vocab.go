package app

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/vocabapi"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/capabilities/reading"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/vocab"
)

// wire_vocab.go assembles learning-depth phase 7: vocabulary notes and cards,
// and the page-text loader both the vocabulary and the reading surface's
// "Find words to save" check selections against.

// newPageLoader is the reading workspace's page-text loader over the parsed
// Markdown the knowledge pipeline stored.
func newPageLoader(pool *pg.Pool, kb knowledgeSubsystem) reading.PageLoader {
	return reading.PageLoader{
		Workspaces: reading.NewWorkspaces(pg.NewReadingStore(pool)),
		Parsed:     parsedMarkdown{docs: kb.service, blobs: kb.blobs},
	}
}

// buildVocab builds the vocabulary handler.
func buildVocab(pool *pg.Pool, pages reading.PageLoader) *vocabapi.Handler {
	return vocabapi.NewHandler(vocab.NewService(vocab.Config{
		Store: pg.NewVocabStore(pool),
		Pages: vocabPages{pages},
		Zones: pg.NewUserStore(pool),
	}))
}

// parsedMarkdown reads a document's stored parse: the document row is read
// with the caller's user_id, and only then the path it records.
type parsedMarkdown struct {
	docs  *knowledge.Service
	blobs blob.Store
}

// ParsedMarkdown implements reading.ParsedReader.
func (p parsedMarkdown) ParsedMarkdown(ctx context.Context, userID, documentID uuid.UUID) (string, error) {
	doc, err := p.docs.GetDocument(ctx, userID, documentID)
	if err != nil {
		return "", err
	}
	if doc.ParsedMarkdownPath == "" {
		return "", reading.ErrNoText
	}
	return p.blobs.GetParsed(ctx, doc.ParsedMarkdownPath)
}

// vocabPages is reading.PageLoader in the vocabulary's error vocabulary: a
// workspace or document that is not the caller's is vocab.ErrNotFound, and a
// document with no parse yet is vocab.ErrNoText.
type vocabPages struct{ inner reading.PageLoader }

// WorkspacePage implements vocab.PageLoader.
func (v vocabPages) WorkspacePage(ctx context.Context, userID, workspaceID uuid.UUID, page int) (uuid.UUID, string, error) {
	doc, text, err := v.inner.WorkspacePage(ctx, userID, workspaceID, page)
	switch {
	case err == nil:
		return doc, text, nil
	case errors.Is(err, reading.ErrNotFound), errors.Is(err, authz.ErrNoAccess),
		errors.Is(err, blob.ErrNotFound):
		return uuid.Nil, "", vocab.ErrNotFound
	case errors.Is(err, reading.ErrNoText), errors.Is(err, knowledge.ErrNoParsedContent):
		return uuid.Nil, "", vocab.ErrNoText
	}
	return uuid.Nil, "", err
}
