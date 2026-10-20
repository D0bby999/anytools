package vocab_test

import (
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/vocab"
)

func TestClipOfIsTheNewestContextThatIsATimedLine(t *testing.T) {
	video, recording, pdf := uuid.New(), uuid.New(), uuid.New()
	docs := map[uuid.UUID]vocab.TimedDoc{
		video:     {VideoID: "dQw4w9WgXcQ", Timeline: [][2]int{{0, 4}, {12, 17}}},
		recording: {Timeline: [][2]int{{3, 9}, {9, 9}}},
	}
	ctx := func(doc uuid.UUID, page int, s string) vocab.Context {
		return vocab.Context{DocumentID: &doc, Page: page, Sentence: s}
	}
	for _, tc := range []struct {
		name     string
		contexts []vocab.Context
		want     *vocab.Clip
	}{
		{"none", nil, nil},
		{"a PDF only", []vocab.Context{ctx(pdf, 2, "p")}, nil},
		{"no document", []vocab.Context{{Sentence: "s", Page: 1}}, nil},
		{"past the timeline", []vocab.Context{ctx(video, 3, "late")}, nil},
		{"an empty line", []vocab.Context{ctx(recording, 2, "empty")}, nil},
		{"the newest timed one", []vocab.Context{ctx(pdf, 1, "p"), ctx(video, 2, "video line"), ctx(recording, 1, "older")},
			&vocab.Clip{DocumentID: video, Page: 2, VideoID: "dQw4w9WgXcQ", Start: 12, End: 17, Sentence: "video line"}},
		{"a recording", []vocab.Context{ctx(recording, 1, "heard")},
			&vocab.Clip{DocumentID: recording, Page: 1, Start: 3, End: 9, Sentence: "heard"}},
	} {
		got := vocab.ClipOf(tc.contexts, docs)
		if (got == nil) != (tc.want == nil) || got != nil && *got != *tc.want {
			t.Errorf("%s: ClipOf = %+v, want %+v", tc.name, got, tc.want)
		}
	}
}
