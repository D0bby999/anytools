// Package wordsources finds example sentences and recorded pronunciations
// for a saved word in open sources (the private design notes, phase 6): Tatoeba's sentences, with a translation into the
// learner's language when there is one, and recordings from Lingua Libre
// (on Wikimedia Commons) and the Free Dictionary API (Wiktionary's, for
// English). Every result carries its licence, its author and its page.
//
// The server makes these calls, never the learner's browser: a timeout on
// each, a cache shared by everyone (the answers are public), and audio sent
// on only from the two hosts recordings live on.
package wordsources

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/D0bby999/anytools/internal/security"
)

// UserAgent names AnyTools to the services, as their policies ask.
const UserAgent = "AnyTools/1.0 (https://anytools.world; word lookups)"

const (
	timeout = 8 * time.Second
	// tatoebaTimeout: Tatoeba's API took about 30 s for any query on
	// 2026-10-21; the answer is cached, so only the first lookup waits.
	tatoebaTimeout = 45 * time.Second
	// cacheFor and cacheMax: a word's answers are kept a week, for at most
	// cacheMax words and languages.
	cacheFor = 7 * 24 * time.Hour
	cacheMax = 4000
	// MaxAudio is the largest recording sent on (a word is a second or two).
	MaxAudio = 3 << 20
	// MaxSentences is the most sentences one lookup returns.
	MaxSentences = 6
)

// ErrUnavailable is a source that did not answer, or answered with an error.
var ErrUnavailable = errors.New("the source did not answer")

// ErrNotARecording is an id that is not one this package returned.
var ErrNotARecording = errors.New("not a recording")

// Sentence is an example from Tatoeba.
type Sentence struct {
	ID      int    `json:"id"`
	Text    string `json:"text"`
	Licence string `json:"licence"`
	Author  string `json:"author"`
	URL     string `json:"url"`
	// Translation is into the language asked for, when Tatoeba has one.
	Translation *Translation `json:"translation,omitempty"`
}

// Translation is a sentence's translation, with its own licence and author.
type Translation struct {
	Text    string `json:"text"`
	Licence string `json:"licence"`
	Author  string `json:"author"`
}

// Recording is a person saying the word.
type Recording struct {
	// ID is what Audio takes: "commons:<file name>" or "dictapi:<path>".
	ID      string `json:"id"`
	Speaker string `json:"speaker"`
	Licence string `json:"licence"`
	// Page is the recording's page, which says who made it and under what.
	Page   string `json:"page"`
	Source string `json:"source"`
}

// Client calls the sources.
type Client struct {
	hc       *http.Client
	slow     *http.Client
	tatoeba  string
	commons  string
	dictapi  string
	now      func() time.Time
	mu       sync.Mutex
	cache    map[string]cached
	audioHTT *http.Client
}

type cached struct {
	at  time.Time
	val any
}

// New is a client on the public endpoints.
func New() *Client {
	return &Client{
		hc:       security.SafeClient(timeout),
		slow:     security.SafeClient(tatoebaTimeout),
		audioHTT: security.SafeClient(timeout),
		tatoeba:  "https://api.tatoeba.org",
		commons:  "https://commons.wikimedia.org",
		dictapi:  "https://api.dictionaryapi.dev",
		now:      time.Now,
		cache:    map[string]cached{},
	}
}

// WithEndpoints points the client at test servers.
func (c *Client) WithEndpoints(tatoeba, commons, dictapi string, hc *http.Client) *Client {
	c.tatoeba, c.commons, c.dictapi, c.hc, c.slow, c.audioHTT = tatoeba, commons, dictapi, hc, hc, hc
	return c
}

