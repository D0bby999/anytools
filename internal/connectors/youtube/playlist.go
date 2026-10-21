package youtube

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/media"
	"github.com/D0bby999/anytools/internal/security"
)

// playlist.go — a YouTube playlist as a course (learning-tool-connections
// phase 7): its title and its videos in order, so each can be added as a
// link document through the path a single video takes.
//
// The YouTube Data API (playlistItems.list, one quota unit per page of 50)
// answers when the server has a Google API key with the API enabled;
// otherwise yt-dlp's --flat-playlist lists the same thing without a key.

// MaxPlaylist bounds one playlist.
const MaxPlaylist = 200

// ErrNotAPlaylist reports a URL with no playlist in it.
var ErrNotAPlaylist = errors.New("youtube: that link has no playlist in it")

// ErrPlaylistUnavailable reports a private, deleted or empty playlist.
var ErrPlaylistUnavailable = errors.New("youtube: that playlist is private, deleted or empty")

var listPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{10,64}$`)

// PlaylistID returns the list id of a YouTube playlist link: a /playlist
// page, or a watch link carrying list=.
func PlaylistID(raw string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || !youtubeHosts[strings.ToLower(u.Hostname())] {
		return "", false
	}
	id := u.Query().Get("list")
	// Mixes ("RD…") are generated per viewer and cannot be listed.
	if !listPattern.MatchString(id) || strings.HasPrefix(id, "RD") {
		return "", false
	}
	return id, true
}

// PlaylistVideo is one video of a playlist.
type PlaylistVideo struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	URL   string `json:"url"`
}

// Playlist is a playlist's title and videos, in order.
type Playlist struct {
	ID     string          `json:"id"`
	Title  string          `json:"title"`
	Videos []PlaylistVideo `json:"videos"`
	// Truncated says the playlist is longer than MaxPlaylist.
	Truncated bool `json:"truncated"`
}

// PlaylistReader lists playlists.
type PlaylistReader struct {
	APIKey string
	// Bin is yt-dlp, for a server without a working key.
	Bin  string
	HTTP *http.Client
	// Base is "https://www.googleapis.com/youtube/v3"; tests point it elsewhere.
	Base string
}

// NewPlaylistReader returns the production reader.
func NewPlaylistReader(apiKey, ytdlp string) *PlaylistReader {
	if ytdlp == "" {
		ytdlp = "yt-dlp"
	}
	return &PlaylistReader{
		APIKey: strings.TrimSpace(apiKey), Bin: ytdlp,
		HTTP: security.AllowlistClient(fetchTimeout, "www.googleapis.com"),
		Base: "https://www.googleapis.com/youtube/v3",
	}
}

// Read lists a playlist link's videos.
func (p *PlaylistReader) Read(ctx context.Context, raw string) (*Playlist, error) {
	id, ok := PlaylistID(raw)
	if !ok {
		return nil, ErrNotAPlaylist
	}
	if p.APIKey != "" {
		pl, err := p.fromAPI(ctx, id)
		if err == nil || errors.Is(err, ErrPlaylistUnavailable) {
			return pl, err
		}
		// A key without the YouTube Data API enabled, or a quota spent:
		// yt-dlp needs neither.
	}
	return p.fromYTDLP(ctx, id)
}

func (p *PlaylistReader) getJSON(ctx context.Context, u string, out any) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0, err
	}
	resp, err := p.HTTP.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return resp.StatusCode, err
	}
	if resp.StatusCode != http.StatusOK {
		return resp.StatusCode, fmt.Errorf("youtube: data API answered %d", resp.StatusCode)
	}
	return resp.StatusCode, json.Unmarshal(data, out)
}

func (p *PlaylistReader) fromAPI(ctx context.Context, id string) (*Playlist, error) {
	pl := &Playlist{ID: id}
	var meta struct {
		Items []struct {
			Snippet struct {
				Title string `json:"title"`
			} `json:"snippet"`
		} `json:"items"`
	}
	q := url.Values{"part": {"snippet"}, "id": {id}, "key": {p.APIKey}}
	if _, err := p.getJSON(ctx, p.Base+"/playlists?"+q.Encode(), &meta); err != nil {
		return nil, err
	}
	if len(meta.Items) == 0 {
		return nil, ErrPlaylistUnavailable
	}
	pl.Title = meta.Items[0].Snippet.Title

	token := ""
	for len(pl.Videos) < MaxPlaylist {
		q := url.Values{"part": {"snippet"}, "playlistId": {id}, "maxResults": {"50"}, "key": {p.APIKey}}
		if token != "" {
			q.Set("pageToken", token)
		}
		var page struct {
			Items []struct {
				Snippet struct {
					Title      string `json:"title"`
					ResourceID struct {
						VideoID string `json:"videoId"`
					} `json:"resourceId"`
				} `json:"snippet"`
			} `json:"items"`
			Next string `json:"nextPageToken"`
		}
		if _, err := p.getJSON(ctx, p.Base+"/playlistItems?"+q.Encode(), &page); err != nil {
			return nil, err
		}
		for _, it := range page.Items {
			v := it.Snippet.ResourceID.VideoID
			// Deleted and private entries keep their place with no video.
			if !ValidID(v) || it.Snippet.Title == "Deleted video" || it.Snippet.Title == "Private video" {
				continue
			}
			if len(pl.Videos) == MaxPlaylist {
				pl.Truncated = true
				break
			}
			pl.Videos = append(pl.Videos, PlaylistVideo{ID: v, Title: it.Snippet.Title, URL: WatchURL(v)})
		}
		if page.Next == "" {
			break
		}
		if len(pl.Videos) == MaxPlaylist {
			pl.Truncated = true
			break
		}
		token = page.Next
	}
	if len(pl.Videos) == 0 {
		return nil, ErrPlaylistUnavailable
	}
	return pl, nil
}

// PlaylistArgs is yt-dlp's command line for a playlist listing.
func PlaylistArgs(id string) []string {
	return []string{
		"--flat-playlist", "-J",
		"--playlist-end", fmt.Sprint(MaxPlaylist + 1),
		"--no-config", "--no-cache-dir",
		"https://www.youtube.com/playlist?list=" + id,
	}
}

func (p *PlaylistReader) fromYTDLP(ctx context.Context, id string) (*Playlist, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	dir, err := os.MkdirTemp("", "yt-playlist-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	cmd := media.Command(ctx, p.Bin, dir, PlaylistArgs(id)...)
	var stdout bytes.Buffer
	var stderr media.Output
	cmd.Stdout, cmd.Stderr = &limited{w: &stdout, n: 8 << 20}, &stderr
	if err := cmd.Run(); err != nil {
		if strings.Contains(stderr.String(), "does not exist") || strings.Contains(stderr.String(), "private") {
			return nil, ErrPlaylistUnavailable
		}
		return nil, fmt.Errorf("youtube: yt-dlp could not list the playlist: %w", err)
	}
	return ParseFlatPlaylist(stdout.Bytes())
}

// ParseFlatPlaylist reads yt-dlp's --flat-playlist -J output.
func ParseFlatPlaylist(data []byte) (*Playlist, error) {
	var raw struct {
		ID      string `json:"id"`
		Title   string `json:"title"`
		Entries []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("youtube: yt-dlp's listing: %w", err)
	}
	pl := &Playlist{ID: raw.ID, Title: raw.Title}
	for _, e := range raw.Entries {
		if !ValidID(e.ID) || e.Title == "[Deleted video]" || e.Title == "[Private video]" {
			continue
		}
		if len(pl.Videos) == MaxPlaylist {
			pl.Truncated = true
			break
		}
		pl.Videos = append(pl.Videos, PlaylistVideo{ID: e.ID, Title: e.Title, URL: WatchURL(e.ID)})
	}
	if len(pl.Videos) == 0 {
		return nil, ErrPlaylistUnavailable
	}
	return pl, nil
}

// limited writes at most n bytes and drops the rest.
type limited struct {
	w io.Writer
	n int
}

func (l *limited) Write(p []byte) (int, error) {
	if l.n <= 0 {
		return len(p), nil
	}
	keep := p
	if len(keep) > l.n {
		keep = keep[:l.n]
	}
	l.n -= len(keep)
	if _, err := l.w.Write(keep); err != nil {
		return 0, err
	}
	return len(p), nil
}
