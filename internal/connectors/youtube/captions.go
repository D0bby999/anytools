package youtube

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"math"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Transcript caps (DeepTutor's, findings §3). A transcript beyond them is
// refused, not truncated: a silently shortened lecture answers questions about
// its second half with silence.
const (
	MaxCues            = 20_000
	MaxTranscriptBytes = 2 << 20
)

// Errors a caller may show a person.
var (
	ErrTranscriptTooLarge = fmt.Errorf("the transcript is longer than %d lines or %d MB", MaxCues, MaxTranscriptBytes>>20)
	ErrEmptyTranscript    = errors.New("the transcript has no text")
	ErrSubtitleFormat     = errors.New("that is not a .vtt or .srt subtitle file")
)

// Cue is one timed line. Start and End are seconds from the start of the video.
type Cue struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

// Transcript is a video's text as the knowledge base stores it.
//
// Timed is false for a transcript pasted without timestamps: it is still
// searchable and citable by page, but has no seconds to seek to.
type Transcript struct {
	Language string `json:"language,omitempty"`
	// Auto is a caption track YouTube's speech recognition wrote, not the
	// creator (youtube-fetcher-to-markdown's caption_type).
	Auto  bool  `json:"auto,omitempty"`
	Timed bool  `json:"timed"`
	Cues  []Cue `json:"cues"`
}

// ───────────────────────────────────────────── YouTube's timedtext XML

// ParseTimedText reads a caption track. Two shapes are accepted, both
// recorded (testdata/captions_*.xml): format 3 (`<p t="ms" d="ms">`, possibly
// with `<s>` word children) and the legacy `<text start="s" dur="s">`, whose
// text is entity-escaped twice.
func ParseTimedText(data []byte) ([]Cue, error) {
	if len(data) > MaxTranscriptBytes {
		return nil, ErrTranscriptTooLarge
	}
	var doc struct {
		Legacy []struct {
			Start string `xml:"start,attr"`
			Dur   string `xml:"dur,attr"`
			Text  string `xml:",chardata"`
		} `xml:"text"`
		Body struct {
			P []struct {
				T     string `xml:"t,attr"`
				D     string `xml:"d,attr"`
				Inner string `xml:",innerxml"`
			} `xml:"p"`
		} `xml:"body"`
	}
	dec := xml.NewDecoder(bytes.NewReader(data))
	dec.Strict = false
	if err := dec.Decode(&doc); err != nil {
		return nil, fmt.Errorf("youtube: caption track: %w", err)
	}

	var cues []Cue
	for _, t := range doc.Legacy {
		start, err1 := strconv.ParseFloat(t.Start, 64)
		dur, err2 := strconv.ParseFloat(t.Dur, 64)
		if err1 != nil || err2 != nil {
			continue
		}
		cues = append(cues, Cue{Start: start, End: start + dur, Text: html.UnescapeString(t.Text)})
	}
	for _, p := range doc.Body.P {
		ms, err1 := strconv.Atoi(p.T)
		d, err2 := strconv.Atoi(p.D)
		if err1 != nil || err2 != nil {
			continue
		}
		cues = append(cues, Cue{Start: float64(ms) / 1000, End: float64(ms+d) / 1000, Text: p.Inner})
	}
	return Normalize(cues)
}

// ───────────────────────────────────────────── subtitle files and paste

// vttTime matches "00:01:02.500" and "01:02.500"; SRT's comma is accepted too.
var vttTime = `(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})`
var cueTiming = regexp.MustCompile(`^\s*` + vttTime + `\s*-->\s*` + vttTime)

// ParseSubtitles reads an uploaded .vtt or .srt file. The extension proposes
// and the content decides, as parse.Detect does for documents.
func ParseSubtitles(filename string, data []byte) ([]Cue, error) {
	if len(data) > MaxTranscriptBytes {
		return nil, ErrTranscriptTooLarge
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if ext != ".vtt" && ext != ".srt" {
		return nil, ErrSubtitleFormat
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return nil, ErrSubtitleFormat
	}
	cues := parseTimedBlocks(string(data))
	if len(cues) == 0 {
		return nil, ErrSubtitleFormat
	}
	return Normalize(cues)
}

// parseTimedBlocks reads VTT and SRT alike: a timing line, then text lines
// until a blank one. Cue numbers, the WEBVTT header, NOTE and STYLE blocks
// carry no timing line and fall away.
func parseTimedBlocks(s string) []Cue {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
	var cues []Cue
	var cur *Cue
	var text []string
	flush := func() {
		if cur != nil {
			cur.Text = strings.Join(text, "\n")
			cues = append(cues, *cur)
		}
		cur, text = nil, nil
	}
	for _, line := range strings.Split(s, "\n") {
		if m := cueTiming.FindStringSubmatch(line); m != nil {
			flush()
			cur = &Cue{Start: clock(m[1:5]), End: clock(m[5:9])}
			continue
		}
		if strings.TrimSpace(line) == "" {
			flush()
			continue
		}
		if cur != nil {
			text = append(text, line)
		}
	}
	flush()
	return cues
}

func clock(m []string) float64 {
	h, _ := strconv.Atoi(m[0])
	mi, _ := strconv.Atoi(m[1])
	s, _ := strconv.Atoi(m[2])
	frac := m[3]
	for len(frac) < 3 {
		frac += "0"
	}
	ms, _ := strconv.Atoi(frac)
	return float64(h*3600+mi*60+s) + float64(ms)/1000
}

// pastedStamp is a leading timestamp on a pasted line: "12:34 text",
// "[1:02:03] text", "(00:05) text".
var pastedStamp = regexp.MustCompile(`^\s*[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d{1,3})?[\])]?\s*[-–—:]?\s*(.*)$`)

// ParsePasted reads a transcript a learner pasted: a VTT or SRT body, lines
// that start with a timestamp, or plain text with no times at all.
func ParsePasted(text string) (*Transcript, error) {
	if len(text) > MaxTranscriptBytes {
		return nil, ErrTranscriptTooLarge
	}
	if !utf8.ValidString(text) {
		return nil, ErrEmptyTranscript
	}
	if cues := parseTimedBlocks(text); len(cues) > 0 {
		cues, err := Normalize(cues)
		if err != nil {
			return nil, err
		}
		return &Transcript{Timed: true, Cues: cues}, nil
	}

	var timed []Cue
	stamped, lines := 0, 0
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r", ""), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		lines++
		if m := pastedStamp.FindStringSubmatch(line); m != nil {
			if sec, ok := ParseClock(m[1]); ok {
				stamped++
				timed = append(timed, Cue{Start: sec, End: -1, Text: m[2]})
				continue
			}
		}
		// A line without a stamp continues the previous one.
		if n := len(timed); n > 0 {
			timed[n-1].Text += " " + line
		}
	}
	// Mostly stamped: a timed transcript. Otherwise the stamps were
	// incidental ("the meeting at 10:30") and the paste is plain text.
	if stamped > 0 && stamped*2 >= lines {
		cues, err := Normalize(timed)
		if err != nil {
			return nil, err
		}
		return &Transcript{Timed: true, Cues: cues}, nil
	}

	body := cleanText(text)
	if body == "" {
		return nil, ErrEmptyTranscript
	}
	var cues []Cue
	for _, s := range splitSentences(body) {
		cues = append(cues, Cue{Text: s})
	}
	if len(cues) > MaxCues {
		return nil, ErrTranscriptTooLarge
	}
	return &Transcript{Timed: false, Cues: cues}, nil
}

// ParseClock reads "MM:SS" or "H:MM:SS" (the form Gemini's documentation uses
// for video timestamps).
func ParseClock(s string) (float64, bool) {
	parts := strings.Split(strings.TrimSpace(s), ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0, false
	}
	total := 0
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 || (i > 0 && n > 59) {
			return 0, false
		}
		total = total*60 + n
	}
	return float64(total), true
}

