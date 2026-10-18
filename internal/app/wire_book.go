package app

import (
	"github.com/D0bby999/anytools/internal/api/bookapi"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/capabilities/book"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/vocab"
)

// wire_book.go wires the living books (learning depth, phase 11): their
// store, the learner's chat model for the outline and the blocks, the
// question bank (on the learner's `quiz` route) for quiz blocks, the
// vocabulary's schedule for flash cards, and a job kind the knowledge
// workers run.
func buildBooks(pool *pg.Pool, kb knowledgeSubsystem, byokService *byok.Service) *bookapi.Handler {
	resolver := newChatResolver(byokService)
	svc := book.NewService(book.Deps{
		Store:  pg.NewBookStore(pool),
		Models: resolver,
		Quiz:   newQuizService(pool, kb, resolver, nil),
		Cards:  vocab.NewService(vocab.Config{Store: pg.NewVocabStore(pool), Zones: pg.NewUserStore(pool)}),
		Queue:  kb.queue,
	})
	kb.jobHandlers[book.JobKind] = svc.Handle
	return bookapi.NewHandler(svc)
}
