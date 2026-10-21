package vocab

import "github.com/google/uuid"

// KindListen is the listening card (the private design notes,
// phase 1): the line of a video or a recording a word was saved from is
// played, and the learner types the word they hear. Like production it is not
// in CardKinds(); only "Practise hearing it" creates it.
const KindListen = "listen"

// Clip is a line that can be played: page Page of a timed document, from
// Start to End seconds as its timeline gives them now. VideoID is the YouTube
// id, empty for an uploaded recording, which plays from the document's media.
type Clip struct {
	DocumentID uuid.UUID `json:"document_id"`
	Page       int       `json:"page"`
	VideoID    string    `json:"video_id,omitempty"`
	Start      int       `json:"start"`
	End        int       `json:"end"`
	Sentence   string    `json:"sentence"`
}

// TimedDoc is what a clip needs of a document: whether it is heard on a
// clock, its YouTube id, and its pages' [start, end] seconds.
type TimedDoc struct {
	VideoID  string
	Timeline [][2]int
}

// ClipOf is the line a note's listening card plays: its newest context that
// is a page of a timed document with a timeline row. docs holds the owner's
// timed documents by id; nil when no context qualifies.
func ClipOf(contexts []Context, docs map[uuid.UUID]TimedDoc) *Clip {
	for _, c := range contexts {
		if c.DocumentID == nil || c.Page < 1 {
			continue
		}
		d, ok := docs[*c.DocumentID]
		if !ok || c.Page > len(d.Timeline) {
			continue
		}
		row := d.Timeline[c.Page-1]
		if row[1] <= row[0] {
			continue
		}
		return &Clip{DocumentID: *c.DocumentID, Page: c.Page, VideoID: d.VideoID,
			Start: row[0], End: row[1], Sentence: c.Sentence}
	}
	return nil
}

// Typed reports whether a card's answer is the term, typed and matched:
// cloze, production and listening cards.
func Typed(kind string) bool {
	return kind == KindCloze || kind == KindProduction || kind == KindListen
}
