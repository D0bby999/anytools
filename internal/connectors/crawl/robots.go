package crawl

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/D0bby999/anytools/internal/security"
)

// robots.go — robots.txt, shared by "Add a link" (one page) and a site crawl
// (many). Moved here from internal/knowledge/robots.go so the two read the
// file with one parser.

// Agent is the product token robots.txt groups are matched against.
const Agent = "AnyTools"

// UserAgent is sent on every page fetch; it names the token above.
const UserAgent = "Mozilla/5.0 (compatible; AnyTools/1.0; +knowledge-link)"

// MaxRobotsBytes caps robots.txt (RFC 9309 §2.5 asks parsers to read at
// least 500 KiB).
const MaxRobotsBytes = 512 << 10

// ErrRobotsUnreachable means robots.txt could not be read at all.
var ErrRobotsUnreachable = errors.New("robots.txt could not be read")

// FetchRobots reads origin's robots.txt. found is false when the site has
// none (a 4xx, or an HTML page served in its place), which allows every path.
func FetchRobots(ctx context.Context, client *http.Client, origin *url.URL) (body string, found bool, err error) {
	robotsURL := (&url.URL{Scheme: origin.Scheme, Host: origin.Host, Path: "/robots.txt"}).String()
	page, err := security.FetchPage(ctx, client, security.PageRequest{
		URL:       robotsURL,
		Accept:    "text/plain",
		UserAgent: UserAgent,
		Types:     []string{"text/plain", ""},
		MaxBytes:  MaxRobotsBytes,
	})
	var status *security.HTTPStatusError
	switch {
	case errors.As(err, &status) && status.Status >= 400 && status.Status < 500:
		// The robots convention: a missing file allows everything.
		return "", false, nil
	case errors.Is(err, security.ErrPageType):
		// An HTML error page served as robots.txt says nothing about paths.
		return "", false, nil
	case err != nil:
		return "", false, ErrRobotsUnreachable
	}
	return string(page.Body), true, nil
}

type robotsRule struct {
	allow   bool
	pattern string
}

// Permits evaluates robots.txt for one agent and one URL: the group naming
// the agent if there is one, else the `*` group; the longest matching rule
// wins, and Allow wins a tie (RFC 9309 §2.2.2).
func Permits(body, agent string, u *url.URL) bool {
	return permits(body, agent, u.EscapedPath(), u.RawQuery)
}

func permits(body, agent, path, query string) bool {
	if path == "" {
		path = "/"
	}
	if query != "" {
		path += "?" + query
	}
	agent = strings.ToLower(agent)

	var named, star []robotsRule
	var groupAgents []string
	inRules := false
	for _, line := range strings.Split(body, "\n") {
		if i := strings.IndexByte(line, '#'); i >= 0 {
			line = line[:i]
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.ToLower(strings.TrimSpace(key))
		value = strings.TrimSpace(value)
		switch key {
		case "user-agent":
			if inRules {
				groupAgents, inRules = nil, false
			}
			groupAgents = append(groupAgents, strings.ToLower(value))
		case "allow", "disallow":
			inRules = true
			if value == "" {
				continue // an empty Disallow allows everything
			}
			rule := robotsRule{allow: key == "allow", pattern: value}
			for _, a := range groupAgents {
				switch {
				case a == "*":
					star = append(star, rule)
				case strings.Contains(agent, a) || strings.Contains(a, agent):
					named = append(named, rule)
				}
			}
		}
	}
	rules := star
	if len(named) > 0 {
		rules = named
	}

	best, allowed := -1, true
	for _, r := range rules {
		if !robotsMatch(r.pattern, path) {
			continue
		}
		n := len(r.pattern)
		if n > best || (n == best && r.allow) {
			best, allowed = n, r.allow
		}
	}
	return allowed
}

// robotsMatch supports `*` (any run) and a trailing `$` (end of path).
func robotsMatch(pattern, path string) bool {
	anchored := strings.HasSuffix(pattern, "$")
	pattern = strings.TrimSuffix(pattern, "$")
	parts := strings.Split(pattern, "*")
	pos := 0
	for i, part := range parts {
		if i == 0 {
			if !strings.HasPrefix(path, part) {
				return false
			}
			pos = len(part)
			continue
		}
		j := strings.Index(path[pos:], part)
		if j < 0 {
			return false
		}
		pos += j + len(part)
	}
	if anchored {
		last := parts[len(parts)-1]
		return strings.HasSuffix(path, last) && (len(parts) > 1 || pos == len(path))
	}
	return true
}
