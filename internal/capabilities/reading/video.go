package reading

import (
	"html"
	"math"
	"sort"
	"strings"

	"github.com/D0bby999/anytools/internal/connectors/youtube"
)

// video.go — the tutor beside a video (learning-depth phase 4, DeepTutor's
// watching capability, findings §3).
//
// For a video the tutor is not given "the selected passage" but the words
// spoken around the moment the learner is at: the cues within ±60 seconds of
// the playhead, at most 30 of them, each at most 500 characters, as
// `[MM:SS] text` lines. The lines are HTML-escaped here and wrapped in the
// provenance envelope by Request.Prompt: a video's captions are a stranger's
// words, exactly like a web page.

// Window limits.
const (
	WindowSeconds = 60
	maxWindowCues = 30
	maxCueChars   = 500
)

// VideoWindow renders the transcript around at (seconds). An empty result
// means the transcript has nothing near that moment.
func VideoWindow(cues []youtube.Cue, at float64) string {
	var near []youtube.Cue
	for _, c := range cues {
		if c.End >= at-WindowSeconds && c.Start <= at+WindowSeconds {
			near = append(near, c)
		}
	}
	if len(near) > maxWindowCues {
		// The closest to the playhead, then back in time order.
		sort.SliceStable(near, func(i, j int) bool {
			return math.Abs(near[i].Start-at) < math.Abs(near[j].Start-at)
		})
		near = near[:maxWindowCues]
		sort.SliceStable(near, func(i, j int) bool { return near[i].Start < near[j].Start })
	}
	lines := make([]string, 0, len(near))
	for _, c := range near {
		text := c.Text
		if r := []rune(text); len(r) > maxCueChars {
			text = string(r[:maxCueChars]) + "…"
		}
		lines = append(lines, "["+youtube.FormatClock(c.Start)+"] "+html.EscapeString(text))
	}
	return strings.Join(lines, "\n")
}