func (c *Client) remember(key string, compute func() (any, error)) (any, error) {
	c.mu.Lock()
	if e, ok := c.cache[key]; ok && c.now().Sub(e.at) < cacheFor {
		c.mu.Unlock()
		return e.val, nil
	}
	c.mu.Unlock()
	v, err := compute()
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	if len(c.cache) >= cacheMax {
		// Full: the oldest half goes. Rare, and simpler than an LRU list.
		cut := c.now().Add(-cacheFor / 2)
		for k, e := range c.cache {
			if e.at.Before(cut) || len(c.cache) >= cacheMax {
				delete(c.cache, k)
			}
		}
	}
	c.cache[key] = cached{at: c.now(), val: v}
	c.mu.Unlock()
	return v, nil
}

func (c *Client) getJSON(ctx context.Context, u string, v any) error {
	return c.getJSONWith(ctx, c.hc, u, v)
}

func (c *Client) getJSONWith(ctx context.Context, hc *http.Client, u string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", "application/json")
	res, err := hc.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return nil // nothing for this word
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: HTTP %d", ErrUnavailable, res.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(v); err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return nil
}

// iso3 is Tatoeba's and Lingua Libre's code for a language AnyLearn names
// by its two-letter code; a language not here has no lookups.
var iso3 = map[string]string{
	"ar": "ara", "bg": "bul", "ca": "cat", "cs": "ces", "da": "dan", "de": "deu", "el": "ell", "en": "eng",
	"eo": "epo", "es": "spa", "et": "est", "fa": "pes", "fi": "fin", "fr": "fra", "he": "heb", "hi": "hin",
	"hu": "hun", "id": "ind", "it": "ita", "ja": "jpn", "ko": "kor", "lt": "lit", "lv": "lvs", "ms": "zsm",
	"nb": "nob", "nl": "nld", "no": "nob", "pl": "pol", "pt": "por", "ro": "ron", "ru": "rus", "sk": "slk",
	"sl": "slv", "sr": "srp", "sv": "swe", "th": "tha", "tl": "tgl", "tr": "tur", "uk": "ukr", "ur": "urd",
	"vi": "vie", "zh": "cmn",
}

// ISO3 is a language's three-letter code for these sources, "" if none.
func ISO3(lang string) string { return iso3[strings.ToLower(strings.SplitN(lang, "-", 2)[0])] }

// Sentences is up to MaxSentences of Tatoeba's sentences with the term, in
// lang, each with its translation into to when there is one. The exact form
// first ("=term"); for a language written without spaces, any match.
func (c *Client) Sentences(ctx context.Context, lang, term, to string) ([]Sentence, error) {
	from, into := ISO3(lang), ISO3(to)
	term = strings.TrimSpace(term)
	if from == "" || term == "" || utf8.RuneCountInString(term) > 80 {
		return nil, nil
	}
	v, err := c.remember("s|"+from+"|"+into+"|"+strings.ToLower(term), func() (any, error) {
		q := "=" + term
		if from == "cmn" || from == "jpn" || from == "tha" {
			q = term
		}
		p := url.Values{"lang": {from}, "q": {q}, "sort": {"relevance"}, "limit": {fmt.Sprint(MaxSentences)}}
		if into != "" && into != from {
			p.Set("trans:lang", into)
		}
		var body struct {
			Data []struct {
				ID           int    `json:"id"`
				Text         string `json:"text"`
				License      string `json:"license"`
				Owner        string `json:"owner"`
				Unapproved   bool   `json:"is_unapproved"`
				Translations []struct {
					Text       string `json:"text"`
					Lang       string `json:"lang"`
					License    string `json:"license"`
					Owner      string `json:"owner"`
					Unapproved bool   `json:"is_unapproved"`
					Direct     bool   `json:"is_direct"`
				} `json:"translations"`
			} `json:"data"`
		}
		if err := c.getJSONWith(ctx, c.slow, c.tatoeba+"/unstable/sentences?"+p.Encode(), &body); err != nil {
			return nil, err
		}
		out := []Sentence{}
		for _, d := range body.Data {
			if d.Unapproved || strings.TrimSpace(d.Text) == "" || d.License == "" {
				continue
			}
			s := Sentence{ID: d.ID, Text: strings.TrimSpace(d.Text), Licence: d.License, Author: d.Owner,
				URL: fmt.Sprintf("https://tatoeba.org/en/sentences/show/%d", d.ID)}
			for _, t := range d.Translations {
				if t.Lang == into && !t.Unapproved && t.License != "" && (s.Translation == nil || t.Direct) {
					s.Translation = &Translation{Text: strings.TrimSpace(t.Text), Licence: t.License, Author: t.Owner}
				}
			}
			out = append(out, s)
		}
		return out, nil
	})
	if err != nil {
		return nil, err
	}
	return v.([]Sentence), nil
}

