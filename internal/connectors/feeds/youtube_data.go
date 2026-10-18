package feeds

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/security"
)

// youtube_data.go — a whole playlist through the YouTube Data API v3, with
// the learner's own key (the youtube_data search connection). The keyless
// feed lists only the latest 15 videos; playlistItems lists every one, 50 a
// page. AnyTools stops at MaxDataEntries.
//
// The key is used only from the server. It travels in the X-Goog-Api-Key
// header, never in a URL, so no *url.Error can print it; and every error
// this file returns is one of its own sentences, scrubbed of the key besides.

// MaxDataEntries is the most entries a playlist lists through the Data API.
const MaxDataEntries = 500

// dataPageSize is playlistItems' largest page.
const dataPageSize = 50

// DataAPIBase is the Data API's production endpoint.
const DataAPIBase = "https://www.googleapis.com/youtube/v3"

// Data is the YouTube Data API client.
type Data struct {
	// HTTP is security.FetchClient (or an allowlist over it) in production.
	HTTP *http.Client
	// Base is DataAPIBase; tests point it at a fixture.
	Base string
}

// NewData is the production client.
func NewData(client *http.Client) *Data {
	return &Data{HTTP: client, Base: DataAPIBase}
}

// DataError is a Data API refusal, in a sentence written for the learner.
// It never carries the key or anything Google sent.
type DataError struct {
	Status int
	Msg    string
}

func (e *DataError) Error() string { return e.Msg }

// ErrDataKeyRefused is a 400/401/403 to the key itself.
var ErrDataKeyRefused = errors.New("feeds: the YouTube Data API refused the key")

// Is lets errors.Is(err, ErrDataKeyRefused) find a refused key.
func (e *DataError) Is(target error) bool {
	return target == ErrDataKeyRefused && (e.Status == 400 || e.Status == 401 || e.Status == 403)
}

func (d *Data) get(ctx context.Context, key, path string, q url.Values, out any) error {
	page, err := security.FetchPage(ctx, d.HTTP, security.PageRequest{
		URL: d.Base + path + "?" + q.Encode(), Accept: "application/json", UserAgent: feedUserAgent,
		Types: []string{"application/json"}, MaxBytes: 2 << 20,
		Header: http.Header{"X-Goog-Api-Key": []string{key}},
	})
	if err != nil {
		return dataError(err)
	}
	if err := json.Unmarshal(page.Body, out); err != nil {
		return &DataError{Msg: "the YouTube Data API's answer was not readable"}
	}
	return nil
}

// dataError maps a fetch failure to a fixed sentence.
func dataError(err error) error {
	var status *security.HTTPStatusError
	if errors.As(err, &status) {
		switch {
		case status.Status == http.StatusNotFound:
			return &DataError{Status: status.Status, Msg: "YouTube does not know this playlist, or it is private"}
		case status.Status == http.StatusForbidden || status.Status == http.StatusUnauthorized || status.Status == http.StatusBadRequest:
			return &DataError{Status: status.Status, Msg: "the YouTube Data API refused the key (check it in Settings, Search keys, or its daily quota)"}
		case status.Status == http.StatusTooManyRequests:
			return &DataError{Status: status.Status, Msg: "the YouTube Data API's limit was reached; try again later"}
		}
		return &DataError{Status: status.Status, Msg: fmt.Sprintf("the YouTube Data API answered HTTP %d", status.Status)}
	}
	// The transport's own text is dropped, whatever it says.
	return &DataError{Msg: "the YouTube Data API could not be reached"}
}

type playlistItems struct {
	NextPageToken string `json:"nextPageToken"`
	Items         []struct {
		Snippet struct {
			Title       string `json:"title"`
			PublishedAt string `json:"publishedAt"`
		} `json:"snippet"`
		ContentDetails struct {
			VideoID          string `json:"videoId"`
			VideoPublishedAt string `json:"videoPublishedAt"`
		} `json:"contentDetails"`
		Status struct {
			PrivacyStatus string `json:"privacyStatus"`
		} `json:"status"`
	} `json:"items"`
}

