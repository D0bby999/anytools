package youtube

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/security"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestParseURLAcceptsEveryFormAndRequiresElevenCharacters(t *testing.T) {
	ok := map[string]string{
		"https://www.youtube.com/watch?v=jNQXAC9IVRw":              "jNQXAC9IVRw",
		"https://youtube.com/watch?v=jNQXAC9IVRw&t=12s&list=PL1":   "jNQXAC9IVRw",
		"http://m.youtube.com/watch?feature=share&v=jNQXAC9IVRw":   "jNQXAC9IVRw",
		"https://youtu.be/jNQXAC9IVRw":                             "jNQXAC9IVRw",
		"https://youtu.be/jNQXAC9IVRw?si=abc":                      "jNQXAC9IVRw",
		"https://www.youtube.com/shorts/a_b-C1d2E3f":               "a_b-C1d2E3f",
		"https://www.youtube.com/live/jNQXAC9IVRw?feature=share":   "jNQXAC9IVRw",
		"https://www.youtube.com/embed/jNQXAC9IVRw?start=10":       "jNQXAC9IVRw",
		"https://www.youtube-nocookie.com/embed/jNQXAC9IVRw":       "jNQXAC9IVRw",
		"  https://www.youtube.com/watch?v=jNQXAC9IVRw  ":          "jNQXAC9IVRw",
		"https://WWW.YOUTUBE.COM/watch?v=jNQXAC9IVRw":              "jNQXAC9IVRw",
		"https://music.youtube.com/watch?v=jNQXAC9IVRw&feature=sh": "jNQXAC9IVRw",
	}
	for raw, want := range ok {
		if got, found := ParseURL(raw); !found || got != want {
			t.Errorf("%s: got %q %v, want %q", raw, got, found, want)
		}
	}
	for _, raw := range []string{
		"https://www.youtube.com/watch?v=jNQXAC9IVR",   // 10 characters
		"https://www.youtube.com/watch?v=jNQXAC9IVRwx", // 12
		"https://www.youtube.com/watch?v=jNQXAC9IV!w",
		"https://youtu.be/",
		"https://www.youtube.com/channel/UC123456789",
		"https://www.youtube.com/@jawed",
		"https://evil.test/watch?v=jNQXAC9IVRw",
		"https://youtube.com.evil.test/watch?v=jNQXAC9IVRw",
		"javascript:alert(1)//youtu.be/jNQXAC9IVRw",
		"ftp://youtu.be/jNQXAC9IVRw",
		"https://user:pw@www.youtube.com/watch?v=jNQXAC9IVRw",
		"https://www.youtube.com:8443/watch?v=jNQXAC9IVRw",
	} {
		if id, found := ParseURL(raw); found {
			t.Errorf("%s: accepted as %q", raw, id)
		}
	}
	if !IsYouTubeHost("https://www.youtube.com/@jawed") || IsYouTubeHost("https://example.org/") {
		t.Error("IsYouTubeHost")
	}
}

