package pg_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/circles"
	"github.com/D0bby999/anytools/internal/progress"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Study days are counted in the learner's zone from every kind of study;
// days before yesterday stay as counted when their rows are deleted.
func TestStudyDaysAreCountedInTheLearnersZoneAndKept(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	store := pg.NewProgressStore(pool)
	user := testutil.NewUser(t, pool)
	if _, err := pool.Exec(ctx, `UPDATE users SET timezone = 'Asia/Ho_Chi_Minh' WHERE id = $1`, user); err != nil {
		t.Fatal(err)
	}
	var card uuid.UUID
	if err := pool.QueryRow(ctx, `
		WITH n AS (INSERT INTO vocab_notes (user_id, term, lang, meaning) VALUES ($1, 'tide', 'en', 'm') RETURNING id)
		INSERT INTO vocab_cards (user_id, note_id, kind, due_at, reps, fsrs_card)
		SELECT $1, n.id, 'recognition', now(), 3, '{"Stability": 30.5}' FROM n RETURNING id`, user).Scan(&card); err != nil {
		t.Fatal(err)
	}
	review := func(at time.Time, rating string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `INSERT INTO vocab_reviews (user_id, card_id, request_id, rating, created_at)
			VALUES ($1, $2, gen_random_uuid(), $3, $4)`, user, card, rating, at); err != nil {
			t.Fatal(err)
		}
	}
	// 23:30 UTC on the 1st is 06:30 on the 2nd in Saigon.
	review(time.Date(2026, 11, 1, 23, 30, 0, 0, time.UTC), "good")
	review(time.Date(2026, 11, 2, 1, 0, 0, 0, time.UTC), "again")
	review(time.Date(2026, 11, 4, 2, 0, 0, 0, time.UTC), "good")
	if _, err := pool.Exec(ctx, `INSERT INTO body_workouts (user_id, day, started_at, finished_at)
		VALUES ($1, '2026-11-04', now(), now()), ($1, '2026-11-05', now(), NULL)`, user); err != nil {
		t.Fatal(err)
	}

	day := func(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }
	if err := store.RefreshDays(ctx, user, "Asia/Ho_Chi_Minh", time.Time{}, day(2026, 11, 6)); err != nil {
		t.Fatal(err)
	}
	got, err := store.Days(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	want := []progress.StudyDay{
		{Day: day(2026, 11, 2), Counts: progress.Counts{Reviews: 2}},
		{Day: day(2026, 11, 4), Counts: progress.Counts{Reviews: 1, Workouts: 1}},
	}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("days: %+v", got)
	}
	_, _, counted, refreshed, _ := store.Settings(ctx, user)
	if !counted.Equal(day(2026, 11, 6)) || time.Since(refreshed) > time.Minute {
		t.Errorf("counted through %v at %v", counted, refreshed)
	}

	// The card's reviews are deleted; recounting from the 5th keeps the 2nd and 4th.
	if _, err := pool.Exec(ctx, `DELETE FROM vocab_reviews WHERE user_id = $1`, user); err != nil {
		t.Fatal(err)
	}
	if err := store.RefreshDays(ctx, user, "Asia/Ho_Chi_Minh", day(2026, 11, 5), day(2026, 11, 6)); err != nil {
		t.Fatal(err)
	}
	if again, _ := store.Days(ctx, user); len(again) != 2 {
		t.Errorf("days after the reviews went: %+v", again)
	}

	o, err := store.Outcomes(ctx, user, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if o.LongTerm != 1 || o.Learning != 1 {
		t.Errorf("outcomes: %+v", o)
	}

	reached, err := store.Reach(ctx, user, map[string]time.Time{"days:1": day(2026, 11, 2)})
	if err != nil {
		t.Fatal(err)
	}
	reached, _ = store.Reach(ctx, user, map[string]time.Time{"days:1": day(2026, 11, 6)})
	if !reached["days:1"].Equal(day(2026, 11, 2)) {
		t.Errorf("a milestone's day moved: %v", reached)
	}
	if err := store.SetSettings(ctx, user, progress.Settings{WeekGoal: 5, RestDays: 2}); err != nil {
		t.Fatal(err)
	}
	if _, set, _, _, _ := store.Settings(ctx, user); set != (progress.Settings{WeekGoal: 5, RestDays: 2}) {
		t.Errorf("settings: %+v", set)
	}
}

