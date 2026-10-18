package knowledge

import (
	"context"
	"net/http"
	"net/url"

	"github.com/D0bby999/anytools/internal/connectors/crawl"
)

// robots.go — robots.txt for "Add a link" and the daily re-sync.
//
// One page, fetched because a learner asked, is not a crawl; but a site that
// says "not this path, not for AnyTools" is still obeyed. An unreachable
// robots.txt does not block a single user-initiated fetch (phase 4 requirement
// 2); for the unattended re-sync it skips that pass, because nobody is
// present to have asked. The parser is crawl's, shared with site crawls.

// RobotsAgent is the product token robots.txt groups are matched against.
const RobotsAgent = crawl.Agent

// linkUserAgent is sent on every link fetch; it names the token above.
const linkUserAgent = crawl.UserAgent

// robotsAllows fetches target's robots.txt and applies it.
func robotsAllows(ctx context.Context, client *http.Client, target *url.URL) (bool, error) {
	body, found, err := crawl.FetchRobots(ctx, client, target)
	if err != nil {
		return false, err
	}
	if !found {
		return true, nil
	}
	return crawl.Permits(body, RobotsAgent, target), nil
}