type videoList struct {
	Items []struct {
		ID             string `json:"id"`
		ContentDetails struct {
			Duration string `json:"duration"`
		} `json:"contentDetails"`
	} `json:"items"`
}

// Playlist lists a playlist's videos in playlist order, 50 a page, at most
// MaxDataEntries, with each one's length (videos.list, 50 ids a call).
// Private and deleted videos are left out. truncated reports a playlist
// longer than the cap.
func (d *Data) Playlist(ctx context.Context, key, id string) (entries []Entry, truncated bool, err error) {
	if !playlistID.MatchString(id) {
		return nil, false, &DataError{Msg: "that is not a YouTube playlist"}
	}
	seen := map[string]bool{}
	token := ""
	for page := 0; ; page++ {
		if page*dataPageSize >= MaxDataEntries {
			return entries, token != "", nil
		}
		q := url.Values{"part": {"snippet,contentDetails,status"}, "playlistId": {id},
			"maxResults": {strconv.Itoa(dataPageSize)}}
		if token != "" {
			q.Set("pageToken", token)
		}
		var got playlistItems
		if err := d.get(ctx, key, "/playlistItems", q, &got); err != nil {
			return nil, false, err
		}
		var ids []string
		for _, it := range got.Items {
			v := it.ContentDetails.VideoID
			if !videoID.MatchString(v) || seen[v] || it.Status.PrivacyStatus == "private" ||
				it.Status.PrivacyStatus == "privacyStatusUnspecified" {
				continue
			}
			seen[v] = true
			e := Entry{Key: v, VideoID: v, Title: clean(it.Snippet.Title, 300)}
			at := it.ContentDetails.VideoPublishedAt
			if at == "" {
				at = it.Snippet.PublishedAt
			}
			if t, err := time.Parse(time.RFC3339, at); err == nil {
				u := t.UTC()
				e.Published = &u
			}
			if e.Title == "" {
				e.Title = "YouTube video " + v
			}
			entries = append(entries, e)
			ids = append(ids, v)
			if len(entries) == MaxDataEntries {
				break
			}
		}
		if err := d.durations(ctx, key, ids, entries); err != nil {
			return nil, false, err
		}
		token = got.NextPageToken
		if token == "" || len(entries) >= MaxDataEntries {
			return entries, token != "", nil
		}
	}
}

// durations fills in the lengths of ids, which are the last len(ids)
// entries.
func (d *Data) durations(ctx context.Context, key string, ids []string, entries []Entry) error {
	if len(ids) == 0 {
		return nil
	}
	var got videoList
	q := url.Values{"part": {"contentDetails"}, "id": {strings.Join(ids, ",")}, "maxResults": {strconv.Itoa(dataPageSize)}}
	if err := d.get(ctx, key, "/videos", q, &got); err != nil {
		return err
	}
	length := map[string]int{}
	for _, v := range got.Items {
		length[v.ID] = ParseISODuration(v.ContentDetails.Duration)
	}
	for i := len(entries) - len(ids); i < len(entries); i++ {
		entries[i].DurationSeconds = length[entries[i].VideoID]
	}
	return nil
}

// Ping checks a key with the cheapest read there is (one quota unit).
func (d *Data) Ping(ctx context.Context, key string) error {
	var got struct{}
	return d.get(ctx, key, "/i18nLanguages", url.Values{"part": {"snippet"}, "hl": {"en"}}, &got)
}

var isoDuration = regexp.MustCompile(`^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$`)

// ParseISODuration reads the Data API's ISO 8601 length ("PT1H2M5S").
// Anything else is 0.
func ParseISODuration(raw string) int {
	m := isoDuration.FindStringSubmatch(raw)
	if m == nil {
		return 0
	}
	total := 0
	for i, unit := range []int{86400, 3600, 60, 1} {
		if m[i+1] == "" {
			continue
		}
		n, err := strconv.Atoi(m[i+1])
		if err != nil {
			return 0
		}
		total += n * unit
	}
	return total
}
