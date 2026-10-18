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
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/security"
)

// innertube.go — the server's own caption fetch (external findings §1).
//
// The watch page's `timedtext` URLs are dead for web clients: they carry
// `exp=xpe`, meaning a PO token is required, and answer 200 with zero bytes.
// What still works from a residential address is youtube-transcript-api's
// current path: read the public web key from the watch page, ask the player
// endpoint as the ANDROID client, and GET the caption track it names. From a
// cloud address YouTube usually refuses all of this, which is why a failure
// here is an ordinary outcome with a reason, and never an error page: the
// learner goes on to a Gemini transcript or a subtitle file.
//
// Every request goes through security.AllowlistClient("www.youtube.com"): the
// watch page, the player response and the caption URL it returns can name no
// other host, and neither can a redirect.

// Host is the one host this connector's server-side calls may reach.
const Host = "www.youtube.com"

// androidClient is youtube-transcript-api's client context (PyPI v1.2.4,
// read 2026-09-26). YouTube changes what it accepts without notice; when this
// stops working the caption fetch fails with a reason and the fallbacks run.
var androidClient = map[string]any{"clientName": "ANDROID", "clientVersion": "20.10.38"}

const (
	fetchTimeout  = 20 * time.Second
	maxWatchPage  = 4 << 20
	maxPlayerJSON = 2 << 20
	maxOEmbed     = 64 << 10
)

// Why a caption fetch failed. Stored on the document and shown, so the
// learner knows whether retrying could help.
const (
	ReasonBlocked    = "blocked"     // YouTube refused this server, or showed a consent wall
	ReasonGated      = "gated"       // the track needs a PO token (exp=xpe)
	ReasonNoCaptions = "no_captions" // the video has no caption track
	ReasonUnplayable = "unplayable"  // private, removed, age- or sign-in-gated
	ReasonNetwork    = "network"     // YouTube could not be reached
)

// FetchError is a caption fetch that did not produce a transcript.
type FetchError struct {
	Reason string
	cause  error
}

func (e *FetchError) Error() string {
	if e.cause != nil {
		return "youtube: captions " + e.Reason + ": " + e.cause.Error()
	}
	return "youtube: captions " + e.Reason
}

func (e *FetchError) Unwrap() error { return e.cause }

// Track is one caption track the player offers.
type Track struct {
	Lang string `json:"lang"`
	Name string `json:"name"`
	// Auto is true for YouTube's speech-recognised track.
	Auto    bool   `json:"auto,omitempty"`
	baseURL string // never stored: it is signed and expires
}

// Video is what the player endpoint says about a video.
type Video struct {
	Title           string
	Channel         string
	DurationSeconds int
	Tracks          []Track
	// Description is the creator's, bounded (CleanDescription); Chapters are
	// read from it (ParseChapters).
	Description string
	Chapters    []Chapter
}

// Client is the allowlisted YouTube client.
type Client struct {
	HTTP *http.Client
	// Base is "https://www.youtube.com"; tests point it at a fixture server.
	Base string
}

// NewClient is the production client.
func NewClient() *Client {
	return &Client{HTTP: security.AllowlistClient(fetchTimeout, Host), Base: "https://" + Host}
}

// Meta is a video's oEmbed metadata.
type Meta struct {
	Title   string
	Channel string
}

