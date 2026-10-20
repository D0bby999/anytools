package speakcheck_test

import (
	"reflect"
	"testing"

	"github.com/D0bby999/anytools/internal/capabilities/speakcheck"
)

// states is the alignment as "text:state[:heard][+added]" per word.
func states(a speakcheck.Alignment) []string {
	out := []string{}
	if a.Before != "" {
		out = append(out, "+"+a.Before)
	}
	for _, w := range a.Words {
		s := w.Text + ":" + w.State
		if w.Heard != "" {
			s += ":" + w.Heard
		}
		if w.Added != "" {
			s += "+" + w.Added
		}
		out = append(out, s)
	}
	return out
}

func TestAlignMarksEachWrittenWord(t *testing.T) {
	for _, tc := range []struct {
		name, text, heard string
		want              []string
		ok                int
	}{
		{"all heard, case and punctuation aside", "The cat sat.", "the cat sat",
			[]string{"The:ok", "cat:ok", "sat.:ok"}, 3},
		{"a missed word", "I really like it", "I like it",
			[]string{"I:ok", "really:missed", "like:ok", "it:ok"}, 3},
		{"heard as another word", "a ship at sea", "a sheep at sea",
			[]string{"a:ok", "ship:heard_as:sheep", "at:ok", "sea:ok"}, 3},
		{"an added word", "go home", "go to home",
			[]string{"go:ok+to", "home:ok"}, 2},
		{"added before the first word", "hello there", "um hello there",
			[]string{"+um", "hello:ok", "there:ok"}, 2},
		{"a contraction spelled out", "I don't know", "I do not know",
			[]string{"I:ok", "don't:ok", "know:ok"}, 3},
		{"spelled out in the text, contracted when heard", "It is late", "it's late",
			[]string{"It:ok", "is:ok", "late:ok"}, 3},
		{"'d is would or had", "I'd gone", "I had gone",
			[]string{"I'd:ok", "gone:ok"}, 2},
		{"a hyphenated word heard as two", "a pre-trained model", "a pre trained model",
			[]string{"a:ok", "pre-trained:ok", "model:ok"}, 3},
		{"Vietnamese tones count", "điều chỉnh kế hoạch", "điều chinh kế hoạch",
			[]string{"điều:ok", "chỉnh:heard_as:chinh", "kế:ok", "hoạch:ok"}, 3},
		{"nothing heard", "two words", "",
			[]string{"two:missed", "words:missed"}, 0},
		{"Japanese, a character at a time", "猫が好き", "猫が好き",
			[]string{"猫:ok", "が:ok", "好:ok", "き:ok"}, 4},
		{"dashes are not words", "wait — now", "wait now",
			[]string{"wait:ok", "now:ok"}, 2},
	} {
		got := speakcheck.Align(tc.text, tc.heard)
		if s := states(got); !reflect.DeepEqual(s, tc.want) || got.OK != tc.ok {
			t.Errorf("%s: Align = %v (ok %d), want %v (ok %d)", tc.name, s, got.OK, tc.want, tc.ok)
		}
	}
}