// llTitle is a Lingua Libre file: "File:LL-Q<n> (<iso3>)-<speaker>-<word>.wav".
var llTitle = regexp.MustCompile(`^File:LL-Q\d+ \(([a-z]{3})\)-(.+?)-(.+)\.wav$`)

// Recordings is people saying the term: Lingua Libre's, and for English
// Wiktionary's through the Free Dictionary API.
func (c *Client) Recordings(ctx context.Context, lang, term string) ([]Recording, error) {
	code := ISO3(lang)
	term = strings.TrimSpace(term)
	if code == "" || term == "" || utf8.RuneCountInString(term) > 80 {
		return nil, nil
	}
	v, err := c.remember("r|"+code+"|"+strings.ToLower(term), func() (any, error) {
		out, err := c.linguaLibre(ctx, code, term)
		if err != nil {
			return nil, err
		}
		if code == "eng" {
			more, err := c.dictionary(ctx, term)
			if err == nil {
				out = append(out, more...)
			}
		}
		if len(out) > 4 {
			out = out[:4]
		}
		return out, nil
	})
	if err != nil {
		return nil, err
	}
	return v.([]Recording), nil
}

func (c *Client) linguaLibre(ctx context.Context, code, term string) ([]Recording, error) {
	p := url.Values{
		"action": {"query"}, "format": {"json"}, "formatversion": {"2"},
		"generator": {"search"}, "gsrnamespace": {"6"}, "gsrlimit": {"50"},
		"gsrsearch": {fmt.Sprintf(`intitle:"LL-" intitle:"(%s)" intitle:%q`, code, term)},
		"prop":      {"imageinfo"}, "iiprop": {"extmetadata"}, "iiextmetadatafilter": {"LicenseShortName|Artist"},
	}
	var body struct {
		Query struct {
			Pages []struct {
				Title     string `json:"title"`
				ImageInfo []struct {
					Ext struct {
						Licence struct{ Value string } `json:"LicenseShortName"`
					} `json:"extmetadata"`
				} `json:"imageinfo"`
			} `json:"pages"`
		} `json:"query"`
	}
	if err := c.getJSON(ctx, c.commons+"/w/api.php?"+p.Encode(), &body); err != nil {
		return nil, err
	}
	out := []Recording{}
	for _, pg := range body.Query.Pages {
		m := llTitle.FindStringSubmatch(pg.Title)
		if m == nil || m[1] != code || !strings.EqualFold(m[3], term) || len(pg.ImageInfo) == 0 {
			continue
		}
		lic := strings.TrimSpace(pg.ImageInfo[0].Ext.Licence.Value)
		if lic == "" {
			continue
		}
		name := strings.TrimPrefix(pg.Title, "File:")
		out = append(out, Recording{
			ID: "commons:" + name, Speaker: m[2], Licence: lic, Source: "Lingua Libre",
			Page: "https://commons.wikimedia.org/wiki/" + url.PathEscape(strings.ReplaceAll(pg.Title, " ", "_")),
		})
	}
	return out, nil
}

// dictPath is a Free Dictionary API recording: "media/pronunciations/en/<word>-<accent>.mp3".
var dictPath = regexp.MustCompile(`^media/pronunciations/en/[A-Za-z0-9'_.-]+\.mp3$`)

