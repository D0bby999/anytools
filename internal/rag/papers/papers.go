// Package papers searches scholarly works (learning-depth phase 6): OpenAlex
// first, arXiv second. Semantic Scholar is left out: every keyless call in
// the live check answered 429 (research/external-findings.md §2).
//
// Two rules shape every client here:
//
//   - An outage is an error, never an empty list. "No papers" and "the
//     service is down" must not look the same to the learner (DeepTutor's
//     knowledge frontier conflates them).
//   - A key never reaches an error or a log. OpenAlex takes its key in the
//     query string, and Go's *url.Error prints the whole URL, so the clients
//     return their own Error, which names the host and the status only.
package papers

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/security"
)

// Paper is one scholarly work, as AnyTools shows and cites it.
type Paper struct {
	// ID is the source's own id: an OpenAlex work id (W…) or an arXiv id.
	ID        string   `json:"id"`
	Source    string   `json:"source"` // "openalex" or "arxiv"
	DOI       string   `json:"doi,omitempty"`
	Title     string   `json:"title"`
	Authors   []string `json:"authors"`
	Year      int      `json:"year,omitempty"`
	Citations int      `json:"citations"`
	// URL is the landing page: the DOI resolver or the arXiv abstract page.
	URL      string `json:"url"`
	Abstract string `json:"abstract,omitempty"`
	// OpenAccess, and — only under an open licence (cc-*) — the PDF, which
	// is the only case in which AnyTools imports the file itself.
	OpenAccess bool   `json:"open_access"`
	License    string `json:"license,omitempty"`
	PDFURL     string `json:"pdf_url,omitempty"`
}

// OpenLicence reports whether the paper's licence lets AnyTools store a copy.
func (p Paper) OpenLicence() bool { return strings.HasPrefix(strings.ToLower(p.License), "cc") }

// maxAbstract caps an abstract, rebuilt or read.
const maxAbstract = 1500

const timeout = 20 * time.Second

// Error is a failed call. It carries the host and the status, never the URL:
// the URL may hold a key.
type Error struct {
	Host   string
	Status int
	// Limited is a 429: the free daily budget, or the rate, is spent.
	Limited bool
	Reason  string
}

func (e *Error) Error() string {
	if e.Status > 0 {
		return fmt.Sprintf("papers: %s answered %d", e.Host, e.Status)
	}
	return fmt.Sprintf("papers: %s could not be reached: %s", e.Host, e.Reason)
}

// ErrLimited is what a 429 wraps, so callers can say "add a free key".
var ErrLimited = errors.New("papers: the search budget is used up")

func (e *Error) Is(target error) bool { return target == ErrLimited && e.Limited }

// transportError hides the URL a transport error would print.
func transportError(host string, err error) error {
	reason := "the connection failed"
	var te interface{ Timeout() bool }
	if errors.As(err, &te) && te.Timeout() {
		reason = "it timed out"
	}
	return &Error{Host: host, Reason: reason}
}

func statusError(host string, status int) error {
	return &Error{Host: host, Status: status, Limited: status == http.StatusTooManyRequests}
}

func newClient() *http.Client { return security.SafeClient(timeout) }

func clip(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
