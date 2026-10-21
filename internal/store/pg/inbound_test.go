package pg_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/inbound"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// An address is found by its hash and shown again decrypted; a message id is
// claimed once; the count and the recent list are the learner's own.
func TestInboundStore(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	store := pg.NewInboundStore(pool, testutil.TestEncryptionKey)
	user := testutil.NewUser(t, pool)
	other := testutil.NewUser(t, pool)

	if _, err := store.GetAddress(ctx, user); !errors.Is(err, inbound.ErrNoAddress) {
		t.Fatalf("none yet: %v", err)
	}
	token := "abcdefghijklmnopqrstuvwx"
	hash := sha256.Sum256([]byte(token))
	if err := store.SaveAddress(ctx, inbound.Address{UserID: user, Token: token, CreatedAt: time.Now()}, hash[:]); err != nil {
		t.Fatal(err)
	}
	got, err := store.AddressByHash(ctx, hash[:])
	if err != nil || got.UserID != user || got.Token != token || got.KBID != nil {
		t.Fatalf("by hash: %+v %v", got, err)
	}
	var kb uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO knowledge_bases (user_id, name) VALUES ($1, 'Inbox') RETURNING id`, user).Scan(&kb); err != nil {
		t.Fatal(err)
	}
	if err := store.SetAddressKB(ctx, user, kb); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveConfirmation(ctx, user, "123456789", "https://mail-settings.google.com/mail/vf-x", time.Now()); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.GetAddress(ctx, user); got.KBID == nil || *got.KBID != kb || got.ConfirmCode != "123456789" {
		t.Fatalf("after updates: %+v", got)
	}

	rec := inbound.Received{Subject: "Week 3", From: "a@b.c", Status: inbound.StatusFailed, ReceivedAt: time.Now()}
	if fresh, err := store.ClaimMessage(ctx, user, "m1@x", rec); err != nil || !fresh {
		t.Fatalf("first claim: %v %v", fresh, err)
	}
	if fresh, _ := store.ClaimMessage(ctx, user, "m1@x", rec); fresh {
		t.Fatal("a message id is claimed once")
	}
	if fresh, _ := store.ClaimMessage(ctx, other, "m1@x", rec); !fresh {
		t.Fatal("the same id for another learner is theirs")
	}
	rec.Status, rec.Documents, rec.KBID = inbound.StatusImported, 2, &kb
	if err := store.FinishMessage(ctx, user, "m1@x", rec); err != nil {
		t.Fatal(err)
	}
	if n, _ := store.CountSince(ctx, user, time.Now().Add(-time.Hour)); n != 1 {
		t.Fatalf("count: %d", n)
	}
	recent, err := store.Recent(ctx, user, 10)
	if err != nil || len(recent) != 1 || recent[0].Status != inbound.StatusImported || recent[0].Documents != 2 {
		t.Fatalf("recent: %+v %v", recent, err)
	}
}
