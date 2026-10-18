package youtube

import (
	"fmt"
	"strings"
)

// Segmentation rules, DeepTutor's (video_learning/service.py:229-253).
//
// A segment is the unit a transcript is indexed and cited by: one
// `<!-- page: N -->` block, so the chunker, retrieval and citations work
// unchanged, and documents.timeline maps page N to its seconds.
const (
	// MinSegment is the length after which a sentence end closes a segment.
	MinSegment = 20.0
	// MaxSegment is the hard ceiling: a segment never runs longer.
	MaxSegment = 90.0
	// MaxGap is the silence that starts a new segment regardless of length.
	MaxGap = 4.0
	// untimedChars is how much of an untimed transcript makes one page.
	untimedChars = 1500
)

// Segment is a run of cues.
type Segment struct {
	Start float64
	End   float64
	Text  string
}

// Segments merges a timed transcript's cues into 20–90 s segments, splitting
// on a gap longer than 4 s or at a sentence end after 20 s.
func Segments(cues []Cue) []Segment {
	var out []Segment
	var cur *Segment
	var text []string
	closeCur := func() {
		if cur != nil {
			cur.Text = strings.Join(text, " ")
			out = append(out, *cur)
		}
		cur, text = nil, nil
	}
	for _, c := range cues {
		if cur != nil && (c.Start-cur.End > MaxGap || c.End-cur.Start > MaxSegment) {
			closeCur()
		}
		if cur == nil {
			cur = &Segment{Start: c.Start, End: c.End}
		}
		text = append(text, c.Text)
		if c.End > cur.End {
			cur.End = c.End
		}
		if cur.End-cur.Start >= MaxSegment ||
			(cur.End-cur.Start >= MinSegment && endsSentence(c.Text)) {
			closeCur()
		}
	}
	closeCur()
	return out
}

// untimedSegments pages an untimed transcript by length, at sentence ends.
func untimedSegments(cues []Cue) []Segment {
	var out []Segment
	var b strings.Builder
	for _, c := range cues {
		if b.Len() > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(c.Text)
		if b.Len() >= untimedChars {
			out = append(out, Segment{Text: b.String()})
			b.Reset()
		}
	}
	if b.Len() > 0 {
		out = append(out, Segment{Text: b.String()})
	}
	return out
}

func endsSentence(s string) bool {
	s = strings.TrimRight(s, `"')]} `)
	return strings.HasSuffix(s, ".") || strings.HasSuffix(s, "!") || strings.HasSuffix(s, "?") ||
		strings.HasSuffix(s, "…") || strings.HasSuffix(s, "。") || strings.HasSuffix(s, "？") || strings.HasSuffix(s, "！")
}

// Indexed is a transcript ready for the knowledge pipeline.
type Indexed struct {
	// Markdown has one `<!-- page: N -->` block per segment, each line
	// starting with its `[MM:SS]` time when the transcript is timed.
	Markdown string
	// Timeline[N-1] is page N's [start, end] in whole seconds; nil when the
	// transcript has no times.
	Timeline [][2]int
	Pages    int
}

// Index segments a transcript and renders it.
//
// The cue text is a stranger's (a video's captions, a model's hearing of it,
// or a paste), so anything that could be read as a page marker or as markup
// is neutralised here, once, before the chunker or the viewer sees it.
func Index(t *Transcript) (*Indexed, error) {
	if t == nil || len(t.Cues) == 0 {
		return nil, ErrEmptyTranscript
	}
	var segs []Segment
	if t.Timed {
		segs = Segments(t.Cues)
	} else {
		segs = untimedSegments(t.Cues)
	}
	var b strings.Builder
	var timeline [][2]int
	for i, s := range segs {
		fmt.Fprintf(&b, "<!-- page: %d -->\n", i+1)
		if t.Timed {
			fmt.Fprintf(&b, "[%s] ", FormatClock(s.Start))
			end := int(s.End + 0.999)
			if end <= int(s.Start) {
				end = int(s.Start) + 1
			}
			timeline = append(timeline, [2]int{int(s.Start), end})
		}
		b.WriteString(escapeText(s.Text))
		b.WriteString("\n\n")
	}
	return &Indexed{Markdown: b.String(), Timeline: timeline, Pages: len(segs)}, nil
}

// escapeText neutralises markup in transcript text: `<` and `>` become
// entities, so `<!-- page: 9 -->` spoken or pasted into a transcript is text,
// never a page boundary, and no tag reaches a renderer.
func escapeText(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}

// FormatClock renders seconds as MM:SS, or H:MM:SS from an hour on.
func FormatClock(sec float64) string {
	n := int(sec)
	if n < 0 {
		n = 0
	}
	h, m, s := n/3600, (n%3600)/60, n%60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%02d:%02d", m, s)
}
