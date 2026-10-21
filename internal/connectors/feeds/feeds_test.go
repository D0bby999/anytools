package feeds

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/security"
)

// aimed is the guarded fetch client with its DNS scripted: every host is a
// public address, and every connection goes to srv. FetchPage's URL check
// refuses a loopback URL, so the fixtures are named by host.
func aimed(srv *httptest.Server) *http.Client {
	addr := srv.Listener.Addr().String()
	return security.FetchClientWith(5*time.Second, security.GuardedDialer{
		Lookup: func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		},
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, addr)
		},
	})
}

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestAPodcastFeedYieldsItsEnclosuresAndDurations(t *testing.T) {
	f, err := ParsePodcast(fixture(t, "podcast.rss"))
	if err != nil {
		t.Fatal(err)
	}
	if f.Title != "Slow English & Friends" {
		t.Errorf("title = %q", f.Title)
	}
	// Five items: one has no enclosure, so four episodes, newest first.
	want := []struct {
		title   string
		url     string
		mime    string
		seconds int
		size    int64
		ext     string
	}{
		{"Episode 3: Ordering at a café", "https://cdn.example.com/audio/ep3.mp3", "audio/mpeg", 24*60 + 5, 12608, ".mp3"},
		{"Episode 2: Asking for directions", "https://cdn.example.com/audio/ep2.m4a", "audio/x-m4a", 18*60 + 30, 10418, ".m4a"},
		{"Episode 1: Introductions", "https://cdn.example.com/audio/ep1.mp3", "audio/mpeg", 1520, 0, ".mp3"},
		{"Bonus: the studio tour (video)", "https://cdn.example.com/video/tour.mp4", "video/mp4", 0, 12031, ".mp4"},
	}
	if len(f.Entries) != len(want) {
		t.Fatalf("entries = %d, want %d: %+v", len(f.Entries), len(want), f.Entries)
	}
	keys := map[string]bool{}
	for i, w := range want {
		e := f.Entries[i]
		if e.Title != w.title || e.MediaURL != w.url || e.MediaType != w.mime || e.DurationSeconds != w.seconds || e.MediaSize != w.size {
			t.Errorf("entry %d = %+v, want %+v", i, e, w)
		}
		if got := Extension(e.MediaURL, e.MediaType); got != w.ext {
			t.Errorf("entry %d extension = %q, want %q", i, got, w.ext)
		}
		if e.Published == nil || len(e.Key) != 32 || keys[e.Key] {
			t.Errorf("entry %d: published %v, key %q", i, e.Published, e.Key)
		}
		keys[e.Key] = true
	}
	// The key is the guid's digest: the same feed read again names the same
	// entries.
	again, _ := ParsePodcast(fixture(t, "podcast.rss"))
	if again.Entries[0].Key != f.Entries[0].Key {
		t.Error("an entry's key changed between two reads")
	}
}

func TestAnAtomPodcastFeedReadsItsEnclosureLinks(t *testing.T) {
	f, err := ParsePodcast(fixture(t, "podcast.atom"))
	if err != nil {
		t.Fatal(err)
	}
	if len(f.Entries) != 1 || f.Entries[0].MediaURL != "https://lab.example.org/audio/12.ogg" ||
		f.Entries[0].MediaType != "audio/ogg" || f.Entries[0].MediaSize != 5755 {
		t.Fatalf("entries = %+v", f.Entries)
	}
}

func TestABlogFeedIsNotAPodcastAndAPageIsNotAFeed(t *testing.T) {
	if _, err := ParsePodcast(fixture(t, "blog.rss")); !errors.Is(err, ErrNoEpisodes) {
		t.Errorf("blog: err = %v, want ErrNoEpisodes", err)
	}
	if _, err := ParsePodcast([]byte("<!doctype html><html><body>hi</body></html>")); !errors.Is(err, ErrNotFeed) {
		t.Errorf("html: err = %v, want ErrNotFeed", err)
	}
}

func TestDurations(t *testing.T) {
	for raw, want := range map[string]int{
		"1520": 1520, "18:30": 1110, "00:24:05": 1445, "1:02:03": 3723, "1520.7": 1520,
		"": 0, "abc": 0, "1:2:3:4": 0, "-5": 0,
	} {
		if got := ParseDuration(raw); got != want {
			t.Errorf("ParseDuration(%q) = %d, want %d", raw, got, want)
		}
	}
	for raw, want := range map[string]int{
		"PT12M5S": 725, "PT1H2M": 3720, "PT45S": 45, "P1DT1S": 86401, "P0D": 0, "nonsense": 0,
	} {
		if got := ParseISODuration(raw); got != want {
			t.Errorf("ParseISODuration(%q) = %d, want %d", raw, got, want)
		}
	}
}

