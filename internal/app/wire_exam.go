package app

import (
	"context"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/examapi"
	"github.com/D0bby999/anytools/internal/capabilities/exam"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_exam.go wires the exam mimic (learning depth, phase 3): the paper is
// read through the learner's `parse` chain (the same one knowledge-base
// documents use), questions are listed, written and marked on their `quiz`
// route, and every answer goes through the question bank's own attempt path,
// so an exam mistake is a bank mistake. Both jobs run on the knowledge
// workers.
func buildExams(pool *pg.Pool, kb knowledgeSubsystem, resolver runtime.ChatProviderResolver) *examapi.Handler {
	retriever := quizRetriever{inner: kbRetriever{
		retriever: kb.retriever, kbs: kb.service, providers: kb.providers,
	}}
	// The bank's own service: the store, route and authorizer the quiz
	// routes use, so marking here is marking there.
	bank := quiz.NewService(quiz.Config{
		Store:     pg.NewQuestionStore(pool),
		Retriever: retriever,
		Providers: resolver,
		Authz:     kbAuthorizer{kb.authz},
	})
	svc := exam.NewService(exam.Deps{
		Store:     pg.NewExamStore(pool),
		Authz:     kbAuthorizer{kb.authz},
		Parsers:   examParsers{kb.providers},
		Models:    resolver,
		Retriever: retriever,
		Marker:    bank,
		Queue:     kb.queue,
		Files:     kb.objects,
	})
	kb.jobHandlers[jobs.KindExtractExam] = svc.HandleExtract
	kb.jobHandlers[jobs.KindGenerateExam] = svc.HandleGenerate
	return examapi.NewHandler(svc)
}

// examParsers is the knowledge base's parser chain (byokProviders), which
// already drops lanes on cooldown.
type examParsers struct{ providers knowledge.Providers }

func (p examParsers) ParserChain(ctx context.Context, userID uuid.UUID) ([]parse.PageParser, error) {
	return p.providers.ParserChain(ctx, userID)
}
