package audio

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// script.go holds the rules a two-voice script is held to (DeepTutor's audio
// overview, findings §7): a host who asks and an expert who explains, turns
// that strictly alternate starting with the host, short turns, and source ids
// that must name a passage that was actually retrieved. The model proposes;
// these rules decide.

// Speakers.
const (
	SpeakerHost   = "host"
	SpeakerExpert = "expert"
)

// Limits.
const (
	MinSegments     = 8
	MaxSegments     = 40
	MaxSegmentWords = 90
	maxTitle        = 200
	// MaxSources and the snippet caps bound what one script call reads.
	MaxSources      = 12
	maxSnippetChars = 2000
	maxContextChars = 16000
	// chunkChars bounds one TTS request: whole turns, at most this much text.
	chunkChars = 2500
)

// ErrInvalidScript wraps every rule a script breaks.
var ErrInvalidScript = errors.New("audio: the script breaks a rule")

// Segment is one turn.
type Segment struct {
	Speaker   string   `json:"speaker"`
	Text      string   `json:"text"`
	SourceIDs []string `json:"source_ids"`
}

// Script is what the model writes and the transcript shows.
type Script struct {
	Title    string    `json:"title"`
	Segments []Segment `json:"segments"`
}

// Source is one retrieved passage, numbered S1…Sn for the model. Text is
// sent to the model and never stored with the overview.
type Source struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Page       int    `json:"page,omitempty"`
	DocumentID string `json:"document_id,omitempty"`
	ChunkID    string `json:"chunk_id,omitempty"`
	ReportID   string `json:"report_id,omitempty"`
	Text       string `json:"-"`
}

// spokenIDs are source ids written into the spoken text — "[S1]", "(S2)" or a
// bare "S3" — which a listener would hear read out.
var spokenIDs = regexp.MustCompile(`[\[(]\s*S?\d+\s*[\])]|\bS\d+\b`)

// Validate checks a script against the rules and the set of source ids that
// were retrieved. The first broken rule is reported, in words a repair
// prompt can act on.
func Validate(s Script, known map[string]bool) error {
	bad := func(format string, args ...any) error {
		return fmt.Errorf("%w: %s", ErrInvalidScript, fmt.Sprintf(format, args...))
	}
	if strings.TrimSpace(s.Title) == "" || utf8.RuneCountInString(s.Title) > maxTitle {
		return bad("the title must be 1 to %d characters", maxTitle)
	}
	if n := len(s.Segments); n < MinSegments || n > MaxSegments {
		return bad("the script needs %d to %d turns, not %d", MinSegments, MaxSegments, n)
	}
	for i, seg := range s.Segments {
		want := SpeakerHost
		if i%2 == 1 {
			want = SpeakerExpert
		}
		if seg.Speaker != want {
			return bad("turn %d must be the %s: the host starts and the two alternate", i+1, want)
		}
		text := strings.TrimSpace(seg.Text)
		if text == "" {
			return bad("turn %d is empty", i+1)
		}
		if words := len(strings.Fields(text)); words > MaxSegmentWords {
			return bad("turn %d has %d words; at most %d", i+1, words, MaxSegmentWords)
		}
		if m := spokenIDs.FindString(text); m != "" {
			return bad("turn %d says %q aloud; source ids belong in source_ids, not in the text", i+1, m)
		}
		for _, id := range seg.SourceIDs {
			if !known[id] {
				return bad("turn %d cites %q, which is not one of the sources given", i+1, id)
			}
		}
	}
	return nil
}

// Words counts the spoken words of a script.
func (s Script) Words() int {
	n := 0
	for _, seg := range s.Segments {
		n += len(strings.Fields(seg.Text))
	}
	return n
}

// Chars counts the spoken characters, which is what TTS is billed on.
func (s Script) Chars() int {
	n := 0
	for _, seg := range s.Segments {
		n += utf8.RuneCountInString(seg.Text)
	}
	return n
}

// Chunk is a run of whole turns sent to TTS in one request.
type Chunk []Segment

// Chunks splits a script into TTS requests of whole turns, each at most
// chunkChars of text (a single longer turn is its own chunk).
func (s Script) Chunks() []Chunk {
	var (
		out   []Chunk
		cur   Chunk
		chars int
	)
	for _, seg := range s.Segments {
		n := utf8.RuneCountInString(seg.Text)
		if len(cur) > 0 && chars+n > chunkChars {
			out = append(out, cur)
			cur, chars = nil, 0
		}
		cur = append(cur, seg)
		chars += n
	}
	if len(cur) > 0 {
		out = append(out, cur)
	}
	return out
}

// Words counts a chunk's spoken words.
func (c Chunk) Words() int {
	n := 0
	for _, seg := range c {
		n += len(strings.Fields(seg.Text))
	}
	return n
}

// context renders the sources for the prompt, capped per snippet and in all.
// It returns the rendered block and the ids that made it in.
func sourceBlock(sources []Source, wrap func(label, id, text string) string) (string, map[string]bool) {
	known := map[string]bool{}
	var parts []string
	total := 0
	for _, s := range sources {
		text := truncate(s.Text, maxSnippetChars)
		if total+len(text) > maxContextChars {
			break
		}
		total += len(text)
		label := s.Title
		if s.Page > 0 {
			label = fmt.Sprintf("%s p.%d", s.Title, s.Page)
		}
		parts = append(parts, wrap(label, s.ID, text))
		known[s.ID] = true
	}
	return strings.Join(parts, "\n\n"), known
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
