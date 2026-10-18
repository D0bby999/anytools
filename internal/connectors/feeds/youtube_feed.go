package feeds

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/D0bby999/anytools/internal/security"
)

// youtube_feed.go — YouTube's keyless feeds. Every public playlist and
// channel has an Atom feed at /feeds/videos.xml, which lists its latest 15
// videos and needs no key and no account. (DeepTutor reaches YouTube through
// an Invidious instance instead; the official feed makes that unnecessary.)

// YouTubeFeedLimit is how many videos YouTube's keyless feed lists.
const YouTubeFeedLimit = 15

// Target kinds.
const (
	TargetPlaylist = "playlist"
	TargetChannel  = "channel"
	TargetHandle   = "handle"
)

// Target is a playlist, a channel or a channel's @handle named by a link.
type Target struct {
	Kind string
	ID   string
}

var (
	playlistID = regexp.MustCompile(`^[A-Za-z0-9_-]{10,64}$`)
	channelID  = regexp.MustCompile(`^UC[A-Za-z0-9_-]{22}$`)
	handleName = regexp.MustCompile(`^@[A-Za-z0-9._-]{3,30}$`)
)

var youtubeHosts = map[string]bool{
	"youtube.com": true, "www.youtube.com": true, "m.youtube.com": true, "music.youtube.com": true,
}

// RecognizeYouTube reads a playlist link (any YouTube link whose list= names
// a playlist), a channel link (/channel/UC…) or a handle link (/@name). A
// watch link that names a video as well is the caller's to treat as a video.
func RecognizeYouTube(raw string) (Target, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil {
		return Target{}, false
	}
	if !youtubeHosts[strings.ToLower(u.Hostname())] || (u.Port() != "" && u.Port() != "443" && u.Port() != "80") {
		return Target{}, false
	}
	if list := u.Query().Get("list"); list != "" {
		if playlistID.MatchString(list) {
			return Target{Kind: TargetPlaylist, ID: list}, true
		}
		return Target{}, false
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	switch {
	case len(parts) >= 2 && parts[0] == "channel" && channelID.MatchString(parts[1]):
		return Target{Kind: TargetChannel, ID: parts[1]}, true
	case len(parts) >= 1 && handleName.MatchString(parts[0]):
		return Target{Kind: TargetHandle, ID: parts[0]}, true
	}
	return Target{}, false
}

// YouTube fetches the keyless feeds. Every request goes through
// security.FetchPage with its size cap.
type YouTube struct {
	// HTTP is security.FetchClient in production.
	HTTP *http.Client
	// Base is "https://www.youtube.com"; tests point it at a fixture.
	Base string
}

// NewYouTube is the production client over a guarded fetch client.
func NewYouTube(client *http.Client) *YouTube {
	return &YouTube{HTTP: client, Base: "https://www.youtube.com"}
}

const feedUserAgent = "AnyTools/1.0 (+https://github.com/D0bby999/anytools)"

// FeedURL is the keyless feed of a playlist or a channel, as stored.
func FeedURL(t Target) string {
	if t.Kind == TargetPlaylist {
		return "https://www.youtube.com/feeds/videos.xml?playlist_id=" + url.QueryEscape(t.ID)
	}
	return "https://www.youtube.com/feeds/videos.xml?channel_id=" + url.QueryEscape(t.ID)
}

// PlaylistOf returns the playlist a stored feed URL names, if it names one.
func PlaylistOf(feedURL string) (string, bool) {
	u, err := url.Parse(feedURL)
	if err != nil {
		return "", false
	}
	id := u.Query().Get("playlist_id")
	return id, playlistID.MatchString(id)
}

// ErrNoChannel: the handle's page did not name a channel.
var ErrNoChannel = errors.New("feeds: that YouTube handle does not name a channel")

// Resolve turns a handle into its channel; a playlist or a channel is
// returned as it is.
func (y *YouTube) Resolve(ctx context.Context, t Target) (Target, error) {
	if t.Kind != TargetHandle {
		return t, nil
	}
	page, err := security.FetchPage(ctx, y.HTTP, security.PageRequest{
		URL: y.Base + "/" + url.PathEscape(t.ID), Accept: "text/html", UserAgent: feedUserAgent,
		Types: []string{"text/html"},
	})
	if err != nil {
		return Target{}, err
	}
	id := channelFromPage(page.Body)
	if id == "" {
		return Target{}, ErrNoChannel
	}
	return Target{Kind: TargetChannel, ID: id}, nil
}

var channelMarkers = []*regexp.Regexp{
	regexp.MustCompile(`<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[A-Za-z0-9_-]{22})"`),
	regexp.MustCompile(`<meta itemprop="identifier" content="(UC[A-Za-z0-9_-]{22})"`),
	regexp.MustCompile(`"externalId":"(UC[A-Za-z0-9_-]{22})"`),
}

// channelFromPage reads the channel id a handle's page names: its canonical
// link, its identifier, or the page data's externalId.
func channelFromPage(body []byte) string {
	for _, re := range channelMarkers {
		if m := re.FindSubmatch(body); m != nil {
			return string(m[1])
		}
	}
	return ""
}

// Fetch reads a playlist's or a channel's keyless feed.
func (y *YouTube) Fetch(ctx context.Context, t Target) (*Feed, error) {
	u := strings.Replace(FeedURL(t), "https://www.youtube.com", y.Base, 1)
	page, err := security.FetchPage(ctx, y.HTTP, security.PageRequest{
		URL: u, Accept: "application/atom+xml,application/xml;q=0.9", UserAgent: feedUserAgent,
		Types: FeedTypes,
	})
	if err != nil {
		return nil, err
	}
	return ParseYouTube(page.Body)
}

// ParseYouTube reads a YouTube Atom feed: each entry's yt:videoId, title
// and date. The keyless feed carries no durations.
func ParseYouTube(data []byte) (*Feed, error) {
	f, err := parse(data)
	if err != nil {
		return nil, err
	}
	out := &Feed{Title: clean(f.Title, 300)}
	seen := map[string]bool{}
	for _, it := range f.Items {
		id := ""
		if yt, ok := it.Extensions["yt"]; ok && len(yt["videoId"]) > 0 {
			id = strings.TrimSpace(yt["videoId"][0].Value)
		}
		if !videoID.MatchString(id) || seen[id] {
			continue
		}
		seen[id] = true
		title := clean(it.Title, 300)
		if title == "" {
			title = "YouTube video " + id
		}
		out.Entries = append(out.Entries, Entry{Key: id, VideoID: id, Title: title, Published: published(it)})
	}
	if len(out.Entries) == 0 && len(f.Items) > 0 {
		return nil, ErrNotFeed
	}
	out.Entries = newestFirst(out.Entries)
	return out, nil
}

var videoID = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