// fixtureYouTube serves the recorded responses the way www.youtube.com did.
func fixtureYouTube(t *testing.T, player, captions string) (*Client, *[]string) {
	t.Helper()
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch {
		case r.URL.Path == "/watch":
			page := "watch_page.html"
			if player == "" {
				page = "watch_page_consent.html"
			}
			_, _ = w.Write(fixture(t, page))
		case r.URL.Path == "/youtubei/v1/player":
			body, _ := io.ReadAll(r.Body)
			var req struct {
				Context struct {
					Client map[string]string `json:"client"`
				} `json:"context"`
				VideoID string `json:"videoId"`
			}
			if err := json.Unmarshal(body, &req); err != nil || req.Context.Client["clientName"] != "ANDROID" ||
				req.VideoID != "jNQXAC9IVRw" || r.URL.Query().Get("key") != "RECORDED-web-key-redacted" {
				t.Errorf("player request: key=%q body=%s", r.URL.Query().Get("key"), body)
			}
			_, _ = w.Write(fixture(t, player))
		case r.URL.Path == "/api/timedtext":
			if r.URL.Query().Get("fmt") != "" || r.URL.Query().Get("lang") == "" {
				t.Errorf("caption query: %s", r.URL.RawQuery)
			}
			_, _ = w.Write(fixture(t, captions))
		case r.URL.Path == "/oembed":
			_, _ = w.Write(fixture(t, "oembed.json"))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	host := strings.TrimPrefix(srv.URL, "http://")
	return &Client{HTTP: security.AllowlistClientOver(srv.Client(), host), Base: srv.URL}, &paths
}

func TestFetchTranscriptFromRecordedInnertube(t *testing.T) {
	for _, captions := range []string{"captions_legacy.xml", "captions_srv3.xml"} {
		c, _ := fixtureYouTube(t, "player_ok.json", captions)
		got, err := c.FetchTranscript(context.Background(), "jNQXAC9IVRw", "")
		if err != nil {
			t.Fatalf("%s: %v", captions, err)
		}
		if got.Video.Title != "Me at the zoo" || got.Video.Channel != "jawed" || got.Video.DurationSeconds != 19 {
			t.Fatalf("video = %+v", got.Video)
		}
		// The description is kept; it has no timestamps, so no chapters.
		if !strings.HasPrefix(got.Video.Description, "The first video on YouTube.") || got.Video.Chapters != nil {
			t.Fatalf("description %q, chapters %+v", got.Video.Description, got.Video.Chapters)
		}
		if len(got.Video.Tracks) != 2 || got.Transcript.Language != "en" || !got.Transcript.Timed {
			t.Fatalf("tracks = %+v, transcript lang %q", got.Video.Tracks, got.Transcript.Language)
		}
		cues := got.Transcript.Cues
		if len(cues) != 6 || cues[0].Start != 1.2 || cues[0].Text != "All right, so here we are, in front of the elephants" {
			t.Fatalf("%s: cues = %+v", captions, cues)
		}
		// Double-escaped in the legacy format, single in srv3: both decode.
		if cues[3].Text != "and that's cool" {
			t.Fatalf("%s: entity not decoded: %q", captions, cues[3].Text)
		}
	}

	c, _ := fixtureYouTube(t, "player_ok.json", "captions_legacy.xml")
	meta, err := c.OEmbed(context.Background(), "jNQXAC9IVRw")
	if err != nil || meta.Title != "Me at the zoo" || meta.Channel != "jawed" {
		t.Fatalf("oembed = %+v %v", meta, err)
	}
}

func TestGatedAndBlockedFetchesReportAReason(t *testing.T) {
	cases := []struct {
		player string
		want   string
	}{
		{"player_xpe.json", ReasonGated},
		{"player_login_required.json", ReasonUnplayable},
		{"", ReasonBlocked}, // consent wall: no web key on the page
	}
	for _, tc := range cases {
		c, paths := fixtureYouTube(t, tc.player, "captions_legacy.xml")
		_, err := c.FetchTranscript(context.Background(), "jNQXAC9IVRw", "")
		var fe *FetchError
		if !errors.As(err, &fe) || fe.Reason != tc.want {
			t.Errorf("%q: err = %v, want reason %s", tc.player, err, tc.want)
		}
		for _, p := range *paths {
			if strings.Contains(p, "timedtext") {
				t.Errorf("%q: a gated track was requested anyway", tc.player)
			}
		}
	}
}

func TestPickTrackPrefersTheRequestedThenVietnameseThenEnglish(t *testing.T) {
	tracks := []Track{{Lang: "de"}, {Lang: "en", Auto: true}, {Lang: "en"}, {Lang: "vi-VN", Auto: true}}
	for want, lang := range map[string]string{"": "vi-VN", "de": "de", "fr": "vi-VN"} {
		if got, _ := PickTrack(tracks, want); got.Lang != lang {
			t.Errorf("want %q: picked %q, expected %q", want, got.Lang, lang)
		}
	}
	if got, _ := PickTrack(tracks[:3], ""); got.Lang != "en" || got.Auto {
		t.Errorf("a human English track should beat the speech-recognised one: %+v", got)
	}
	if got, _ := PickTrack([]Track{{Lang: "ja"}}, ""); got.Lang != "ja" {
		t.Errorf("first track fallback: %+v", got)
	}
}

func TestSubtitleFilesParseEntitiesTagsAndOverlaps(t *testing.T) {
	vtt := "WEBVTT\n\nNOTE a comment\n\n1\n00:00:01.000 --> 00:00:04.000 align:start\n<v Speaker>Tom &amp; Jerry</v> say <i>hi</i>\n\n" +
		"00:00:03.000 --> 00:00:06.500\nsecond line overlaps\n\n" +
		"00:00:03.000 --> 00:00:06.500\nsecond line overlaps\n\n" +
		"01:00:00.000 --> 01:00:02.000\nan hour in\n"
	cues, err := ParseSubtitles("talk.vtt", []byte(vtt))
	if err != nil {
		t.Fatal(err)
	}
	if len(cues) != 3 || cues[0].Text != "Tom & Jerry say hi" {
		t.Fatalf("cues = %+v", cues)
	}
	if cues[0].End != 3 {
		t.Fatalf("an overlapping cue's end must be clamped to the next start: %+v", cues[0])
	}
	if cues[2].Start != 3600 {
		t.Fatalf("hours: %+v", cues[2])
	}

	srt := "1\r\n00:00:02,500 --> 00:00:05,000\r\nXin chào &lt;các bạn&gt;\r\n\r\n2\r\n00:00:06,000 --> 00:00:08,000\r\ndòng hai\r\n"
	cues, err = ParseSubtitles("bai.SRT", []byte(srt))
	if err != nil || len(cues) != 2 || cues[0].Start != 2.5 || cues[0].Text != "Xin chào <các bạn>" {
		t.Fatalf("srt: %+v %v", cues, err)
	}

	for name, data := range map[string]string{
		"notes.txt": vtt, "empty.vtt": "WEBVTT\n\n", "bin.srt": "1\n\x00\x01",
	} {
		if _, err := ParseSubtitles(name, []byte(data)); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestPastedTranscriptWithAndWithoutTimes(t *testing.T) {
	timed, err := ParsePasted("[00:00] Hello there.\n0:07 - second line\ncontinued here\n1:02:03 an hour later")
	if err != nil || !timed.Timed || len(timed.Cues) != 3 {
		t.Fatalf("timed: %+v %v", timed, err)
	}
	if timed.Cues[1].Text != "second line continued here" || timed.Cues[2].Start != 3723 {
		t.Fatalf("timed cues: %+v", timed.Cues)
	}
	plain, err := ParsePasted("We met at 10:30 to talk. Then we left! Nothing else happened")
	if err != nil || plain.Timed || len(plain.Cues) != 3 {
		t.Fatalf("plain: %+v %v", plain, err)
	}
	if _, err := ParsePasted("   \n  "); !errors.Is(err, ErrEmptyTranscript) {
		t.Fatalf("empty paste: %v", err)
	}
}

func TestTranscriptCapsAreEnforced(t *testing.T) {
	cues := make([]Cue, MaxCues+1)
	for i := range cues {
		cues[i] = Cue{Start: float64(i), Text: "x" + string(rune('a'+i%26))}
	}
	if _, err := Normalize(cues); !errors.Is(err, ErrTranscriptTooLarge) {
		t.Fatalf("20,001 cues: %v", err)
	}
	if _, err := Normalize([]Cue{{Start: 0, Text: strings.Repeat("y", MaxTranscriptBytes+1)}}); !errors.Is(err, ErrTranscriptTooLarge) {
		t.Fatalf("over 2 MB: %v", err)
	}
	if _, err := ParseSubtitles("big.vtt", make([]byte, MaxTranscriptBytes+1)); !errors.Is(err, ErrTranscriptTooLarge) {
		t.Fatalf("big file: %v", err)
	}
}

func TestSegmentationBoundaries(t *testing.T) {
	// Sentence end before 20 s does not close; after 20 s it does.
	segs := Segments([]Cue{
		{Start: 0, End: 5, Text: "First."},
		{Start: 5, End: 18, Text: "Still short."},
		{Start: 18, End: 22, Text: "Now long enough."},
		{Start: 22, End: 30, Text: "next"},
	})
	if len(segs) != 2 || segs[0].End != 22 || segs[1].Start != 22 {
		t.Fatalf("sentence rule: %+v", segs)
	}

	// A gap over 4 s splits, even when short.
	segs = Segments([]Cue{{Start: 0, End: 3, Text: "a"}, {Start: 7.5, End: 9, Text: "b"}})
	if len(segs) != 2 {
		t.Fatalf("gap rule: %+v", segs)
	}
	segs = Segments([]Cue{{Start: 0, End: 3, Text: "a"}, {Start: 6.9, End: 9, Text: "b"}})
	if len(segs) != 1 {
		t.Fatalf("a 3.9 s gap must not split: %+v", segs)
	}

	// No punctuation at all: nothing runs past 90 s.
	var run []Cue
	for s := 0.0; s < 400; s += 2 {
		run = append(run, Cue{Start: s, End: s + 2, Text: "words"})
	}
	for _, s := range Segments(run) {
		if s.End-s.Start > MaxSegment {
			t.Fatalf("segment of %.0f s: %+v", s.End-s.Start, s)
		}
	}
}

func TestIndexWritesPagesAndATimelineAndNeutralisesMarkers(t *testing.T) {
	ix, err := Index(&Transcript{Timed: true, Cues: []Cue{
		{Start: 1.2, End: 10, Text: "Hello <!-- page: 99 --> <script>x</script>."},
		{Start: 30, End: 75.5, Text: "Second part."},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if ix.Pages != 2 || !reflect.DeepEqual(ix.Timeline, [][2]int{{1, 10}, {30, 76}}) {
		t.Fatalf("pages %d timeline %v", ix.Pages, ix.Timeline)
	}
	if strings.Count(ix.Markdown, "<!-- page:") != 2 || strings.Contains(ix.Markdown, "<script>") {
		t.Fatalf("markdown not neutralised:\n%s", ix.Markdown)
	}
	if !strings.Contains(ix.Markdown, "<!-- page: 2 -->\n[00:30] Second part.") {
		t.Fatalf("markdown:\n%s", ix.Markdown)
	}
	if FormatClock(3723) != "1:02:03" || FormatClock(754) != "12:34" {
		t.Fatal("FormatClock")
	}

	untimed, _ := Index(&Transcript{Cues: []Cue{{Text: "one."}, {Text: "two."}}})
	if untimed.Timeline != nil || untimed.Pages != 1 {
		t.Fatalf("untimed: %+v", untimed)
	}
}

func TestGeminiRequestMatchesTheRecordedShape(t *testing.T) {
	var want map[string]any
	if err := json.Unmarshal(fixture(t, "gemini_request.json"), &want); err != nil {
		t.Fatal(err)
	}
	delete(want, "_note")
	w := Window{Start: 1200, End: 2400}
	parts := want["contents"].([]any)[0].(map[string]any)["parts"].([]any)
	parts[1].(map[string]any)["text"] = Prompt(w)

	var got map[string]any
	raw, _ := json.Marshal(RequestBody("jNQXAC9IVRw", w))
	_ = json.Unmarshal(raw, &got)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("request body differs from the recorded shape:\n got %s", raw)
	}
	for _, s := range []string{"verbatim", `"start": "MM:SS"`, "H:MM:SS", "language it is spoken in"} {
		if !strings.Contains(Prompt(w), s) {
			t.Errorf("prompt lacks %q", s)
		}
	}
	// A whole-video call carries no clipping.
	whole, _ := json.Marshal(RequestBody("jNQXAC9IVRw", Window{}))
	if strings.Contains(string(whole), "video_metadata") {
		t.Fatalf("whole video must not be clipped: %s", whole)
	}
}

func TestGeminiTranscribeAgainstARecordedUpstream(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	var gotPath, gotKey string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotKey = r.URL.Path, r.Header.Get("x-goog-api-key")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		if strings.Contains(string(raw), "PRIVATEVIDE") {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"code":400,"message":"video not public"}}`))
			return
		}
		_, _ = w.Write(fixture(t, "gemini_response.json"))
	}))
	defer srv.Close()

	g := NewGemini("AIza-test-key", srv.URL, "gemini-3.6-flash")
	part, err := g.TranscribeWindow(context.Background(), "jNQXAC9IVRw", Window{})
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v1beta/models/gemini-3.6-flash:generateContent" || gotKey != "AIza-test-key" {
		t.Fatalf("path %q key %q", gotPath, gotKey)
	}
	fileURI := gotBody["contents"].([]any)[0].(map[string]any)["parts"].([]any)[0].(map[string]any)["file_data"].(map[string]any)["file_uri"]
	if fileURI != "https://www.youtube.com/watch?v=jNQXAC9IVRw" ||
		gotBody["generationConfig"].(map[string]any)["mediaResolution"] != "MEDIA_RESOLUTION_LOW" {
		t.Fatalf("body = %v", gotBody)
	}
	if part.Language != "en" || len(part.Cues) != 5 || part.Cues[4].Start != 16 || part.InputTokens != 1987 || part.Model != "gemini-3.6-flash" {
		t.Fatalf("part = %+v", part)
	}

	// Only an id reaches the wire: no URL the caller names.
	if _, err := g.TranscribeWindow(context.Background(), "https://evil.test/x", Window{}); err == nil {
		t.Fatal("a non-id was accepted")
	}
	// A refused video is a providers.HTTPError the job can classify as 4xx.
	_, err = g.TranscribeWindow(context.Background(), "PRIVATEVIDE", Window{})
	// (The id above is 11 characters, so the request is made; the fixture
	// server refuses on the id in the body.)
	var he *providers.HTTPError
	if !errors.As(err, &he) || he.Status != 400 {
		t.Fatalf("refused video: %v", err)
	}
}

func TestGeminiResponsesAreRepairedOrRefused(t *testing.T) {
	part, err := ParseGeminiResponse(fixture(t, "gemini_response_messy.json"), Window{Start: 1200, End: 2400})
	if err != nil {
		t.Fatal(err)
	}
	// Fenced JSON read; "soon" and "-1:00" dropped; the clip-relative times
	// shifted into the video's time; order restored; markup cleaned.
	var starts []float64
	for _, c := range part.Cues {
		starts = append(starts, c.Start)
	}
	if !reflect.DeepEqual(starts, []float64{1205, 1330, 1400}) || part.Cues[0].Text != "câu thứ nhất & đậm" || part.Language != "vi" {
		t.Fatalf("cues = %+v", part.Cues)
	}

	// Absolute times outside the window are dropped.
	outside := `{"candidates":[{"content":{"parts":[{"text":"{\"cues\":[{\"start\":\"20:10\",\"text\":\"in\"},{\"start\":\"50:00\",\"text\":\"out\"}]}"}]}}]}`
	part, err = ParseGeminiResponse([]byte(outside), Window{Start: 1200, End: 2400})
	if err != nil || len(part.Cues) != 1 || part.Cues[0].Text != "in" {
		t.Fatalf("outside: %+v %v", part, err)
	}

	for name, raw := range map[string]string{
		"no candidate": `{"candidates":[]}`,
		"not json":     `{"candidates":[{"content":{"parts":[{"text":"Here is a summary of the video."}]}}]}`,
		"no cues":      `{"candidates":[{"content":{"parts":[{"text":"{\"cues\":[]}"}]}}]}`,
		"no times":     `{"candidates":[{"content":{"parts":[{"text":"{\"cues\":[{\"start\":\"later\",\"text\":\"x\"}]}"}]}}]}`,
	} {
		if _, err := ParseGeminiResponse([]byte(raw), Window{}); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}

	// More than 20,000 cues is refused outright.
	var b strings.Builder
	b.WriteString(`{"cues":[`)
	for i := 0; i <= MaxCues; i++ {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`{"start":1,"text":"w"}`)
	}
	b.WriteString(`]}`)
	resp, _ := json.Marshal(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]any{"text": b.String()}}}}}})
	if _, err := ParseGeminiResponse(resp, Window{}); !errors.Is(err, ErrTranscriptTooLarge) {
		t.Fatalf("20,001 cues: %v", err)
	}
}

func TestWindowsPlanLongVideos(t *testing.T) {
	for dur, n := range map[int]int{0: 1, 600: 1, 3600: 1, 3601: 4, 7200: 6} {
		w, err := Windows(dur)
		if err != nil || len(w) != n {
			t.Errorf("%d s: %d windows %v, want %d", dur, len(w), err, n)
		}
	}
	w, _ := Windows(4000)
	if w[3] != (Window{Start: 3600, End: 4000}) {
		t.Errorf("last window = %+v", w[3])
	}
	if _, err := Windows(MaxTranscribeSeconds + 1); !errors.Is(err, ErrTooLong) {
		t.Error("over the cap")
	}
}

// Only an adjacent repeat is merged: the same sentence said again later is
// its own cue, or a long talk collapses into one cue minutes long.
func TestRepeatedLinesMergeOnlyWhenAdjacent(t *testing.T) {
	cues, err := Normalize([]Cue{
		{Start: 0, End: 3, Text: "same words"},
		{Start: 2.5, End: 5, Text: "same words"},
		{Start: 60, End: 63, Text: "same words"},
	})
	if err != nil || len(cues) != 2 || cues[0].End != 5 || cues[1].Start != 60 {
		t.Fatalf("cues = %+v %v", cues, err)
	}
}

func TestChaptersFollowYouTubesRules(t *testing.T) {
	desc := "Course notes: https://example.com\n\n0:00 Intro\n[1:30] - Supply and demand\n5:05 | Elasticity &amp; prices\nMarkets in practice - 12:00\n\nThanks for watching"
	got := ParseChapters(desc, 20*60)
	want := []Chapter{
		{Start: 0, End: 90, Title: "Intro"},
		{Start: 90, End: 305, Title: "Supply and demand"},
		{Start: 305, End: 720, Title: "Elasticity & prices"},
		{Start: 720, End: 1200, Title: "Markets in practice"},
	}
	if len(got) != len(want) {
		t.Fatalf("chapters = %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("chapter %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	if long := ParseChapters("0:00 a\n1:00 b\n1:02:03 c", 0); len(long) != 3 || long[2].Start != 3723 || long[2].End != 0 {
		t.Errorf("hour stamps / unknown duration: %+v", long)
	}

	for name, desc := range map[string]string{
		"first not at 0:00":  "0:05 a\n1:00 b\n2:00 c",
		"fewer than three":   "0:00 a\n1:00 b",
		"out of order":       "0:00 a\n2:00 b\n1:00 c",
		"shorter than 10 s":  "0:00 a\n0:05 b\n2:00 c",
		"last runs past end": "0:00 a\n1:00 b\n9:55 c",
		"no titles":          "0:00\n1:00\n2:00",
	} {
		if got := ParseChapters(desc, 600); got != nil {
			t.Errorf("%s: %+v, want none", name, got)
		}
	}
}

func TestDescriptionIsBoundedAndStripped(t *testing.T) {
	got := CleanDescription("a\x00b\x1b[31m\nline two " + strings.Repeat("x", MaxDescription))
	if strings.ContainsAny(got, "\x00\x1b") || !strings.HasPrefix(got, "ab[31m\nline two") {
		t.Fatalf("control characters kept: %q", got[:20])
	}
	if n := len([]rune(got)); n != MaxDescription+1 {
		t.Fatalf("length %d, want %d (with the ellipsis)", n, MaxDescription+1)
	}
}
