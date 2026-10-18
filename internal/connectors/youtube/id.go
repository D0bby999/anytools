// Package youtube turns a public YouTube video into study material: its id,
// its oEmbed metadata, its captions (fetched through the in-house innertube
// call, or transcribed by the learner's own Gemini key reading the public
// URL), and the time segments a transcript is indexed as.
//
// It never downloads a video file. Captions are text; a Gemini transcription
// is Google fetching the video on its side; playback is YouTube's own
// privacy-enhanced player in the browser.
//
// A leaf package on purpose: internal/knowledge imports it, and nothing here
// knows what a knowledge base is.
package youtube

import (
	"net/url"
	"regexp"
	"strings"
)

// idPattern is the whole video id. Eleven characters exactly: a longer string
// that merely starts with a valid id is a different, forged link.
var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

// ValidID reports whether id is a YouTube video id.
func ValidID(id string) bool { return idPattern.MatchString(id) }

// youtubeHosts are the hosts whose links are videos. Anything else is a web
// page, even if it embeds a video.
var youtubeHosts = map[string]bool{
	"youtube.com": true, "www.youtube.com": true, "m.youtube.com": true,
	"music.youtube.com": true, "youtu.be": true,
	"youtube-nocookie.com": true, "www.youtube-nocookie.com": true,
}

// IsYouTubeHost reports whether a URL's host is YouTube's. A link on one of
// these hosts that names no valid id is refused rather than fetched as a page.
func IsYouTubeHost(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && youtubeHosts[strings.ToLower(u.Hostname())]
}

// ParseURL returns the video id of a YouTube link: watch, youtu.be, shorts,
// live and embed forms, over http or https.
func ParseURL(raw string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil {
		return "", false
	}
	host := strings.ToLower(u.Hostname())
	if !youtubeHosts[host] || (u.Port() != "" && u.Port() != "443" && u.Port() != "80") {
		return "", false
	}

	var id string
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	switch {
	case host == "youtu.be":
		id = parts[0]
	case u.Path == "/watch" || u.Path == "/watch/":
		id = u.Query().Get("v")
	case len(parts) == 2 && (parts[0] == "shorts" || parts[0] == "live" ||
		parts[0] == "embed" || parts[0] == "v"):
		id = parts[1]
	}
	if !ValidID(id) {
		return "", false
	}
	return id, true
}

// WatchURL is the canonical link for an id: what documents.source_url stores,
// what Gemini is given, and what makes two spellings of one video one document.
func WatchURL(id string) string { return "https://www.youtube.com/watch?v=" + id }

// ThumbnailURL is built from the id, never taken from a response, so the only
// image host the page loads is the one the CSP names.
func ThumbnailURL(id string) string { return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" }
