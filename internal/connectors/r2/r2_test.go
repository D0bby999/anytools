package r2_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/r2"
)

func TestNewNeedsEverySetting(t *testing.T) {
	if _, err := r2.New(r2.Config{AccountID: "a", Bucket: "b", AccessKeyID: "k"}); err == nil {
		t.Fatal("New without a secret = nil error")
	}
}

// Against a real bucket, when ANYTOOLS_TEST_R2_ACCOUNT_ID, _BUCKET,
// _ACCESS_KEY_ID and _SECRET_ACCESS_KEY are set. Everything it writes is
// under a fresh prefix and deleted at the end.
func TestAgainstR2(t *testing.T) {
	cfg := r2.Config{
		AccountID:       os.Getenv("ANYTOOLS_TEST_R2_ACCOUNT_ID"),
		Bucket:          os.Getenv("ANYTOOLS_TEST_R2_BUCKET"),
		AccessKeyID:     os.Getenv("ANYTOOLS_TEST_R2_ACCESS_KEY_ID"),
		SecretAccessKey: os.Getenv("ANYTOOLS_TEST_R2_SECRET_ACCESS_KEY"),
	}
	if cfg.AccountID == "" || cfg.Bucket == "" || cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" {
		t.Skip("ANYTOOLS_TEST_R2_* not set")
	}
	b, err := r2.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := b.Check(ctx); err != nil {
		t.Fatal(err)
	}
	prefix := "test/" + uuid.NewString() + "/"
	defer func() {
		objs, _ := b.List(context.Background(), prefix)
		keys := make([]string, len(objs))
		for i, o := range objs {
			keys[i] = o.Key
		}
		b.Delete(context.Background(), keys...)
	}()

	data := bytes.Repeat([]byte("anytools "), 100)
	key := prefix + "a/b"
	if err := b.Put(ctx, key, bytes.NewReader(data), int64(len(data))); err != nil {
		t.Fatal(err)
	}
	st, err := b.Stat(ctx, key)
	if err != nil || st.Size != int64(len(data)) || st.ModTime.IsZero() {
		t.Fatalf("Stat = %+v, %v", st, err)
	}
	rc, err := b.Get(ctx, key, 450)
	if err != nil {
		t.Fatal(err)
	}
	tail, err := io.ReadAll(rc)
	rc.Close()
	if err != nil || !bytes.Equal(tail, data[450:]) {
		t.Fatalf("Get from 450 = %d bytes, %v", len(tail), err)
	}
	if objs, err := b.List(ctx, prefix); err != nil || len(objs) != 1 || objs[0].Key != key {
		t.Fatalf("List = %+v, %v", objs, err)
	}
	if _, err := b.Get(ctx, prefix+"missing", 0); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("Get of a missing key = %v, want ErrNotFound", err)
	}
	if _, err := b.Stat(ctx, prefix+"missing"); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("Stat of a missing key = %v, want ErrNotFound", err)
	}
	if err := b.Delete(ctx, key, prefix+"missing"); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Stat(ctx, key); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("Stat after Delete = %v, want ErrNotFound", err)
	}
}
