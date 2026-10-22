package showcase

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"
)

// DesignVersion is the version Save writes. A stored page of an older version
// is read through upgrade, so it keeps rendering without a migration.
const DesignVersion = 1

// Limits of a design.
const (
	MaxBlocks     = 12
	MaxAboutTitle = 60
	MaxAboutBody  = 1000
	MaxLinks      = 5
	MaxLinkLabel  = 40
	MaxURL        = 300
)

// Design is how a page looks: a theme and the blocks in order. It is the one
// thing a later design feature extends: a new block type or option goes in
// blockSpecs, a new theme option in Theme and its check (and in the web's
// registry, app/lib/showcase/design.ts).
type Design struct {
	Version int     `json:"version"`
	Theme   Theme   `json:"theme"`
	Blocks  []Block `json:"blocks"`
}

// Theme is the page's look as a whole.
type Theme struct {
	// Accent is one of the app's part colours (Accents), which are measured
	// for contrast in both themes, so a page cannot pick an unreadable one.
	Accent string `json:"accent"`
}

// Accents are the colours a page may take, the first the default.
var Accents = []string{"reflect", "read", "ask", "practise", "tools"}

// Block is one section of the page. Which fields it may carry depends on its
// type (blockSpec.fields); a block that sends another is refused.
type Block struct {
	Type  string `json:"type"`
	Title string `json:"title,omitempty"`
	Body  string `json:"body,omitempty"`
	Links []Link `json:"links,omitempty"`
}

// Link is a link the learner adds, shown as theirs.
type Link struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

// blockSpec says how a block type may be used.
type blockSpec struct {
	// max is how many of it a page may have.
	max int
	// data is a block that shows the learner's counted study; the public
	// read sends that data only when the block is on the page.
	data bool
	// fields are the JSON fields the block may carry besides "type". A new
	// option is a field on Block, its name here and its check.
	fields []string
	// check cleans and checks the block's fields; nil when it has none.
	check func(*Block) error
}

// Block types.
const (
	BlockSummary    = "summary"
	BlockCalendar   = "calendar"
	BlockMilestones = "milestones"
	BlockOutcomes   = "outcomes"
	BlockAbout      = "about"
	BlockLinks      = "links"
)

var blockSpecs = map[string]blockSpec{
	BlockSummary:    {max: 1, data: true},
	BlockCalendar:   {max: 1, data: true},
	BlockMilestones: {max: 1, data: true},
	BlockOutcomes:   {max: 1, data: true},
	BlockAbout:      {max: 3, fields: []string{"title", "body"}, check: checkAbout},
	BlockLinks:      {max: 1, fields: []string{"links"}, check: checkLinks},
}

// The design's errors, one fixed sentence each (translated in
// internal/locale/catalog).
var (
	errDesign    = fmt.Errorf("%w: the page's design could not be read", ErrInvalid)
	errBlocks    = fmt.Errorf("%w: a page has at most 12 blocks", ErrInvalid)
	errBlockType = fmt.Errorf("%w: the page has a block AnyLearn does not know", ErrInvalid)
	errRepeat    = fmt.Errorf("%w: the page has more blocks of one kind than it can", ErrInvalid)
	errField     = fmt.Errorf("%w: a block has a field its kind does not take", ErrInvalid)
	errAccent    = fmt.Errorf("%w: that accent is not one of the page's colours", ErrInvalid)
	errAbout     = fmt.Errorf("%w: an about block needs a text of 1 to 1,000 characters and a title of at most 60", ErrInvalid)
	errLinks     = fmt.Errorf("%w: a links block has 1 to 5 links, each with a label of 1 to 40 characters and an https address", ErrInvalid)
	// errHidden is a control, direction or zero-width character, which could
	// make a name or a link read as something else.
	errHidden = fmt.Errorf("%w: the text has a hidden formatting character; remove it", ErrInvalid)
)

// DefaultDesign is a new page: the counted study, in the order a visitor
// reads it.
func DefaultDesign() Design {
	return Design{
		Version: DesignVersion,
		Theme:   Theme{Accent: Accents[0]},
		Blocks:  []Block{{Type: BlockSummary}, {Type: BlockCalendar}, {Type: BlockMilestones}},
	}
}

// rawDesign is a design with its blocks not yet read, so each block's
// fields can be checked against its type.
type rawDesign struct {
	Version int               `json:"version"`
	Theme   Theme             `json:"theme"`
	Blocks  []json.RawMessage `json:"blocks"`
}

// ParseDesign reads a design the editor sends: upgraded to DesignVersion,
// strictly (an unknown field, or a field the block's type does not take, is
// refused, not dropped), cleaned and checked.
func ParseDesign(raw []byte) (Design, error) {
	raw, err := upgraded(raw)
	if err != nil {
		return Design{}, err
	}
	var rd rawDesign
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&rd); err != nil || dec.More() {
		return Design{}, errDesign
	}
	d := Design{Version: rd.Version, Theme: rd.Theme, Blocks: []Block{}}
	if d.Theme.Accent == "" {
		d.Theme.Accent = Accents[0]
	}
	if !contains(Accents, d.Theme.Accent) {
		return Design{}, errAccent
	}
	if len(rd.Blocks) > MaxBlocks {
		return Design{}, errBlocks
	}
	seen := map[string]int{}
	for _, rb := range rd.Blocks {
		b, err := strictBlock(rb)
		if err != nil {
			return Design{}, err
		}
		if seen[b.Type]++; seen[b.Type] > blockSpecs[b.Type].max {
			return Design{}, errRepeat
		}
		d.Blocks = append(d.Blocks, b)
	}
	return d, nil
}