func (c *Client) dictionary(ctx context.Context, term string) ([]Recording, error) {
	var body []struct {
		Phonetics []struct {
			Audio     string `json:"audio"`
			SourceURL string `json:"sourceUrl"`
			License   struct {
				Name string `json:"name"`
			} `json:"license"`
		} `json:"phonetics"`
	}
	if err := c.getJSON(ctx, c.dictapi+"/api/v2/entries/en/"+url.PathEscape(term), &body); err != nil {
		return nil, err
	}
	out := []Recording{}
	for _, e := range body {
		for _, ph := range e.Phonetics {
			u, err := url.Parse(ph.Audio)
			if err != nil || u.Host != "api.dictionaryapi.dev" || ph.License.Name == "" {
				continue
			}
			path := strings.TrimPrefix(u.Path, "/")
			if !dictPath.MatchString(path) {
				continue
			}
			out = append(out, Recording{ID: "dictapi:" + path, Speaker: "Wiktionary", Licence: ph.License.Name, Page: ph.SourceURL, Source: "Wiktionary"})
		}
	}
	return out, nil
}

// Audio is a recording's sound, for a Recording.ID: only Lingua Libre's
// files on Wikimedia Commons and the Free Dictionary API's, at most MaxAudio
// bytes. The caller closes it.
func (c *Client) Audio(ctx context.Context, id string) (io.ReadCloser, string, error) {
	var src string
	switch {
	case strings.HasPrefix(id, "commons:"):
		name := strings.TrimPrefix(id, "commons:")
		if !llTitle.MatchString("File:" + name) {
			return nil, "", ErrNotARecording
		}
		src = c.uploadURL(name)
	case strings.HasPrefix(id, "dictapi:"):
		path := strings.TrimPrefix(id, "dictapi:")
		if !dictPath.MatchString(path) {
			return nil, "", ErrNotARecording
		}
		src = c.dictapi + "/" + path
	default:
		return nil, "", ErrNotARecording
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, src, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", UserAgent)
	res, err := c.audioHTT.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	// The last host must be one recordings live on.
	host := res.Request.URL.Host
	if res.StatusCode != http.StatusOK || !allowedAudioHost(host, c) {
		res.Body.Close()
		return nil, "", fmt.Errorf("%w: HTTP %d from %s", ErrUnavailable, res.StatusCode, host)
	}
	if res.ContentLength > MaxAudio {
		res.Body.Close()
		return nil, "", fmt.Errorf("%w: a recording of %d bytes", ErrUnavailable, res.ContentLength)
	}
	ct := res.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "audio/") {
		ct = map[bool]string{true: "audio/wav", false: "audio/mpeg"}[strings.HasSuffix(src, ".wav")]
	}
	return limitedBody{io.LimitReader(res.Body, MaxAudio), res.Body}, ct, nil
}

type limitedBody struct {
	io.Reader
	io.Closer
}

// uploadURL is where Wikimedia Commons keeps a file: MediaWiki's path from
// the md5 of its name, spaces as underscores. Asked for directly, so no
// redirect (Special:FilePath takes more hops than the safe client follows).
func (c *Client) uploadURL(name string) string {
	name = strings.ReplaceAll(name, " ", "_")
	sum := fmt.Sprintf("%x", md5.Sum([]byte(name)))
	base := "https://upload.wikimedia.org"
	if c.commons != "https://commons.wikimedia.org" {
		base = c.commons // a test server
	}
	return fmt.Sprintf("%s/wikipedia/commons/%s/%s/%s", base, sum[:1], sum[:2], url.PathEscape(name))
}

func allowedAudioHost(host string, c *Client) bool {
	for _, base := range []string{c.commons, c.dictapi} {
		if u, err := url.Parse(base); err == nil && u.Host == host {
			return true
		}
	}
	return host == "upload.wikimedia.org"
}
