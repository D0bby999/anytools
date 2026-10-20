// Package r2 is blob.Bucket over Cloudflare R2's S3 API: the server's copy of
// learners' originals and objects, kept off its disk (internal/blob/bucket.go).
//
// The bucket is private. This package signs requests with an R2 API token's
// S3 credentials and never makes a URL a browser could fetch.
package r2

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"

	"github.com/D0bby999/anytools/internal/blob"
)

// Config names a bucket and the credentials of an R2 API token scoped to it.
type Config struct {
	AccountID       string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	// Endpoint overrides https://<account>.r2.cloudflarestorage.com (tests).
	Endpoint string
}

// Bucket is one R2 bucket.
type Bucket struct {
	client *s3.Client
	name   string
}

var _ blob.Bucket = (*Bucket)(nil)

// New returns the bucket. It does not reach R2; Check does.
func New(cfg Config) (*Bucket, error) {
	if cfg.Bucket == "" || cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" || (cfg.AccountID == "" && cfg.Endpoint == "") {
		return nil, errors.New("r2: account id, bucket, access key id and secret access key are all required")
	}
	endpoint := cfg.Endpoint
	if endpoint == "" {
		endpoint = "https://" + cfg.AccountID + ".r2.cloudflarestorage.com"
	}
	client := s3.New(s3.Options{
		Region:       "auto",
		BaseEndpoint: aws.String(endpoint),
		Credentials:  credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		UsePathStyle: true,
		// R2 checks what S3 requires; the SDK's newer default checksums are
		// not needed for that and are not all supported.
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	})
	return &Bucket{client: client, name: cfg.Bucket}, nil
}

// Check lists one key, so a wrong account, bucket or token fails at boot
// rather than at a learner's first upload.
func (b *Bucket) Check(ctx context.Context) error {
	_, err := b.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{Bucket: &b.name, MaxKeys: aws.Int32(1)})
	if err != nil {
		return fmt.Errorf("r2: bucket %q: %w", b.name, err)
	}
	return nil
}

func (b *Bucket) Put(ctx context.Context, key string, body io.ReadSeeker, size int64) error {
	_, err := b.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        &b.name,
		Key:           &key,
		Body:          body,
		ContentLength: aws.Int64(size),
	})
	if err != nil {
		return fmt.Errorf("r2: put: %w", err)
	}
	return nil
}

func (b *Bucket) Get(ctx context.Context, key string, offset int64) (io.ReadCloser, error) {
	in := &s3.GetObjectInput{Bucket: &b.name, Key: &key}
	if offset > 0 {
		in.Range = aws.String("bytes=" + strconv.FormatInt(offset, 10) + "-")
	}
	out, err := b.client.GetObject(ctx, in)
	if err != nil {
		if notFound(err) {
			return nil, blob.ErrNotFound
		}
		return nil, fmt.Errorf("r2: get: %w", err)
	}
	return out.Body, nil
}

func (b *Bucket) Stat(ctx context.Context, key string) (blob.BucketObject, error) {
	out, err := b.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &b.name, Key: &key})
	if err != nil {
		if notFound(err) {
			return blob.BucketObject{}, blob.ErrNotFound
		}
		return blob.BucketObject{}, fmt.Errorf("r2: head: %w", err)
	}
	o := blob.BucketObject{Key: key, Size: aws.ToInt64(out.ContentLength)}
	if out.LastModified != nil {
		o.ModTime = *out.LastModified
	}
	return o, nil
}

// Delete removes keys a thousand at a time, the most one request takes.
func (b *Bucket) Delete(ctx context.Context, keys ...string) error {
	for len(keys) > 0 {
		n := min(len(keys), 1000)
		ids := make([]types.ObjectIdentifier, n)
		for i, k := range keys[:n] {
			ids[i] = types.ObjectIdentifier{Key: aws.String(k)}
		}
		out, err := b.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: &b.name,
			Delete: &types.Delete{Objects: ids, Quiet: aws.Bool(true)},
		})
		if err != nil {
			return fmt.Errorf("r2: delete: %w", err)
		}
		if len(out.Errors) > 0 {
			e := out.Errors[0]
			return fmt.Errorf("r2: delete %d of %d keys failed, first: %s", len(out.Errors), n, aws.ToString(e.Code))
		}
		keys = keys[n:]
	}
	return nil
}

func (b *Bucket) List(ctx context.Context, prefix string) ([]blob.BucketObject, error) {
	var out []blob.BucketObject
	p := s3.NewListObjectsV2Paginator(b.client, &s3.ListObjectsV2Input{Bucket: &b.name, Prefix: &prefix})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("r2: list: %w", err)
		}
		for _, o := range page.Contents {
			obj := blob.BucketObject{Key: aws.ToString(o.Key), Size: aws.ToInt64(o.Size)}
			if o.LastModified != nil {
				obj.ModTime = *o.LastModified
			}
			out = append(out, obj)
		}
	}
	return out, nil
}

// notFound is S3's NoSuchKey, or a HEAD's bare 404 (a HEAD has no body to
// name the error in).
func notFound(err error) bool {
	var nsk *types.NoSuchKey
	if errors.As(err, &nsk) {
		return true
	}
	var nf *types.NotFound
	if errors.As(err, &nf) {
		return true
	}
	var api smithy.APIError
	if errors.As(err, &api) && strings.EqualFold(api.ErrorCode(), "NoSuchKey") {
		return true
	}
	var re interface{ HTTPStatusCode() int }
	return errors.As(err, &re) && re.HTTPStatusCode() == http.StatusNotFound
}
