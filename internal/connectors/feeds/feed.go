// Package feeds reads podcast feeds and YouTube's playlist and channel feeds
// (up-methods phase 17).
//
// The pattern is markitdown's RSS and Atom converter
// (converters/_rss_converter.py): detect the feed type, then walk its items.
// Parsing is mmcdole/gofeed (MIT), which reads RSS, Atom and JSON Feed with
// podcast <enclosure> and iTunes fields. This package never fetches: the
// caller reads the bytes through security.FetchPage, with its size cap, and
// hands them here.
package feeds

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"mime"
	"net/url"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mmcdole/gofeed"
)

// Feed kinds, as the feeds table names them.
const (
	KindPodcast = "podcast"
	KindYouTube = "youtube"
)

// MaxEntries is the most entries a feed lists; a long-running podcast keeps
// its newest ones.
const MaxEntries = 500

// FeedTypes are the Content-Types a feed is served with. Many hosts send a
// feed as plain XML, so text/xml and application/xml are feeds too, once
// their body parses as one.
var FeedTypes = []string{
	"application/rss+xml", "application/atom+xml", "application/feed+json",
	"application/xml", "text/xml", "application/x-rss+xml",
}

// IsFeedType reports whether a response's media type may be a feed.
func IsFeedType(mediaType string) bool {
	for _, t := range FeedTypes {
		if t == mediaType {
			return true
		}
	}
	return false
}

// ErrNotFeed: the body is not RSS, Atom or JSON Feed.
var ErrNotFeed = errors.New("feeds: this is not an RSS or Atom feed")

// ErrNoEpisodes: a feed, but none of its entries has an audio enclosure (a
// blog's feed, say).
var ErrNoEpisodes = errors.New("feeds: this feed has no audio episodes")

// Feed is a parsed feed: its title and its entries, newest first.
type Feed struct {
	Title   string
	Entries []Entry
}

// Entry is one episode or video.
type Entry struct {
	// Key identifies the entry within its feed: a YouTube video id, or for
	// a podcast a digest of its guid (else its enclosure URL).
	Key       string
	Title     string
	Published *time.Time
	// DurationSeconds is 0 when the feed does not say.
	DurationSeconds int
	// A podcast episode's enclosure.
	MediaURL  string
	MediaType string
	MediaSize int64
	// VideoID is a YouTube entry's video.
	VideoID string
}

// parse reads any feed gofeed knows.
func parse(data []byte) (*gofeed.Feed, error) {
	f, err := gofeed.NewParser().Parse(bytes.NewReader(data))
	if err != nil {
		return nil, ErrNotFeed
	}
	return f, nil
}

// ParsePodcast reads a podcast feed: every entry with an audio or video
// enclosure, newest first, at most MaxEntries. An entry without one (show
// notes, an announcement) is left out. A feed with no audio at all is
// ErrNoEpisodes.
func ParsePodcast(data []byte) (*Feed, error) {
	f, err := parse(data)
	if err != nil {
		return nil, err
	}
	out := &Feed{Title: clean(f.Title, 300)}
	audio := false
	seen := map[string]bool{}
	for _, it := range f.Items {
		enc := mediaEnclosure(it.Enclosures)
		if enc == nil {
			continue
		}
		mt := enclosureType(enc)
		audio = audio || strings.HasPrefix(mt, "audio/")
		key := entryKey(it.GUID, enc.URL)
		if seen[key] {
			continue
		}
		seen[key] = true
		e := Entry{Key: key, Title: clean(it.Title, 300), Published: published(it),
			MediaURL: enc.URL, MediaType: mt}
		if n, err := strconv.ParseInt(strings.TrimSpace(enc.Length), 10, 64); err == nil && n > 0 {
			e.MediaSize = n
		}
		if it.ITunesExt != nil {
			e.DurationSeconds = ParseDuration(it.ITunesExt.Duration)
		}
		if e.Title == "" {
			e.Title = "Untitled episode"
		}
		out.Entries = append(out.Entries, e)
	}
	if !audio {
		return nil, ErrNoEpisodes
	}
	out.Entries = newestFirst(out.Entries)
	return out, nil
}

