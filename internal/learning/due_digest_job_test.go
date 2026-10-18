package learning_test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/testutil"
)

// blockingSource holds the first runner inside the lock until released.
type blockingSource struct {
	entered chan struct{}
	release chan struct{}
	calls   atomic.Int32
}

func (s *blockingSource) DueDigests(context.Context, time.Time) ([]learning.DueSummary, error) {
	if s.calls.Add(1) == 1 {
		close(s.entered)
		<-s.release
	}
	return []learning.DueSummary{{UserID: uuid.New(), Due: 3, Paths: 1}}, nil
}

type countingNotifier struct{ sent atomic.Int32 }

func (n *countingNotifier) Notify(context.Context, learning.DueSummary) error {
	n.sent.Add(1)
	return nil
}

// TestTwoRunnersSendOneDigest: while one runner holds the advisory lock, a
// second — another process, or a second ticker after a slow run — skips
// instead of sending the same digest again.
func TestTwoRunnersSendOneDigest(t *testing.T) {
	pool := testutil.TestDB(t)
	source := &blockingSource{entered: make(chan struct{}), release: make(chan struct{})}
	notify := &countingNotifier{}

	first := learning.NewDueDigestJob(pool, source, notify)
	second := learning.NewDueDigestJob(pool, source, notify)

	done := make(chan error, 1)
	go func() {
		_, ran, err := first.RunOnce(context.Background())
		if err == nil && !ran {
			t.Error("the first runner did not get the lock")
		}
		done <- err
	}()
	<-source.entered

	sent, ran, err := second.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("second runner: %v", err)
	}
	if ran || sent != 0 {
		t.Fatalf("second runner ran=%v sent=%d while the first held the lock", ran, sent)
	}

	close(source.release)
	if err := <-done; err != nil {
		t.Fatalf("first runner: %v", err)
	}
	if got := notify.sent.Load(); got != 1 {
		t.Fatalf("digests sent = %d, want 1", got)
	}
	if got := source.calls.Load(); got != 1 {
		t.Fatalf("due summaries computed %d times, want 1", got)
	}
}
