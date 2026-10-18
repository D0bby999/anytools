package mastery

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

// review.go is the cross-path review: one session over every active path,
// where the learner's different subjects alternate.
//
// Source: up, docs/en/threads/part-1/1-understanding.md §8 ("Spacing,
// Interleaving and Sleep"). Two of its rules shape this file. Interleave
// different topics, so the next item comes from another module (and another
// path when one has anything due). Change one variable at a time, so nothing
// else does: each item is still one question of one point, asked exactly as
// the per-path session would ask it. Its third rule, adjusting intervals by
// performance, is FSRS's job and already happens on answer.

// ReviewCandidateLimit bounds how many due points one review step reads
// (red team AS-11).
const ReviewCandidateLimit = 200

// ReviewCandidate is a due point with the path it belongs to.
type ReviewCandidate struct {
	learning.Candidate
	PathID   uuid.UUID
	PathGoal string
}

// ReviewStore is the persistence the cross-path review adds.
type ReviewStore interface {
	// ReviewCandidates lists due points across every active path, oldest due
	// first, at most limit of them.
	ReviewCandidates(ctx context.Context, userID uuid.UUID, now time.Time, limit int) ([]ReviewCandidate, error)
	// LastAttemptedPoint is the point of the learner's most recent mastery
	// question attempt; ok is false when there is none.
	LastAttemptedPoint(ctx context.Context, userID uuid.UUID) (kpID uuid.UUID, ok bool, err error)
}

// ReviewNext returns the next item of the cross-path review.
//
// after names the point the client just showed. It overrides the learner's
// last attempt as "the previous point", and is resolved with the caller's id:
// a point that is not theirs is ignored exactly as a missing one is, so the
// answer never says whether someone else's id exists.
func (s *Service) ReviewNext(ctx context.Context, userID uuid.UUID, after *uuid.UUID) (*NextQuestion, error) {
	now := s.now().UTC()
	candidates, err := s.store.ReviewCandidates(ctx, userID, now, ReviewCandidateLimit)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return nil, ErrNothingDue
	}

	prev, err := s.previousModule(ctx, userID, after)
	if err != nil {
		return nil, err
	}
	chosen := interleave(rankReview(candidates, now), prev)

	path, err := s.store.GetPath(ctx, userID, chosen.PathID)
	if err != nil {
		return nil, err
	}
	next, err := s.serve(ctx, userID, path, chosen.Candidate, now, len(candidates)-1, false)
	if err != nil {
		return nil, err
	}

	// The explain-back itself stays on its own path; the review only says
	// one is waiting there.
	waiting, err := s.store.AwaitingExplainBack(ctx, userID, chosen.PathID)
	if err != nil {
		return nil, err
	}
	next.ExplainBackWaiting = len(waiting) > 0
	return next, nil
}

// previousModule is the module of the point the learner saw last: after when
// it is one of theirs, else their latest mastery attempt. nil when neither
// exists.
func (s *Service) previousModule(ctx context.Context, userID uuid.UUID, after *uuid.UUID) (*Module, error) {
	if after != nil {
		_, module, err := s.store.KnowledgePoint(ctx, userID, *after)
		if err == nil {
			return module, nil
		}
		if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
	}
	kpID, ok, err := s.store.LastAttemptedPoint(ctx, userID)
	if err != nil || !ok {
		return nil, err
	}
	_, module, err := s.store.KnowledgePoint(ctx, userID, kpID)
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	return module, err
}

// rankReview orders the candidates with learning.Rank, the per-path order,
// keeping each one's path.
func rankReview(candidates []ReviewCandidate, now time.Time) []ReviewCandidate {
	plain := make([]learning.Candidate, len(candidates))
	byID := make(map[uuid.UUID]ReviewCandidate, len(candidates))
	for i, c := range candidates {
		plain[i] = c.Candidate
		byID[c.KPID] = c
	}
	out := make([]ReviewCandidate, 0, len(candidates))
	for _, c := range learning.Rank(plain, now) {
		out = append(out, byID[c.KPID])
	}
	return out
}

// interleave picks the highest-ranked candidate from a different module than
// the previous point's, and from a different path when one has anything due.
// It falls back to the same module only when no other module has anything.
func interleave(ranked []ReviewCandidate, prev *Module) ReviewCandidate {
	if prev == nil {
		return ranked[0]
	}
	otherModule := -1
	for i, c := range ranked {
		if c.ModuleID == prev.ID {
			continue
		}
		if c.PathID != prev.PathID {
			return c
		}
		if otherModule < 0 {
			otherModule = i
		}
	}
	if otherModule >= 0 {
		return ranked[otherModule]
	}
	return ranked[0]
}