// ───────────────────────────────────────────── normalisation

// maxOpenCue bounds a cue that arrived without an end.
const maxOpenCue = 30

var tagPattern = regexp.MustCompile(`<[^>]{0,200}>`)

// cleanText turns caption markup into plain text: tags (`<c>`, `<i>`,
// `<font>`, format 3's `<s>`) removed, entities decoded until stable (the
// legacy format escapes twice: `&amp;#39;`), whitespace collapsed.
func cleanText(s string) string {
	s = tagPattern.ReplaceAllString(s, " ")
	for i := 0; i < 3; i++ {
		u := html.UnescapeString(s)
		if u == s {
			break
		}
		s = u
	}
	return strings.Join(strings.Fields(s), " ")
}

// Normalize is the one repair every source goes through (captions, uploads,
// pastes, Gemini): text cleaned, cues without text or with impossible times
// dropped, order restored, a missing or backwards end repaired, an end that
// overruns the next cue clamped, a line repeated by rolling captions merged,
// and the caps enforced.
func Normalize(in []Cue) ([]Cue, error) {
	cues := make([]Cue, 0, len(in))
	size := 0
	for _, c := range in {
		c.Text = cleanText(c.Text)
		if c.Text == "" || math.IsNaN(c.Start) || math.IsInf(c.Start, 0) || c.Start < 0 || c.Start > 24*3600 {
			continue
		}
		size += len(c.Text)
		cues = append(cues, c)
	}
	if len(cues) > MaxCues || size > MaxTranscriptBytes {
		return nil, ErrTranscriptTooLarge
	}
	if len(cues) == 0 {
		return nil, ErrEmptyTranscript
	}
	sort.SliceStable(cues, func(i, j int) bool { return cues[i].Start < cues[j].Start })

	out := cues[:0]
	prevRawEnd := math.Inf(-1)
	for i, c := range cues {
		next := math.Inf(1)
		if i+1 < len(cues) {
			next = cues[i+1].Start
		}
		// A rolling caption repeats the line it OVERLAPS in the source's own
		// times; the same words said again later are a second line. A cue with
		// no end of its own (a paste, Gemini) never merges.
		rawEnd := c.End
		if n := len(out); n > 0 && out[n-1].Text == c.Text && c.Start < prevRawEnd {
			if rawEnd > out[n-1].End && rawEnd <= next {
				out[n-1].End = rawEnd
			}
			prevRawEnd = math.Max(prevRawEnd, rawEnd)
			continue
		}
		prevRawEnd = rawEnd
		if c.End <= c.Start || math.IsNaN(c.End) || math.IsInf(c.End, 0) {
			// No usable end (a paste or Gemini gives starts only): run to
			// the next cue, at most half a minute.
			c.End = math.Min(next, c.Start+maxOpenCue)
		}
		if c.End > next && next > c.Start {
			c.End = next
		}
		out = append(out, c)
	}
	return out, nil
}

var sentenceEnd = regexp.MustCompile(`[.!?…。！？](["')\]]*)\s+`)

func splitSentences(s string) []string {
	var out []string
	last := 0
	for _, m := range sentenceEnd.FindAllStringIndex(s, -1) {
		out = append(out, strings.TrimSpace(s[last:m[1]]))
		last = m[1]
	}
	if rest := strings.TrimSpace(s[last:]); rest != "" {
		out = append(out, rest)
	}
	return out
}
