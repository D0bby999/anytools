package pg_test

import (
	"fmt"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

var counter atomic.Uint64

// uniqueEmail and uniqueSubject keep tests independent of each other and of
// leftover rows, so the suite is safe to run repeatedly against one database.
func uniqueEmail(t *testing.T) string {
	t.Helper()
	return fmt.Sprintf("lp-%s-%d@example.test", sanitize(t.Name()), counter.Add(1))
}

func uniqueSubject(t *testing.T) string {
	t.Helper()
	return fmt.Sprintf("sub-%s-%d", sanitize(t.Name()), counter.Add(1))
}

func sanitize(name string) string {
	return strings.ToLower(strings.NewReplacer("/", "-", "_", "-", " ", "-").Replace(name))
}

func upperCase(s string) string { return strings.ToUpper(s) }

// pgxpoolAlias keeps the sentinel test's helper signature readable.
type pgxpoolAlias = pgxpool.Pool
