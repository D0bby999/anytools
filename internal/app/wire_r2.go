package app

import (
	"context"
	"log/slog"
	"time"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/connectors/r2"
)

// wire_r2.go — where the server keeps learners' files: under the data
// directory, or, with ANYTOOLS_R2_*, originals and objects in a private
// Cloudflare R2 bucket (internal/blob/bucket.go). The server and `anytools
// verify` open it the same way.

// openServerStorage returns the server's Local. A configured bucket that does
// not answer is an error: better a boot that fails, and a deploy that rolls
// back, than uploads that fail one by one.
func openServerStorage(ctx context.Context, dataDir string, cfg config.R2Config) (*blob.Local, error) {
	if !cfg.Enabled() {
		return blob.NewLocal(dataDir)
	}
	bucket, err := r2.New(r2.Config{
		AccountID:       cfg.AccountID,
		Bucket:          cfg.Bucket,
		AccessKeyID:     cfg.AccessKeyID,
		SecretAccessKey: cfg.SecretAccessKey,
	})
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err := bucket.Check(ctx); err != nil {
		return nil, err
	}
	slog.Info("boot: learners' files are kept in R2", "bucket", cfg.Bucket)
	return blob.NewLocalWithBucket(dataDir, bucket)
}