// strictBlock reads one block: a known type, only its type's fields, checked.
func strictBlock(raw json.RawMessage) (Block, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return Block{}, errDesign
	}
	var b Block
	if err := json.Unmarshal(raw, &b); err != nil {
		return Block{}, errDesign
	}
	spec, ok := blockSpecs[b.Type]
	if !ok {
		return Block{}, errBlockType
	}
	for name := range fields {
		if name != "type" && !contains(spec.fields, name) {
			return Block{}, errField
		}
	}
	if spec.check != nil {
		if err := spec.check(&b); err != nil {
			return Block{}, err
		}
	}
	return b, nil
}

// readDesign reads a stored design for showing. It is lenient where
// ParseDesign is strict, so a rule tightened later does not empty pages
// saved before it: a block this version cannot take is left out and
// counted, the rest still show. A document it cannot read at all shows no
// blocks (and dropped is -1), never blocks the learner may have hidden.
func readDesign(raw []byte) (d Design, dropped int) {
	d = Design{Version: DesignVersion, Theme: Theme{Accent: Accents[0]}, Blocks: []Block{}}
	raw, err := upgraded(raw)
	var rd rawDesign
	if err != nil || json.Unmarshal(raw, &rd) != nil {
		return d, -1
	}
	if contains(Accents, rd.Theme.Accent) {
		d.Theme = rd.Theme
	}
	seen := map[string]int{}
	for _, rb := range rd.Blocks {
		var b Block
		err := json.Unmarshal(rb, &b)
		spec, known := blockSpecs[b.Type]
		ok := err == nil && known && len(d.Blocks) < MaxBlocks && seen[b.Type] < spec.max
		if ok && spec.check != nil {
			ok = spec.check(&b) == nil
		}
		if !ok {
			dropped++
			continue
		}
		seen[b.Type]++
		d.Blocks = append(d.Blocks, b)
	}
	return d, dropped
}

// upgraded is the document at DesignVersion. There is only version 1 so far;
// version 2 adds a case to upgrade that rewrites a 1.
func upgraded(raw []byte) ([]byte, error) {
	var head struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return nil, errDesign
	}
	return upgrade(head.Version, raw)
}

func upgrade(version int, raw []byte) ([]byte, error) {
	switch version {
	case DesignVersion:
		return raw, nil
	default:
		return nil, errDesign
	}
}

// counted reports whether the page has a block of AnyLearn's counts.
func (d Design) counted() bool {
	for _, b := range d.Blocks {
		if blockSpecs[b.Type].data {
			return true
		}
	}
	return false
}

// Shows reports whether the page has a block of the type.
func (d Design) Shows(blockType string) bool {
	for _, b := range d.Blocks {
		if b.Type == blockType {
			return true
		}
	}
	return false
}

func checkAbout(b *Block) error {
	var err error
	if b.Title, err = cleanText(b.Title, 0, MaxAboutTitle, false, errAbout); err != nil {
		return err
	}
	b.Body, err = cleanText(b.Body, 1, MaxAboutBody, true, errAbout)
	return err
}

func checkLinks(b *Block) error {
	if len(b.Links) == 0 || len(b.Links) > MaxLinks {
		return errLinks
	}
	for i := range b.Links {
		l := &b.Links[i]
		var err error
		if l.Label, err = cleanText(l.Label, 1, MaxLinkLabel, false, errLinks); err != nil {
			return err
		}
		var ok bool
		if l.URL, ok = httpsURL(l.URL); !ok {
			return errLinks
		}
	}
	return nil
}

// cleanText trims the text and checks its length in characters, answering
// wrongLength when it is out of bounds. A control character (but a line
// break in multi-line text) or an invisible format character (direction
// marks and overrides, zero-width spaces) is errHidden; the zero-width
// joiner and non-joiner stay, which emoji and some scripts need.
func cleanText(s string, min, max int, multiline bool, wrongLength error) (string, error) {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\r\n", "\n"))
	if !utf8.ValidString(s) {
		return "", errHidden
	}
	for _, r := range s {
		if (unicode.IsControl(r) && !(multiline && r == '\n')) || (unicode.Is(unicode.Cf, r) && r != '\u200c' && r != '\u200d') {
			return "", errHidden
		}
	}
	if n := utf8.RuneCountInString(s); n < min || n > max {
		return "", wrongLength
	}
	return s, nil
}

// httpsURL accepts an https address with a host and no credentials.
func httpsURL(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if len(s) > MaxURL {
		return "", false
	}
	u, err := url.Parse(s)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || strings.ContainsAny(s, " \t\n") {
		return "", false
	}
	return u.String(), true
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