// OEmbed reads the keyless oEmbed endpoint: title and channel. It is the call
// most likely to succeed from a server, so a video gets its real title even
// when its captions are blocked.
func (c *Client) OEmbed(ctx context.Context, id string) (*Meta, error) {
	if !ValidID(id) {
		return nil, errors.New("youtube: invalid id")
	}
	q := url.Values{"url": {WatchURL(id)}, "format": {"json"}}
	raw, err := c.get(ctx, c.Base+"/oembed?"+q.Encode(), maxOEmbed)
	if err != nil {
		return nil, err
	}
	var r struct {
		Title  string `json:"title"`
		Author string `json:"author_name"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("youtube: oembed: %w", err)
	}
	return &Meta{Title: strings.TrimSpace(r.Title), Channel: strings.TrimSpace(r.Author)}, nil
}

var webKeyPattern = regexp.MustCompile(`"INNERTUBE_API_KEY"\s*:\s*"([A-Za-z0-9_-]{10,80})"`)

// Player asks the player endpoint about a video.
func (c *Client) Player(ctx context.Context, id string) (*Video, error) {
	if !ValidID(id) {
		return nil, errors.New("youtube: invalid id")
	}
	page, err := c.get(ctx, c.Base+"/watch?v="+id, maxWatchPage)
	if err != nil {
		return nil, fetchFailure(err)
	}
	m := webKeyPattern.FindSubmatch(page)
	if m == nil {
		// A consent wall or a bot check has no ytcfg at all.
		return nil, &FetchError{Reason: ReasonBlocked, cause: errors.New("the watch page carried no web key")}
	}

	body, _ := json.Marshal(map[string]any{
		"context": map[string]any{"client": androidClient},
		"videoId": id,
	})
	endpoint := c.Base + "/youtubei/v1/player?key=" + url.QueryEscape(string(m[1]))
	raw, err := c.do(ctx, http.MethodPost, endpoint, body, maxPlayerJSON)
	if err != nil {
		return nil, fetchFailure(err)
	}

	var r struct {
		PlayabilityStatus struct {
			Status string `json:"status"`
			Reason string `json:"reason"`
		} `json:"playabilityStatus"`
		VideoDetails struct {
			Title         string `json:"title"`
			Author        string `json:"author"`
			LengthSeconds string `json:"lengthSeconds"`
			Description   string `json:"shortDescription"`
		} `json:"videoDetails"`
		Captions struct {
			Renderer struct {
				Tracks []struct {
					BaseURL string `json:"baseUrl"`
					Lang    string `json:"languageCode"`
					Kind    string `json:"kind"`
					Name    struct {
						SimpleText string `json:"simpleText"`
						Runs       []struct {
							Text string `json:"text"`
						} `json:"runs"`
					} `json:"name"`
				} `json:"captionTracks"`
			} `json:"playerCaptionsTracklistRenderer"`
		} `json:"captions"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, &FetchError{Reason: ReasonBlocked, cause: fmt.Errorf("unreadable player response: %w", err)}
	}
	if r.PlayabilityStatus.Status != "OK" {
		reason := ReasonUnplayable
		if strings.Contains(strings.ToLower(r.PlayabilityStatus.Reason), "bot") {
			reason = ReasonBlocked
		}
		return nil, &FetchError{Reason: reason, cause: fmt.Errorf("playability %s", r.PlayabilityStatus.Status)}
	}

	v := &Video{Title: strings.TrimSpace(r.VideoDetails.Title), Channel: strings.TrimSpace(r.VideoDetails.Author)}
	v.DurationSeconds, _ = strconv.Atoi(r.VideoDetails.LengthSeconds)
	v.Description = CleanDescription(r.VideoDetails.Description)
	v.Chapters = ParseChapters(r.VideoDetails.Description, v.DurationSeconds)
	for _, t := range r.Captions.Renderer.Tracks {
		name := t.Name.SimpleText
		for _, run := range t.Name.Runs {
			name += run.Text
		}
		v.Tracks = append(v.Tracks, Track{Lang: t.Lang, Name: strings.TrimSpace(name), Auto: t.Kind == "asr", baseURL: t.BaseURL})
	}
	return v, nil
}

