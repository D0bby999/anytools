// Package crawl is what a documentation-site crawl may follow, and how fast
// (up-methods phase 18).
//
// It fetches nothing itself: every page and robots.txt is read through
// security.FetchPage by the caller (internal/knowledge/sites.go), over the
// guarded fetch client, so a crawl reaches only public addresses. This
// package decides which links are in scope, refuses a redirect that leaves
// the scope, and spaces requests out.
//
// The limits follow DeepTutor's crawler (services/web_source/crawler.py:
// depth 3 by default, at most 5 levels and 200 pages, same origin, under the
// start URL's path prefix, robots.txt obeyed), lowered because every page is
// embedded on the learner's own key: depth 0-3, default 2; 50 pages by
// default, at most 200.
package crawl

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/html"
)

// Limits.
const (
	DefaultDepth = 2
	MaxDepth     = 3
	DefaultPages = 50
	MaxPages     = 200
	// MaxConcurrent fetches run at once across every crawl on this server.
	MaxConcurrent = 4
	// HostGap is the least time between two requests to one host.
	HostGap = 500 * time.Millisecond
)

// ErrOffScope refuses a redirect that leaves the crawl's origin or prefix.
var ErrOffScope = errors.New("crawl: the page redirected outside the site")

// Canonical is how a page is identified: host lowercased, the default port
// dropped, the fragment dropped, an empty path made "/".
func Canonical(u *url.URL) *url.URL {
	c := *u
	c.Host = strings.TrimSuffix(strings.ToLower(c.Host), ":443")
	c.Fragment, c.RawFragment = "", ""
	c.User = nil
	if c.Path == "" {
		c.Path, c.RawPath = "/", ""
	}
	return &c
}

// Scope is what a crawl started at one URL may follow: the same scheme and
// host, under the start URL's directory.
type Scope struct {
	Scheme string
	Host   string
	Prefix string
}

// NewScope scopes a crawl to start's origin and directory: a start URL of
// /docs/intro scopes to /docs/, and /docs/ to itself.
func NewScope(start *url.URL) Scope {
	c := Canonical(start)
	return Scope{Scheme: c.Scheme, Host: c.Host, Prefix: PrefixOf(c.Path)}
}

// PrefixOf is a path's directory, with its trailing slash.
func PrefixOf(p string) string {
	if p == "" || !strings.HasPrefix(p, "/") {
		return "/"
	}
	if strings.HasSuffix(p, "/") {
		return p
	}
	dir := path.Dir(p)
	if dir == "/" {
		return "/"
	}
	return dir + "/"
}

// Allows reports whether u is on the scope's origin and under its prefix.
// The prefix itself without its slash (/docs for /docs/) is allowed, since
// sites serve their index at both.
func (s Scope) Allows(u *url.URL) bool {
	c := Canonical(u)
	if c.Scheme != s.Scheme || c.Host != s.Host {
		return false
	}
	if strings.HasPrefix(c.Path, s.Prefix) {
		return true
	}
	return c.Path == strings.TrimSuffix(s.Prefix, "/")
}

// Client returns client restricted to the scope: a redirect hop outside it
// is refused before it is followed. The transport, and so the fetch guard,
// is client's own.
func (s Scope) Client(client *http.Client) *http.Client {
	scoped := *client
	previous := client.CheckRedirect
	scoped.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if !s.Allows(req.URL) {
			return ErrOffScope
		}
		if previous != nil {
			return previous(req, via)
		}
		if len(via) >= 3 {
			return fmt.Errorf("crawl: stopped after %d redirects", len(via))
		}
		return nil
	}
	return &scoped
}