// mediaEnclosure is the first enclosure that is audio or video, by its
// declared type or, when the type is missing or generic, by its file name.
func mediaEnclosure(encs []*gofeed.Enclosure) *gofeed.Enclosure {
	for _, e := range encs {
		if e == nil || !httpsOrHTTP(e.URL) {
			continue
		}
		mt := enclosureType(e)
		if strings.HasPrefix(mt, "audio/") || strings.HasPrefix(mt, "video/") {
			return e
		}
	}
	return nil
}

// extensionTypes is what an enclosure with no useful type is, by its file
// name: the formats up-methods phase 15 reads.
var extensionTypes = map[string]string{
	".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg",
	".oga": "audio/ogg", ".opus": "audio/ogg", ".webm": "audio/webm", ".mp4": "video/mp4",
	".mov": "video/quicktime", ".mpeg": "video/mpeg",
}

func enclosureType(e *gofeed.Enclosure) string {
	mt, _, _ := mime.ParseMediaType(e.Type)
	mt = strings.ToLower(mt)
	if strings.HasPrefix(mt, "audio/") || strings.HasPrefix(mt, "video/") {
		return mt
	}
	if u, err := url.Parse(e.URL); err == nil {
		if t, ok := extensionTypes[strings.ToLower(path.Ext(u.Path))]; ok {
			return t
		}
	}
	return mt
}

// Extension is the file extension a stored episode is named with, so phase
// 15's sniffer checks the bytes against the right format.
func Extension(mediaURL, mediaType string) string {
	if u, err := url.Parse(mediaURL); err == nil {
		ext := strings.ToLower(path.Ext(u.Path))
		if _, ok := extensionTypes[ext]; ok {
			return ext
		}
	}
	switch mediaType {
	case "audio/mpeg", "audio/mp3":
		return ".mp3"
	case "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac":
		return ".m4a"
	case "audio/wav", "audio/x-wav", "audio/wave":
		return ".wav"
	case "audio/ogg", "audio/opus", "audio/vorbis":
		return ".ogg"
	case "audio/webm":
		return ".webm"
	case "video/mp4", "video/x-m4v":
		return ".mp4"
	case "video/quicktime":
		return ".mov"
	case "video/mpeg":
		return ".mpeg"
	case "video/webm":
		return ".webm"
	}
	return ".mp3"
}

func httpsOrHTTP(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != ""
}

// entryKey is a digest, so a guid of any length or alphabet is a short,
// URL-safe key.
func entryKey(guid, enclosure string) string {
	id := strings.TrimSpace(guid)
	if id == "" {
		id = strings.TrimSpace(enclosure)
	}
	sum := sha256.Sum256([]byte(id))
	return hex.EncodeToString(sum[:16])
}

func published(it *gofeed.Item) *time.Time {
	t := it.PublishedParsed
	if t == nil {
		t = it.UpdatedParsed
	}
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// newestFirst orders entries by date, undated last, and keeps MaxEntries.
func newestFirst(es []Entry) []Entry {
	sort.SliceStable(es, func(i, j int) bool {
		a, b := es[i].Published, es[j].Published
		switch {
		case a == nil:
			return false
		case b == nil:
			return true
		}
		return a.After(*b)
	})
	if len(es) > MaxEntries {
		es = es[:MaxEntries]
	}
	return es
}

// ParseDuration reads itunes:duration, which hosts write as seconds,
// "MM:SS" or "HH:MM:SS". Anything else is 0, "not known".
func ParseDuration(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	parts := strings.Split(raw, ":")
	if len(parts) > 3 {
		return 0
	}
	total := 0
	for _, p := range parts {
		// A fractional second ("1520.5") is rounded down.
		if i := strings.IndexByte(p, '.'); i >= 0 {
			p = p[:i]
		}
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return 0
		}
		total = total*60 + n
	}
	return total
}

// clean collapses whitespace and cuts a feed's text to n runes.
func clean(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > n {
		s = string(r[:n])
	}
	return s
}