// Captions downloads one track and parses it.
func (c *Client) Captions(ctx context.Context, t Track) ([]Cue, error) {
	if strings.Contains(t.baseURL, "exp=xpe") {
		// youtube-transcript-api raises PoTokenRequired on exactly this; the
		// request would answer 200 with an empty body.
		return nil, &FetchError{Reason: ReasonGated}
	}
	u, err := url.Parse(t.baseURL)
	if err != nil || u.Scheme != "https" || !strings.EqualFold(u.Host, Host) {
		return nil, &FetchError{Reason: ReasonBlocked, cause: errors.New("the caption track is not on www.youtube.com")}
	}
	// The recorded srv3 and legacy formats both parse; srv3 is dropped as
	// youtube-transcript-api does, for the plain <text> shape.
	q := u.Query()
	q.Del("fmt")
	raw, err := c.get(ctx, c.Base+u.Path+"?"+q.Encode(), MaxTranscriptBytes)
	if err != nil {
		return nil, fetchFailure(err)
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, &FetchError{Reason: ReasonGated, cause: errors.New("empty caption track")}
	}
	return ParseTimedText(raw)
}

// PickTrack chooses a track: the requested language, then Vietnamese, then
// English, then the first. Within a language a human track beats the
// speech-recognised one.
func PickTrack(tracks []Track, want string) (Track, bool) {
	for _, lang := range []string{want, "vi", "en"} {
		if lang == "" {
			continue
		}
		var auto *Track
		for i := range tracks {
			if baseLang(tracks[i].Lang) != baseLang(lang) {
				continue
			}
			if !tracks[i].Auto {
				return tracks[i], true
			}
			if auto == nil {
				auto = &tracks[i]
			}
		}
		if auto != nil {
			return *auto, true
		}
	}
	if len(tracks) > 0 {
		return tracks[0], true
	}
	return Track{}, false
}

func baseLang(l string) string {
	l = strings.ToLower(l)
	if i := strings.IndexAny(l, "-_"); i > 0 {
		return l[:i]
	}
	return l
}

// Fetched is a transcript the server fetched itself.
type Fetched struct {
	Video      *Video
	Transcript *Transcript
}

// FetchTranscript runs the whole caption path for one video. When it fails
// the Video is still returned if the player answered, so the duration and
// the track list reach the page.
func (c *Client) FetchTranscript(ctx context.Context, id, lang string) (*Fetched, error) {
	video, err := c.Player(ctx, id)
	if err != nil {
		return nil, err
	}
	track, ok := PickTrack(video.Tracks, lang)
	if !ok {
		return &Fetched{Video: video}, &FetchError{Reason: ReasonNoCaptions}
	}
	cues, err := c.Captions(ctx, track)
	if err != nil {
		var fe *FetchError
		if !errors.As(err, &fe) {
			err = &FetchError{Reason: ReasonNoCaptions, cause: err}
		}
		return &Fetched{Video: video}, err
	}
	return &Fetched{Video: video, Transcript: &Transcript{Language: track.Lang, Auto: track.Auto, Timed: true, Cues: cues}}, nil
}

func (c *Client) get(ctx context.Context, u string, limit int) ([]byte, error) {
	return c.do(ctx, http.MethodGet, u, nil, limit)
}

// do sends one request with a bounded read. An English Accept-Language keeps
// the watch page's shape stable; no cookie is ever sent.
func (c *Client) do(ctx context.Context, method, u string, body []byte, limit int) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; AnyTools/1.0)")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, int64(limit)+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > limit {
		return nil, fmt.Errorf("youtube: response larger than %d bytes", limit)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, &security.HTTPStatusError{Status: resp.StatusCode}
	}
	return raw, nil
}

// fetchFailure classifies a transport failure: YouTube refusing this server
// (403, 429) is "blocked", anything else "network".
func fetchFailure(err error) error {
	var fe *FetchError
	if errors.As(err, &fe) {
		return err
	}
	var st *security.HTTPStatusError
	if errors.As(err, &st) && (st.Status == http.StatusForbidden || st.Status == http.StatusTooManyRequests) {
		return &FetchError{Reason: ReasonBlocked, cause: err}
	}
	return &FetchError{Reason: ReasonNetwork, cause: err}
}
