package pg_test

import (
	"fmt"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var counter atomic.Uint64

// run tells this process's values from every earlier run's. The counter alone
// repeats: a full run reaches the same test at the same count every time, so a
// row an interrupted run left behind collided with the next run's sign-up.
var run = uuid.NewString()[:8]

// uniqueEmail and uniqueSubject keep tests independent of each other and of
// leftover rows, so the suite is safe to run repeatedly against one database.
func uniqueEmail(t *testing.T) string {
	t.Helper()
	return fmt.Sprintf("lp-%s-%s-%d@example.test", sanitize(t.Name()), run, counter.Add(1))
}

func uniqueSubject(t *testing.T) string {
	t.Helper()
	return fmt.Sprintf("sub-%s-%s-%d", sanitize(t.Name()), run, counter.Add(1))
}

func sanitize(name string) string {
	return strings.ToLower(strings.NewReplacer("/", "-", "_", "-", " ", "-").Replace(name))
}

func upperCase(s string) string { return strings.ToUpper(s) }

// pgxpoolAlias keeps the sentinel test's helper signature readable.
type pgxpoolAlias = pgxpool.Pool
