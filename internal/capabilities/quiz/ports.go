// Package quiz is the question bank: ideation → generation → answer → judge.
//
// It is a SERVICE rather than a runtime.Capability, and that is a recorded
// deviation from the phase file's word "capability" (see the phase-07 journal).
// A runtime capability is a streaming TURN — it owns a model loop, emits events
// on a bus, can park on ask_user and be recovered by the sweeper. Nothing in
// phase 7's contract needs any of that: `POST /v1/quiz/generate` is a request
// that returns questions, and `POST /v1/questions/{id}/attempt` is a request
// that returns a verdict. Wrapping them in turns would have added a session
// row, a lease and an SSE reconnect path to two synchronous calls, and given a
// learner a progress stream to watch instead of an answer.
//
// What "capability quiz" DOES mean here is the part the product actually reads:
// the byok route function `quiz` (internal/byok.FunctionQuiz), so a user can
// point question-writing at a different model from chat. That is resolved
// through runtime.ChatProviderResolver below.
package quiz

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
)

// ports.go defines the CONSUMER-SIDE interfaces this package needs from
// subsystems built in other phases. Fakes live in fakes_test.go; the real
// implementations are supplied in internal/app/wire_quiz.go.

// Retriever runs hybrid search over the user's chunks.
//
// The signature is deliberately identical to internal/tools.Retriever, which
// phase 6 declared for the same purpose. Two packages needing the same thing
// from phase 5 should need the SAME thing, so that one adapter satisfies both
// and there is one place where "search this user's knowledge bases" is
// implemented.
//
// userID is a parameter and not optional, for the reason red-team RT-3 gave:
// retrieval scoped only by kb_id is one lost filter away from another
// account's chunks.
type Retriever interface {
	Search(ctx context.Context, userID uuid.UUID, kbIDs []uuid.UUID, query string, limit int) ([]Chunk, error)
}

// Chunk is one retrieved passage, as the generator is shown it.
type Chunk struct {
	ID            uuid.UUID
	DocumentID    uuid.UUID
	DocumentTitle string
	Page          int
	Text          string
}

// Authorizer answers "does this user own this knowledge base".
//
// It returns ErrNoAccess for both "not yours" and "does not exist"; the two are
// indistinguishable on purpose, so an endpoint taking a kb id cannot be used to
// discover which ids are real.
type Authorizer interface {
	OwnsKB(ctx context.Context, userID, kbID uuid.UUID) error
}

// Store is the persistence this service needs. internal/store/pg.QuestionStore
// implements it.
type Store interface {
	// InsertQuestions writes a generated batch and returns the rows with ids.
	InsertQuestions(ctx context.Context, qs []Question) ([]Question, error)
	// GetQuestion reads one question scoped to its owner.
	GetQuestion(ctx context.Context, userID, questionID uuid.UUID) (*Question, error)
	// ListQuestions is the bank, newest first.
	ListQuestions(ctx context.Context, userID uuid.UUID, f Filter) ([]BankEntry, error)
	// ListAttempts returns one question's attempts, newest first.
	ListAttempts(ctx context.Context, userID, questionID uuid.UUID, limit int) ([]Attempt, error)
	// RecordAttempt writes the attempt and, when the question carries a
	// knowledge point, advances that point's FSRS card and its error record IN
	// THE SAME TRANSACTION. Scheduled is nil when there was no knowledge point.
	RecordAttempt(ctx context.Context, w AttemptWrite) (*Attempt, *Scheduled, error)
	// GetAttempt reads one attempt scoped to its owner.
	GetAttempt(ctx context.Context, userID, attemptID uuid.UUID) (*Attempt, error)
	// OverrideAttempt replaces a verdict with the learner's own and reschedules
	// from the corrected outcome, again in one transaction. now is the clock
	// the reschedule uses, for the same reason AttemptWrite.Now exists.
	OverrideAttempt(ctx context.Context, userID, attemptID uuid.UUID, correct bool, attribution string, now time.Time) (*Attempt, *Scheduled, error)
	// ListMistakes is the practice queue: open mistakes practisable today in
	// the learner's zone, ordered, at most limit, plus the uncapped count.
	ListMistakes(ctx context.Context, userID uuid.UUID, f PracticeFilter, limit int) (*PracticeQueue, error)
	// Sources resolves chunk ids to the document and page each came from,
	// scoped to the owner: an id that is not this user's is simply absent.
	Sources(ctx context.Context, userID uuid.UUID, chunkIDs []uuid.UUID) ([]citations.Source, error)
}