func TestStudyCirclesKeepToTheirMembers(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	store := pg.NewCircleStore(pool)
	svc := circles.NewService(store, progress.NewService(pg.NewProgressStore(pool)))
	ann, ben, cat := testutil.NewUser(t, pool), testutil.NewUser(t, pool), testutil.NewUser(t, pool)

	c, err := svc.Create(ctx, ann, "  Evening   readers ", "Ann")
	if err != nil {
		t.Fatal(err)
	}
	if c.Name != "Evening readers" || !c.Owner || c.Members != 1 || len(c.InviteCode) != circles.CodeLength {
		t.Fatalf("created: %+v", c)
	}
	// Ben joins by the code as typed, in lower case with a dash.
	typed := c.InviteCode[:5] + "-" + c.InviteCode[5:]
	joined, err := svc.Join(ctx, ben, typed, "Ben")
	if err != nil || joined.ID != c.ID || joined.Owner || joined.Members != 2 {
		t.Fatalf("join: %+v %v", joined, err)
	}
	if again, err := svc.Join(ctx, ben, c.InviteCode, "Benny"); err != nil || again.Nickname != "Ben" {
		t.Errorf("joining twice: %+v %v", again, err)
	}
	if _, err := svc.Join(ctx, cat, "ZZZZZZZZZZ", "Cat"); !errors.Is(err, circles.ErrNotFound) {
		t.Errorf("a wrong code: %v", err)
	}
	// Cat is not in it: everything answers not found.
	if _, err := svc.Detail(ctx, cat, c.ID); !errors.Is(err, circles.ErrNotFound) {
		t.Errorf("an outsider's view: %v", err)
	}
	mine, benny, ann2 := "Mine", "Benny", "ann"
	if err := svc.Update(ctx, ben, c.ID, &mine, &benny); !errors.Is(err, circles.ErrNotOwner) {
		t.Errorf("a member renamed it: %v", err)
	}
	if err := svc.Update(ctx, ben, c.ID, nil, &ann2); !errors.Is(err, circles.ErrNameTaken) {
		t.Errorf("two members called Ann: %v", err)
	}
	if _, err := svc.Join(ctx, cat, c.InviteCode, "ANN"); !errors.Is(err, circles.ErrNameTaken) {
		t.Errorf("joined as another member's name: %v", err)
	}

	d, err := svc.Detail(ctx, ben, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Members) != 2 || !d.Members[0].Owner || d.Members[0].Nickname != "Ann" || !d.Members[1].Me || d.Members[1].Nickname != "Ben" || d.Members[1].Progress.WeekGoal != 4 {
		t.Fatalf("detail: %+v", d.Members)
	}
	annMember := d.Members[0].ID
	if fresh, err := svc.Cheer(ctx, ben, c.ID, annMember); err != nil || !fresh {
		t.Fatalf("cheer: %v %v", fresh, err)
	}
	if fresh, _ := svc.Cheer(ctx, ben, c.ID, annMember); fresh {
		t.Error("two cheers in a day")
	}
	if _, err := svc.Cheer(ctx, ben, c.ID, d.Members[1].ID); !errors.Is(err, circles.ErrInvalid) {
		t.Errorf("cheering yourself: %v", err)
	}
	cheers, _ := svc.RecentCheers(ctx, ann)
	if len(cheers) != 1 || cheers[0].From != "Ben" || cheers[0].Circle != "Evening readers" {
		t.Errorf("ann's cheers: %+v", cheers)
	}
	if d, _ := svc.Detail(ctx, ben, c.ID); !d.Members[0].Cheered || d.Members[0].Cheers != 1 {
		t.Errorf("the cheer on the page: %+v", d.Members[0])
	}

	// A new code: the old one stops working.
	code, err := svc.NewInvite(ctx, ann, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Join(ctx, cat, c.InviteCode, "Cat"); !errors.Is(err, circles.ErrNotFound) {
		t.Errorf("the old code still works: %v", err)
	}
	if _, err := svc.Join(ctx, cat, code, "Cat"); err != nil {
		t.Fatal(err)
	}
	// The owner leaves: Ben, the next earliest, owns it and removes Cat.
	if err := svc.Leave(ctx, ann, c.ID); err != nil {
		t.Fatal(err)
	}
	d, _ = svc.Detail(ctx, ben, c.ID)
	if !d.Members[0].Me || !d.Members[0].Owner {
		t.Fatalf("after the owner left: %+v", d.Members)
	}
	if err := svc.Remove(ctx, ben, c.ID, d.Members[0].ID); !errors.Is(err, circles.ErrNotFound) {
		t.Errorf("the owner removed themself: %v", err)
	}
	if err := svc.Remove(ctx, ben, c.ID, d.Members[1].ID); err != nil {
		t.Fatal(err)
	}
	// Removing Cat made a new code: the one Cat saw no longer lets her back.
	if _, err := svc.Join(ctx, cat, code, "Cat"); !errors.Is(err, circles.ErrNotFound) {
		t.Errorf("a removed member came back with the old code: %v", err)
	}
	if err := svc.Leave(ctx, ben, c.ID); err != nil {
		t.Fatal(err)
	}
	var left int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM study_circles WHERE id = $1`, c.ID).Scan(&left)
	if left != 0 {
		t.Error("the last member left and the circle stayed")
	}
	// A member who deletes their account takes an empty circle with them,
	// and leaves a shared one to the others.
	dan := testutil.NewUser(t, pool)
	alone, _ := svc.Create(ctx, dan, "Alone", "Dan")
	shared, _ := svc.Create(ctx, dan, "Shared", "Dan")
	if _, err := svc.Join(ctx, ann, shared.InviteCode, "Ann"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, dan); err != nil {
		t.Fatal(err)
	}
	var aloneLeft, sharedLeft int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM study_circles WHERE id = $1`, alone.ID).Scan(&aloneLeft)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM study_circles WHERE id = $1`, shared.ID).Scan(&sharedLeft)
	if aloneLeft != 0 || sharedLeft != 1 {
		t.Errorf("after an account was deleted: empty circle %d, shared circle %d", aloneLeft, sharedLeft)
	}
	if d, err := svc.Detail(ctx, ann, shared.ID); err != nil || !d.Members[0].Owner || !d.Members[0].Me {
		t.Errorf("ann does not own the shared circle: %+v %v", d, err)
	}

	// Ten circles at most.
	for i := range circles.MaxCircles {
		if _, err := svc.Create(ctx, cat, "c", "Cat"); err != nil {
			t.Fatalf("circle %d: %v", i, err)
		}
	}
	if _, err := svc.Create(ctx, cat, "c", "Cat"); !errors.Is(err, circles.ErrTooMany) {
		t.Errorf("an eleventh circle: %v", err)
	}
}
