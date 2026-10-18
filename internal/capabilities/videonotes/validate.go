package videonotes

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/D0bby999/anytools/internal/connectors/youtube"
)

// ErrInvalid is model output with nothing usable in it.
var ErrInvalid = errors.New("videonotes: your model's notes could not be read")

// Bounds on what is kept. A model that writes more is cut, not refused.
const (
	maxSections = 60
	maxPoints   = 6
	maxTitle    = 120
	maxSummary  = 1200
	maxPoint    = 400
	// slack is how far outside its section a point's time may fall and still
	// be kept: segment boundaries and a model's rounding are a second or two.
	slack = 2.0
)

// rawNotes is the model's answer as written: times may be "MM:SS" strings
// or numbers of seconds.
type rawNotes struct {
	Sections []struct {
		Start   json.RawMessage `json:"start"`
		Title   string          `json:"title"`
		Summary string          `json:"summary"`
		Points  []struct {
			Text string          `json:"text"`
			At   json.RawMessage `json:"at"`
		} `json:"points"`
	} `json:"sections"`
}

// Validate decides what of the model's notes is kept. end is the last second
// of the transcript. When chapters are given and the model wrote one section
// per chapter, the chapters' own starts and titles win; otherwise the
// model's sections stand on their own (fromChapters false).
func Validate(raw rawNotes, end float64, chapters []youtube.Chapter) (sections []Section, fromChapters bool, err error) {
	for _, rs := range raw.Sections {
		start, ok := seconds(rs.Start)
		if !ok || start < 0 || start > end+slack {
			continue
		}
		sec := Section{Start: start, Title: clean(rs.Title, maxTitle), Summary: clean(rs.Summary, maxSummary)}
		for _, rp := range rs.Points {
			text := clean(rp.Text, maxPoint)
			if text == "" {
				continue
			}
			p := Point{Text: text}
			if at, ok := seconds(rp.At); ok {
				p.At = &at
			}
			sec.Points = append(sec.Points, p)
			if len(sec.Points) == maxPoints {
				break
			}
		}
		if sec.Summary == "" && len(sec.Points) == 0 {
			continue
		}
		sections = append(sections, sec)
	}

	if len(chapters) > 0 && len(sections) == len(chapters) {
		// The model kept to the chapters: the creator's boundaries are the
		// facts, the model's are its reading of them.
		for i := range sections {
			sections[i].Start = chapters[i].Start
			sections[i].Title = clean(chapters[i].Title, maxTitle)
		}
		fromChapters = true
	}

	sort.SliceStable(sections, func(i, j int) bool { return sections[i].Start < sections[j].Start })
	// Two sections at one second are one section too many.
	kept := sections[:0]
	for _, s := range sections {
		if len(kept) > 0 && s.Start == kept[len(kept)-1].Start {
			continue
		}
		kept = append(kept, s)
	}
	sections = kept
	if len(sections) > maxSections {
		sections = sections[:maxSections]
	}
	if len(sections) == 0 {
		return nil, false, ErrInvalid
	}

	for i := range sections {
		s := &sections[i]
		s.End = end
		if i+1 < len(sections) {
			s.End = sections[i+1].Start
		}
		if s.Title == "" {
			s.Title = fmt.Sprintf("Part %d", i+1)
		}
		// A time outside its own section is not where the point is said.
		for j := range s.Points {
			if at := s.Points[j].At; at != nil && (*at < s.Start-slack || *at > s.End+slack) {
				s.Points[j].At = nil
			}
		}
		if s.Points == nil {
			s.Points = []Point{}
		}
	}
	return sections, fromChapters, nil
}

// seconds reads a time the model wrote: "MM:SS", "H:MM:SS", "[MM:SS]", or a
// number of seconds.
func seconds(raw json.RawMessage) (float64, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, false
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		s = strings.Trim(strings.TrimSpace(s), "[]()")
		if v, ok := youtube.ParseClock(s); ok {
			return v, true
		}
		v, err := strconv.ParseFloat(s, 64)
		return v, err == nil && v >= 0
	}
	var v float64
	if json.Unmarshal(raw, &v) == nil && v >= 0 {
		return v, true
	}
	return 0, false
}

// clean makes model text safe to store and show as text: control characters
// removed, whitespace collapsed, length bounded.
func clean(s string, limit int) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > limit {
		s = strings.TrimSpace(string([]rune(s)[:limit])) + "…"
	}
	return s
}
