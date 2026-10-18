package youtube

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Chapters are the creator's own sections of a video, read from its
// description the way YouTube itself reads them: timestamped lines, the first
// at 0:00, at least three, in order, each at least ten seconds long. A
// description that breaks any rule has no chapters, as on YouTube.
//
// The idea is youtube-fetcher-to-markdown's (it takes yt-dlp's chapters); the
// rules are YouTube's published ones, so no extra request or dependency is
// needed: the player response already carries the description.

// Chapter is one creator-defined section. End is the next chapter's start, or
// the video's end.
type Chapter struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Title string  `json:"title"`
}

const (
	minChapters      = 3
	minChapterSecs   = 10
	maxChapters      = 100
	maxChapterTitle  = 120
	MaxDescription   = 5000
	chapterStampExpr = `(?:\d{1,2}:)?\d{1,2}:\d{2}`
)

// chapterLine is a line that starts with a timestamp ("0:00 Intro",
// "[01:02:03] - Part two") or ends with one ("Intro - 0:00").
var (
	chapterLead  = regexp.MustCompile(`^[\s\[\(]*(` + chapterStampExpr + `)[\]\)]?\s*[-–—:|.]?\s*(.*)$`)
	chapterTrail = regexp.MustCompile(`^(.*?)\s*[-–—:|]?\s*[\[\(]?(` + chapterStampExpr + `)[\]\)]?\s*$`)
)

// ParseChapters reads chapters from a description. duration is the video's
// length in seconds, 0 when unknown.
func ParseChapters(description string, duration int) []Chapter {
	var out []Chapter
	for _, line := range strings.Split(description, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		stamp, title := "", ""
		if m := chapterLead.FindStringSubmatch(line); m != nil {
			stamp, title = m[1], m[2]
		} else if m := chapterTrail.FindStringSubmatch(line); m != nil && m[1] != "" {
			stamp, title = m[2], m[1]
		} else {
			continue
		}
		at, ok := ParseClock(stamp)
		if !ok {
			continue
		}
		title = chapterTitle(title)
		if title == "" {
			continue
		}
		out = append(out, Chapter{Start: at, Title: title})
		if len(out) > maxChapters {
			return nil
		}
	}
	if len(out) < minChapters || out[0].Start != 0 {
		return nil
	}
	for i := 1; i < len(out); i++ {
		if out[i].Start-out[i-1].Start < minChapterSecs {
			return nil
		}
	}
	end := float64(duration)
	if duration > 0 && end-out[len(out)-1].Start < minChapterSecs {
		return nil
	}
	for i := range out {
		if i+1 < len(out) {
			out[i].End = out[i+1].Start
		} else {
			out[i].End = end
		}
	}
	return out
}

// chapterTitle cleans a title: markup and control characters removed,
// separators trimmed, length bounded. The title is a stranger's text and is
// only ever rendered as text.
func chapterTitle(s string) string {
	s = cleanText(s)
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	s = strings.TrimFunc(s, func(r rune) bool {
		return unicode.IsSpace(r) || strings.ContainsRune("-–—:|.•·", r)
	})
	return truncateRunes(s, maxChapterTitle)
}

// CleanDescription bounds a description kept for display: control characters
// other than newlines removed, at most MaxDescription characters.
func CleanDescription(s string) string {
	s = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	return strings.TrimSpace(truncateRunes(s, MaxDescription))
}

func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return strings.TrimSpace(string([]rune(s)[:n])) + "…"
}
