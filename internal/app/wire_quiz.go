package app

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/masteryapi"
	"github.com/D0bby999/anytools/internal/api/quizapi"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/capabilities/mastery"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_quiz.go assembles phase 7: the question bank, the mastery path, and the
// nightly due digest.
//
// It is a separate file from wire.go for the reason wire.go's own header gives:
// one explicit builder per subsystem, each nameable and separately testable,
// rather than a construction god-function. It is also the merge seam — three
// collaborators come from other branches and are named in one place here.

// buildQuizMastery assembles the quiz and mastery handlers and the background
// digest job.
//
// The resolver is the same BYOK chat resolver grounded chat uses, so a user
// with no chat route gets NO_PROVIDER here exactly as they do in chat.
func buildQuizMastery(
	pool *pg.Pool, kb knowledgeSubsystem, resolver runtime.ChatProviderResolver, now func() time.Time,
	notify learning.Notifier,
) (*quizapi.Handler, *masteryapi.Handler, func(context.Context, *sync.WaitGroup)) {
	masteryStore := pg.NewMasteryStore(pool)
	retriever := newQuizRetriever(kb)
	quizSvc := newQuizService(pool, kb, resolver, now)

	masterySvc := mastery.NewService(mastery.Config{
		Store:     masteryStore,
		Quiz:      quizSvc,
		Outline:   masteryStore,
		Providers: resolver,
		Authz:     kbAuthorizer{kb.authz},
		Retriever: retriever,
		// Learning depth, phase 9: learn and explain-back read the learner's
		// Preferences and this knowledge base's Struggles.
		Profile: newLearnerProfile(pool),
		Now:     now,
	})

	// After an attempt that advanced a knowledge point, check whether its
	// module just crossed its bar. Best-effort and logged: Graduate is
	// idempotent, so a failure here is retried by the next attempt rather than
	// leaving a module permanently un-graduated.
	graduate := func(userID, kpID uuid.UUID) {
		graduated, err := masterySvc.GraduateForKnowledgePoint(context.Background(), userID, kpID)
		if err != nil {
			slog.Warn("mastery: graduation check failed", "user", userID, "knowledge_point", kpID, "error", err)
			return
		}
		for _, m := range graduated {
			slog.Info("mastery: module graduated", "user", userID, "module", m.ModuleID, "mastery", m.Mastery)
		}
	}

	// The review reminder (internal/push); nil logs instead.
	digest := learning.NewDueDigestJob(pool, masteryStore, notify)
	start := func(ctx context.Context, wg *sync.WaitGroup) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			digest.Start(ctx)
		}()
		slog.Info("boot: mastery due digest scheduled", "every", "hour")
	}

	return quizapi.NewHandler(quizSvc, graduate), masteryapi.NewHandler(masterySvc), start
}

// newQuizService is the question bank's service. The living books (phase 11
// of learning depth) write their quiz blocks through one of their own, built
// here from the same store, retrieval and authorizer.
func newQuizService(pool *pg.Pool, kb knowledgeSubsystem, resolver runtime.ChatProviderResolver, now func() time.Time) *quiz.Service {
	return quiz.NewService(quiz.Config{
		Store:     pg.NewQuestionStore(pool),
		Retriever: newQuizRetriever(kb),
		Providers: resolver,
		Authz:     kbAuthorizer{kb.authz},
		Now:       now,
	})
}

func newQuizRetriever(kb knowledgeSubsystem) quizRetriever {
	return quizRetriever{inner: kbRetriever{retriever: kb.retriever, kbs: kb.service, providers: kb.providers}}
}

// kbAuthorizer adapts authz.Authorizer to the interface the quiz and mastery
// services declare. The signatures already match; the adapter exists so that
// those packages do not import internal/authz to name one method.
type kbAuthorizer struct{ *authz.Authorizer }

// quizRetriever is the quiz capability's Retriever: the SAME embed-then-search
// adapter grounded chat's rag_search uses, narrowed to one knowledge base and
// converted to the quiz package's Chunk.
//
// One knowledge base because a question has one kb_id column, and the
// citations in its explanation have to resolve inside it.
type quizRetriever struct{ inner kbRetriever }

// Search implements quiz.Retriever.
func (r quizRetriever) Search(
	ctx context.Context, userID uuid.UUID, kbIDs []uuid.UUID, query string, limit int,
) ([]quiz.Chunk, error) {
	if len(kbIDs) != 1 {
		return nil, fmt.Errorf("quiz retrieval: expected one knowledge base, got %d", len(kbIDs))
	}
	hits, err := r.inner.Search(ctx, userID, kbIDs, query, limit)
	if err != nil {
		return nil, err
	}
	out := make([]quiz.Chunk, 0, len(hits))
	for _, h := range hits {
		id, err1 := uuid.Parse(h.ID)
		docID, err2 := uuid.Parse(h.DocumentID)
		if err1 != nil || err2 != nil {
			return nil, fmt.Errorf("quiz retrieval: malformed chunk id %q / %q", h.ID, h.DocumentID)
		}
		out = append(out, quiz.Chunk{
			ID: id, DocumentID: docID, DocumentTitle: h.DocumentTitle,
			Page: h.Page, Text: h.Text,
		})
	}
	return out, nil
}
