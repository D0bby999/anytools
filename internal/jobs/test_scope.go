package jobs

import (
	"sync"

	"github.com/google/uuid"
)

// testScope keeps one test process's workers off another's jobs.
//
// `go test ./...` runs packages as separate processes in parallel, all against
// the one test database. A worker in one package (internal/app wires every
// handler) used to claim a job another package had just enqueued: the exam
// harness found its extraction already taken, and a chat turn was run by a
// worker with another package's model. With the scope on, Claim takes only
// jobs of users this process enqueued for; every test user is its own, so no
// two processes share one. Production never turns it on.
var testScope struct {
	sync.Mutex
	on    bool
	users map[uuid.UUID]struct{}
}

// ScopeClaimsToThisProcess is for tests only: testutil.TestDB calls it.
func ScopeClaimsToThisProcess() {
	testScope.Lock()
	defer testScope.Unlock()
	if !testScope.on {
		testScope.on = true
		testScope.users = map[uuid.UUID]struct{}{}
	}
}

// noteEnqueuedFor records a job's user while the scope is on.
func noteEnqueuedFor(userID uuid.UUID) {
	testScope.Lock()
	defer testScope.Unlock()
	if testScope.on {
		testScope.users[userID] = struct{}{}
	}
}

// claimableUsers is nil when the scope is off (any user's job), else the users
// this process enqueued for.
func claimableUsers() []uuid.UUID {
	testScope.Lock()
	defer testScope.Unlock()
	if !testScope.on {
		return nil
	}
	out := make([]uuid.UUID, 0, len(testScope.users))
	for u := range testScope.users {
		out = append(out, u)
	}
	return out
}