// The fixture is the live keyless feed of Google for Developers' uploads
// playlist, recorded on 2026-10-16.
func TestAYouTubePlaylistFeedYieldsFifteenVideoIDs(t *testing.T) {
	f, err := ParseYouTube(fixture(t, "youtube_playlist.xml"))
	if err != nil {
		t.Fatal(err)
	}
	if len(f.Entries) != YouTubeFeedLimit {
		t.Fatalf("entries = %d, want %d", len(f.Entries), YouTubeFeedLimit)
	}
	if f.Title != "Uploads from Google for Developers" {
		t.Errorf("title = %q", f.Title)
	}
	for _, e := range f.Entries {
		if !videoID.MatchString(e.VideoID) || e.Key != e.VideoID || e.Title == "" || e.Published == nil || e.MediaURL != "" {
			t.Errorf("entry = %+v", e)
		}
	}
	if f.Entries[0].VideoID != "qJplHFjyv2A" {
		t.Errorf("newest = %s", f.Entries[0].VideoID)
	}
	ch, err := ParseYouTube(fixture(t, "youtube_channel.xml"))
	if err != nil || len(ch.Entries) != YouTubeFeedLimit {
		t.Fatalf("channel feed: %v, %d entries", err, len(ch.Entries))
	}
}

func TestLinkRecognition(t *testing.T) {
	cases := map[string]Target{
		"https://www.youtube.com/playlist?list=PLOU2XLYxmsIKfqoxytJ70EOjSVexbqbtc": {TargetPlaylist, "PLOU2XLYxmsIKfqoxytJ70EOjSVexbqbtc"},
		"https://m.youtube.com/playlist?list=UU_x5XG1OV2P6uZZ5FSM9Ttw&si=abc":      {TargetPlaylist, "UU_x5XG1OV2P6uZZ5FSM9Ttw"},
		"https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw":                 {TargetChannel, "UC_x5XG1OV2P6uZZ5FSM9Ttw"},
		"https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw/videos":          {TargetChannel, "UC_x5XG1OV2P6uZZ5FSM9Ttw"},
		"https://www.youtube.com/@GoogleDevelopers":                                {TargetHandle, "@GoogleDevelopers"},
		"https://youtube.com/@google.devs/featured":                                {TargetHandle, "@google.devs"},
		"https://www.youtube.com/c/Techsithtube":                                   {TargetHandle, "c/Techsithtube"},
		"https://youtube.com/user/derekbanas/videos":                               {TargetHandle, "user/derekbanas"},
		"https://www.youtube.com/c/AniaKub%C3%B3w/featured":                        {TargetHandle, "c/AniaKubów"},
	}
	for raw, want := range cases {
		got, ok := RecognizeYouTube(raw)
		if !ok || got != want {
			t.Errorf("RecognizeYouTube(%q) = %+v, %v; want %+v", raw, got, ok, want)
		}
	}
	for _, raw := range []string{
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://www.youtube.com/playlist?list=bad!",
		"https://www.youtube.com/channel/notachannel",
		"https://www.youtube.com/@x",
		"https://www.youtube.com/c/",
		"https://www.youtube.com/c/bad%20name",
		"https://www.youtube.com/results?search_query=go",
		"https://www.youtube.com/kepowob",
		"https://evil.example.com/playlist?list=PLOU2XLYxmsIKfqoxytJ70EOjSVexbqbtc",
		"https://user@www.youtube.com/@GoogleDevelopers",
		"javascript:alert(1)",
	} {
		if got, ok := RecognizeYouTube(raw); ok {
			t.Errorf("RecognizeYouTube(%q) = %+v, want no match", raw, got)
		}
	}
	if u := FeedURL(Target{TargetPlaylist, "PLx1234567890"}); u != "https://www.youtube.com/feeds/videos.xml?playlist_id=PLx1234567890" {
		t.Errorf("playlist feed = %s", u)
	}
	if u := FeedURL(Target{TargetChannel, "UC_x5XG1OV2P6uZZ5FSM9Ttw"}); u != "https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw" {
		t.Errorf("channel feed = %s", u)
	}
	if id, ok := PlaylistOf(FeedURL(Target{TargetPlaylist, "PLx1234567890"})); !ok || id != "PLx1234567890" {
		t.Errorf("PlaylistOf = %q, %v", id, ok)
	}
	if _, ok := PlaylistOf(FeedURL(Target{TargetChannel, "UC_x5XG1OV2P6uZZ5FSM9Ttw"})); ok {
		t.Error("a channel feed named a playlist")
	}
}

