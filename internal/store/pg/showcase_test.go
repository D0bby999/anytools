package pg_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/D0bby999/anytools/internal/progress"
	"github.com/D0bby999/anytools/internal/showcase"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// A page is the learner's alone: one handle each, read by visitors only when
// published, gone with the page or the account.
func TestPublicProfilesKeepToTheirHandles(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	svc := showcase.NewService(pg.NewShowcaseStore(pool), progress.NewService(pg.NewProgressStore(pool)))
	alice, bob := testutil.NewUser(t, pool), testutil.NewUser(t, pool)
	design := json.RawMessage(`{"version":1,"theme":{},"blocks":[{"type":"summary"},{"type":"about","body":"Hi"}]}`)

	if _, err := svc.Save(ctx, alice, showcase.Input{Handle: "alice-learns", Name: "Alice", Design: design}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Read(ctx, "alice-learns"); !errors.Is(err, showcase.ErrNotFound) {
		t.Fatalf("a draft was read: %v", err)
	}
	if _, err := svc.Save(ctx, bob, showcase.Input{Handle: "Alice-Learns", Name: "Bob", Design: design}); !errors.Is(err, showcase.ErrHandleTaken) {
		t.Fatalf("Bob took Alice's handle: %v", err)
	}

	if _, err := svc.Save(ctx, alice, showcase.Input{Handle: "alice-learns", Name: "Alice", Headline: "Go and Spanish", Published: true, Design: design}); err != nil {
		t.Fatal(err)
	}
	page, err := svc.Read(ctx, "alice-learns")
	if err != nil {
		t.Fatal(err)
	}
	if page.Profile.Name != "Alice" || page.Profile.Headline != "Go and Spanish" || page.Stats.Summary == nil || page.Stats.Calendar != nil {
		t.Fatalf("page = %+v", page)
	}
	mine, err := svc.Mine(ctx, alice)
	if err != nil || mine.Profile == nil || mine.Profile.Handle != "alice-learns" || len(mine.Profile.Design.Blocks) != 2 {
		t.Fatalf("mine = %+v, %v", mine, err)
	}

	// Only a published page its learner lets be indexed is listed for the
	// sitemap; a draft is not, whatever it says.
	listed := func() []string {
		t.Helper()
		pages, err := svc.Listed(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, p := range pages {
			if p.Handle == "alice-learns" || p.Handle == "bobs-draft" {
				out = append(out, p.Handle)
			}
		}
		return out
	}
	if got := listed(); len(got) != 0 {
		t.Fatalf("listed without asking: %v", got)
	}
	if _, err := svc.Save(ctx, alice, showcase.Input{Handle: "alice-learns", Name: "Alice", Published: true, Indexed: true, Design: design}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Save(ctx, bob, showcase.Input{Handle: "bobs-draft", Name: "Bob", Indexed: true, Design: design}); err != nil {
		t.Fatal(err)
	}
	if got := listed(); len(got) != 1 || got[0] != "alice-learns" {
		t.Fatalf("listed = %v, want alice-learns only", got)
	}
	if p, _ := svc.Read(ctx, "alice-learns"); !p.Profile.Indexed {
		t.Fatal("the page does not say it may be indexed")
	}

	// A new handle frees the old one.
	if _, err := svc.Save(ctx, alice, showcase.Input{Handle: "alice", Name: "Alice", Published: true, Design: design}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Read(ctx, "alice-learns"); !errors.Is(err, showcase.ErrNotFound) {
		t.Fatalf("the old handle still answers: %v", err)
	}
	if _, err := svc.Save(ctx, bob, showcase.Input{Handle: "alice-learns", Name: "Bob", Design: design}); err != nil {
		t.Fatalf("a freed handle: %v", err)
	}

	if err := svc.Delete(ctx, alice); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Read(ctx, "alice"); !errors.Is(err, showcase.ErrNotFound) {
		t.Fatalf("a deleted page was read: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, bob); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public_profiles WHERE handle = 'alice-learns'`).Scan(&left); err != nil || left != 0 {
		t.Fatalf("a deleted account's page is left: %d, %v", left, err)
	}
}
