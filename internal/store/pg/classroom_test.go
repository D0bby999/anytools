package pg_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/classroom"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// A linked class keeps what was imported; deleting its knowledge base
// unlinks it.
func TestClassroomStore(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	store := pg.NewClassroomStore(pool)
	user := testutil.NewUser(t, pool)

	var kb uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO knowledge_bases (user_id, name) VALUES ($1, 'Biology 10A') RETURNING id`, user).Scan(&kb); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetLink(ctx, user, "c1"); !errors.Is(err, classroom.ErrNotLinked) {
		t.Fatalf("none yet: %v", err)
	}
	now := time.Now()
	if err := store.SaveLink(ctx, classroom.Link{UserID: user, CourseID: "c1", CourseName: "Biology 10A", KBID: kb, Seen: []string{"youtube:x"}, NewCount: 2, CheckedAt: &now}); err != nil {
		t.Fatal(err)
	}
	got, err := store.GetLink(ctx, user, "c1")
	if err != nil || got.KBID != kb || !slices.Equal(got.Seen, []string{"youtube:x"}) || got.NewCount != 2 {
		t.Fatalf("%+v %v", got, err)
	}
	if links, _ := store.ListLinks(ctx, user); len(links) != 1 {
		t.Fatalf("list: %d", len(links))
	}
	if _, err := pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1`, kb); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetLink(ctx, user, "c1"); !errors.Is(err, classroom.ErrNotLinked) {
		t.Fatal("a deleted knowledge base unlinks its class")
	}
}
