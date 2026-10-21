package app

import (
	"github.com/D0bby999/anytools/internal/api/workspaceapi"
	"github.com/D0bby999/anytools/internal/capabilities/reading"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/gforms"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/vocab"
)

// buildWorkspace is Google Forms and Sheets (learning-tool-connections phase
// 5), through the Google grant Drive holds. Nil without Drive: a deployment
// with no Google client has no routes for it.
func buildWorkspace(pool *pg.Pool, kb knowledgeSubsystem, google *drive.Service, resolver runtime.ChatProviderResolver, pages reading.PageLoader) *workspaceapi.Handler {
	if google == nil {
		return nil
	}
	bank := newQuizService(pool, kb, resolver, nil)
	words := vocab.NewService(vocab.Config{Store: pg.NewVocabStore(pool), Pages: vocabPages{pages}, Zones: pg.NewUserStore(pool)})
	return workspaceapi.NewHandler(gforms.NewService(google, bank), google, words, kb.authz)
}