// Resolve reads a handle's page (the fixture is trimmed from the live one)
// and fetches the channel's feed. The fixture server stands in for
// www.youtube.com; http is enough here, FetchPage's limits are the same.
func TestAHandleResolvesThroughItsChannelPage(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.RequestURI())
		switch {
		case r.URL.Path == "/@GoogleDevelopers", r.URL.Path == "/c/GoogleDevelopers":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(fixture(t, "youtube_handle_page.html"))
		case r.URL.Path == "/feeds/videos.xml" && r.URL.Query().Get("channel_id") == "UC_x5XG1OV2P6uZZ5FSM9Ttw":
			w.Header().Set("Content-Type", "text/xml; charset=UTF-8")
			_, _ = w.Write(fixture(t, "youtube_channel.xml"))
		case r.URL.Path == "/@nobody1":
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte("<html><head><title>YouTube</title></head></html>"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	y := &YouTube{HTTP: aimed(srv), Base: "http://www.youtube.com"}
	ctx := context.Background()

	got, err := y.Resolve(ctx, Target{TargetHandle, "@GoogleDevelopers"})
	if err != nil || got != (Target{TargetChannel, "UC_x5XG1OV2P6uZZ5FSM9Ttw"}) {
		t.Fatalf("Resolve = %+v, %v", got, err)
	}
	f, err := y.Fetch(ctx, got)
	if err != nil || len(f.Entries) != YouTubeFeedLimit {
		t.Fatalf("Fetch = %v, %d", err, len(f.Entries))
	}
	// A channel's older /c/ address is read from its page the same way.
	if got, err := y.Resolve(ctx, Target{TargetHandle, "c/GoogleDevelopers"}); err != nil || got != (Target{TargetChannel, "UC_x5XG1OV2P6uZZ5FSM9Ttw"}) {
		t.Errorf("Resolve(c/…) = %+v, %v", got, err)
	}
	if _, err := y.Resolve(ctx, Target{TargetHandle, "@nobody1"}); !errors.Is(err, ErrNoChannel) {
		t.Errorf("a page with no channel: %v", err)
	}
}

// dataServer is the Data API: two pages of playlistItems and one
// videos.list per page, refusing any request without the key in its header.
func dataServer(t *testing.T, key string, calls *[]string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*calls = append(*calls, r.URL.RequestURI())
		if r.URL.Query().Get("key") != "" {
			t.Errorf("the key was sent in the URL: %s", r.URL)
		}
		if r.Header.Get("X-Goog-Api-Key") != key {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			// Google echoes nothing of the key, but a hostile or broken
			// upstream might: it must not reach the error.
			_, _ = w.Write([]byte(`{"error":{"message":"API key not valid: ` + r.Header.Get("X-Goog-Api-Key") + `"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=UTF-8")
		switch r.URL.Path {
		case "/youtube/v3/playlistItems":
			if r.URL.Query().Get("maxResults") != "50" {
				t.Errorf("maxResults = %s", r.URL.Query().Get("maxResults"))
			}
			if r.URL.Query().Get("pageToken") == "PAGE2" {
				_, _ = w.Write(fixture(t, "data_playlist_items_2.json"))
				return
			}
			_, _ = w.Write(fixture(t, "data_playlist_items_1.json"))
		case "/youtube/v3/videos":
			_, _ = w.Write(fixture(t, "data_videos.json"))
		case "/youtube/v3/i18nLanguages":
			_, _ = w.Write([]byte(`{"items":[]}`))
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestTheDataAPIListsAWholePlaylistPageByPage(t *testing.T) {
	const key = "AIzaFixtureKey-0123456789"
	var calls []string
	srv := dataServer(t, key, &calls)
	defer srv.Close()
	d := &Data{HTTP: aimed(srv), Base: "http://www.googleapis.com/youtube/v3"}

	entries, truncated, err := d.Playlist(context.Background(), key, "PLfixture0001")
	if err != nil {
		t.Fatal(err)
	}
	// Three items over two pages; the private one is left out.
	if truncated || len(entries) != 2 {
		t.Fatalf("entries = %+v, truncated %v", entries, truncated)
	}
	if entries[0].VideoID != "aaaaaaaaaa1" || entries[0].DurationSeconds != 725 || entries[0].Title != "Lesson 1: Sounds" ||
		entries[1].VideoID != "aaaaaaaaaa3" || entries[1].DurationSeconds != 3720 {
		t.Errorf("entries = %+v", entries)
	}
	if len(calls) != 4 {
		t.Errorf("calls = %v", calls)
	}
	if err := d.Ping(context.Background(), key); err != nil {
		t.Errorf("Ping: %v", err)
	}
}

func TestTheDataAPIKeyNeverAppearsInAnError(t *testing.T) {
	const key = "AIzaFixtureKey-0123456789"
	var calls []string
	srv := dataServer(t, key, &calls)
	d := &Data{HTTP: aimed(srv), Base: "http://www.googleapis.com/youtube/v3"}
	ctx := context.Background()

	const wrong = "AIzaWrongKey-SECRET-9876"
	_, _, err := d.Playlist(ctx, wrong, "PLfixture0001")
	if err == nil || strings.Contains(err.Error(), wrong) || !errors.Is(err, ErrDataKeyRefused) {
		t.Fatalf("refused key: err = %v", err)
	}
	if err := d.Ping(ctx, wrong); err == nil || strings.Contains(err.Error(), wrong) {
		t.Fatalf("Ping: err = %v", err)
	}
	// A transport failure (the server gone) prints the URL in Go's own
	// error; the URL has no key, and the sentence drops it anyway.
	srv.Close()
	_, _, err = d.Playlist(ctx, wrong, "PLfixture0001")
	if err == nil || strings.Contains(err.Error(), wrong) || strings.Contains(err.Error(), "googleapis") {
		t.Fatalf("transport: err = %v", err)
	}
}
