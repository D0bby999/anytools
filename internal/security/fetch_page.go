package security

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
)

// fetch_page.go — the ONE implementation of "read a page someone named".
//
// FetchClient decides where a request may go; it says nothing about how much
// comes back or what it is (learning-depth red team SF-4). A caller that used
// FetchClient directly and then io.ReadAll pulled an endless response into the
// memory of a single-replica API. The limits used to live in the web_fetch
// tool; they live here now, so web_fetch and the Knowledge Center's "Add a
// link" cannot drift apart. Calling FetchClient without FetchPage is refused
// in review.

// MaxFetchBytes is the cap on a fetched body, enforced while reading rather
// than by trusting Content-Length.
const MaxFetchBytes = 5 << 20

// ErrPageTooLarge and ErrPageType are the two refusals a caller may show a
// person; their text never carries anything the site sent.
var (
	ErrPageTooLarge = errors.New("the page is larger than 5 MB")
	ErrPageType     = errors.New("the page's content type is not accepted")
)

// HTTPStatusError is a non-200 answer. Only the status is kept.
type HTTPStatusError struct{ Status int }

func (e *HTTPStatusError) Error() string { return fmt.Sprintf("the site answered HTTP %d", e.Status) }

// PageRequest says what a caller will accept.
type PageRequest struct {
	URL       string
	Accept    string
	UserAgent string
	// Types are the accepted media types, lowercase, without parameters. The
	// empty string in the list accepts a response with no Content-Type.
	Types []string
	// MaxBytes lowers the cap for a caller that wants less (robots.txt). Zero
	// or anything above MaxFetchBytes means MaxFetchBytes.
	MaxBytes int
	// Header is sent as well (a GitHub token's Authorization). The client's
	// redirect check decides whether it may follow a hop.
	Header http.Header
}

// Page is what came back.
type Page struct {
	Body      []byte
	MediaType string
	// FinalURL is where the redirects ended. Readability resolves relative
	// links against it.
	FinalURL *url.URL
}

// FetchPage GETs one page through client with the size and type limits. The
// client must be FetchClient (or, in tests, one aimed at a fixture server):
// FetchPage owns the limits, the client owns the destination checks.
func FetchPage(ctx context.Context, client *http.Client, req PageRequest) (*Page, error) {
	resp, mediaType, err := open(ctx, client, req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	limit := req.MaxBytes
	if limit <= 0 || limit > MaxFetchBytes {
		limit = MaxFetchBytes
	}
	// One byte past the cap is read so "exactly the cap" and "more" differ.
	body, err := io.ReadAll(io.LimitReader(resp.Body, int64(limit)+1))
	if err != nil {
		return nil, err
	}
	if len(body) > limit {
		return nil, ErrPageTooLarge
	}
	return &Page{Body: body, MediaType: mediaType, FinalURL: resp.Request.URL}, nil
}

// open sends the request and checks the status and type.
func open(ctx context.Context, client *http.Client, req PageRequest) (*http.Response, string, error) {
	if _, err := CheckFetchURL(req.URL); err != nil {
		return nil, "", err
	}
	hreq, err := http.NewRequestWithContext(ctx, http.MethodGet, req.URL, nil)
	if err != nil {
		return nil, "", err
	}
	for k, vs := range req.Header {
		for _, v := range vs {
			hreq.Header.Add(k, v)
		}
	}
	if req.Accept != "" {
		hreq.Header.Set("Accept", req.Accept)
	}
	if req.UserAgent != "" {
		hreq.Header.Set("User-Agent", req.UserAgent)
	}

	resp, err := client.Do(hreq)
	if err != nil {
		return nil, "", err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, "", &HTTPStatusError{Status: resp.StatusCode}
	}

	mediaType, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	mediaType = strings.ToLower(mediaType)
	accepted := false
	for _, t := range req.Types {
		if t == mediaType {
			accepted = true
			break
		}
	}
	if !accepted {
		resp.Body.Close()
		return nil, "", ErrPageType
	}
	return resp, mediaType, nil
}

// ErrStreamTooLarge ends a stream that went past its cap.
var ErrStreamTooLarge = errors.New("the download is larger than its limit")

// Stream is a body read as it arrives.
type Stream struct {
	// Body fails with ErrStreamTooLarge once more than the cap has been read.
	// The caller closes it.
	Body      io.ReadCloser
	MediaType string
	FinalURL  *url.URL
}

// OpenStream is FetchPage for a body too large to hold in memory (a GitHub
// repository's tarball): the same URL, status and type checks, and a cap of
// maxBytes enforced while the caller reads rather than up front.
func OpenStream(ctx context.Context, client *http.Client, req PageRequest, maxBytes int64) (*Stream, error) {
	resp, mediaType, err := open(ctx, client, req)
	if err != nil {
		return nil, err
	}
	return &Stream{
		Body:      &cappedBody{r: io.LimitReader(resp.Body, maxBytes+1), c: resp.Body, left: maxBytes},
		MediaType: mediaType, FinalURL: resp.Request.URL,
	}, nil
}

// cappedBody reads at most left bytes and fails, rather than truncating
// silently, when the body goes on.
type cappedBody struct {
	r    io.Reader
	c    io.Closer
	left int64
}

func (b *cappedBody) Read(p []byte) (int, error) {
	n, err := b.r.Read(p)
	b.left -= int64(n)
	if b.left < 0 {
		return n + int(b.left), ErrStreamTooLarge
	}
	return n, err
}

func (b *cappedBody) Close() error { return b.c.Close() }

// IsInternalAddress reports whether err is a refusal to reach an address that
// is not on the public internet.
func IsInternalAddress(err error) bool {
	return errors.Is(err, ErrSSRFLoopback) || errors.Is(err, ErrSSRFPrivateIP) ||
		errors.Is(err, ErrSSRFLinkLocal) || errors.Is(err, ErrSSRFMulticast)
}