// skipped are extensions that are never a page: fetching them would only be
// refused by FetchPage's type check after spending a request.
var skipped = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".svg": true, ".webp": true, ".ico": true,
	".css": true, ".js": true, ".mjs": true, ".json": true, ".xml": true, ".rss": true, ".atom": true,
	".zip": true, ".gz": true, ".tgz": true, ".tar": true, ".bz2": true, ".xz": true, ".7z": true,
	".mp3": true, ".mp4": true, ".wav": true, ".mov": true, ".webm": true, ".ogg": true,
	".woff": true, ".woff2": true, ".ttf": true, ".otf": true, ".eot": true,
	".exe": true, ".dmg": true, ".pkg": true, ".deb": true, ".rpm": true, ".apk": true,
}

// Resolve turns an href found on base into a canonical crawlable URL, or
// reports that it is not one (another scheme, an asset, unparseable).
func Resolve(base *url.URL, href string) (*url.URL, bool) {
	href = strings.TrimSpace(href)
	if href == "" || strings.HasPrefix(href, "#") || len(href) > 2048 {
		return nil, false
	}
	ref, err := url.Parse(href)
	if err != nil {
		return nil, false
	}
	u := base.ResolveReference(ref)
	if u.Scheme != "https" && u.Scheme != "http" {
		return nil, false
	}
	if u.User != nil {
		return nil, false
	}
	if skipped[strings.ToLower(path.Ext(u.Path))] {
		return nil, false
	}
	return Canonical(u), true
}

// Links are the in-scope links of an HTML page, canonical, first occurrence
// first, without the page itself. A <base href> is honoured.
func Links(body []byte, pageURL *url.URL, scope Scope) []*url.URL {
	base := pageURL
	self := Canonical(pageURL).String()
	seen := map[string]bool{self: true}
	var out []*url.URL
	z := html.NewTokenizer(bytes.NewReader(body))
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			return out
		}
		if tt != html.StartTagToken && tt != html.SelfClosingTagToken {
			continue
		}
		name, hasAttr := z.TagName()
		tag := string(name)
		if (tag != "a" && tag != "base") || !hasAttr {
			continue
		}
		href := ""
		for {
			key, val, more := z.TagAttr()
			if string(key) == "href" {
				href = string(val)
			}
			if !more {
				break
			}
		}
		if tag == "base" {
			if u, err := url.Parse(strings.TrimSpace(href)); err == nil && href != "" {
				base = pageURL.ResolveReference(u)
			}
			continue
		}
		u, ok := Resolve(base, href)
		if !ok || !scope.Allows(u) {
			continue
		}
		key := u.String()
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, u)
	}
}

// Limiter spaces requests: at most n at once, and gap between two requests
// to one host.
type Limiter struct {
	slots chan struct{}
	gap   time.Duration
	mu    sync.Mutex
	next  map[string]time.Time
	now   func() time.Time
}

// NewLimiter returns a limiter of n slots and a per-host gap.
func NewLimiter(n int, gap time.Duration) *Limiter {
	return &Limiter{slots: make(chan struct{}, n), gap: gap, next: map[string]time.Time{}, now: time.Now}
}

// Shared is the server's limiter: every crawl takes its turns here, so four
// learners crawling at once still make at most four requests at a time.
var Shared = NewLimiter(MaxConcurrent, HostGap)

// Acquire waits for host's turn and a free slot. The caller runs release when
// its request is done.
func (l *Limiter) Acquire(ctx context.Context, host string) (release func(), err error) {
	host = strings.ToLower(host)
	l.mu.Lock()
	now := l.now()
	at := l.next[host]
	if at.Before(now) {
		at = now
	}
	// Book the turn before sleeping, so two waiters for one host queue up
	// rather than wake together.
	l.next[host] = at.Add(l.gap)
	if len(l.next) > 1024 {
		for h, t := range l.next {
			if t.Before(now) {
				delete(l.next, h)
			}
		}
	}
	l.mu.Unlock()

	if wait := at.Sub(now); wait > 0 {
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	select {
	case l.slots <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	var once sync.Once
	return func() { once.Do(func() { <-l.slots }) }, nil
}
