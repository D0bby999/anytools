package speakcheck_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/speakcheck"
	"github.com/D0bby999/anytools/internal/media"
	"github.com/D0bby999/anytools/internal/vocab"
)

const page = "Then the funniest thing happened. The first few months came and went. So I adjusted my plan."

type fakePages struct{ owner, workspace uuid.UUID }

func (p fakePages) WorkspacePage(_ context.Context, userID, workspaceID uuid.UUID, n int) (uuid.UUID, string, error) {
	if userID != p.owner || workspaceID != p.workspace {
		return uuid.Nil, "", vocab.ErrNotFound
	}
	return uuid.New(), page, nil
}

// fakeAudio measures every take as length seconds and "normalises" it by
// copying, so the test needs no ffmpeg.
type fakeAudio struct{ length float64 }

func (a fakeAudio) Duration(context.Context, string) (float64, error) { return a.length, nil }
func (a fakeAudio) Split(_ context.Context, in, dir string, _ []media.Window) ([]string, error) {
	out := filepath.Join(dir, "window-000.ogg")
	data, err := os.ReadFile(in)
	if err != nil {
		return nil, err
	}
	return []string{out}, os.WriteFile(out, data, 0o600)
}

type fakeEars struct {
	text    string
	err     error
	gotLang string
	gotSecs int
	gotFile bool
}

func (e *fakeEars) Hear(_ context.Context, _ uuid.UUID, path, mime, lang string, seconds int) (speakcheck.Heard, error) {
	_, err := os.Stat(path)
	e.gotFile, e.gotLang, e.gotSecs = err == nil && mime == media.OutputMIME, lang, seconds
	return speakcheck.Heard{Text: e.text, By: speakcheck.By{Kind: "own", Name: "Groq"}}, e.err
}

var webm = append([]byte{0x1A, 0x45, 0xDF, 0xA3}, make([]byte, 64)...)

func TestCheckComparesATakeWithThePassageOnThePage(t *testing.T) {
	owner, ws := uuid.New(), uuid.New()
	tmp := t.TempDir()
	ears := &fakeEars{text: "So I adjust my plan"}
	svc := speakcheck.New(fakePages{owner, ws}, fakeAudio{length: 3.2}, ears, tmp)
	in := speakcheck.Input{WorkspaceID: ws, Page: 5, Text: "So I adjusted my plan.", Take: webm}

	res, err := svc.Check(context.Background(), owner, in)
	if err != nil {
		t.Fatal(err)
	}
	if res.OK != 4 || res.Words[2].State != speakcheck.StateHeardAs || res.Words[2].Heard != "adjust" ||
		res.Heard != "So I adjust my plan" || res.By.Name != "Groq" || res.Lang != "en" {
		t.Fatalf("result = %+v", res)
	}
	if !ears.gotFile || ears.gotLang != "en" || ears.gotSecs != 3 {
		t.Fatalf("heard %+v", ears)
	}
	// Nothing is kept.
	if left, _ := os.ReadDir(tmp); len(left) != 0 {
		t.Fatalf("left behind: %v", left)
	}

	for name, tc := range map[string]struct {
		user  uuid.UUID
		in    speakcheck.Input
		audio fakeAudio
		want  error
	}{
		"another user's workspace": {uuid.New(), in, fakeAudio{3}, vocab.ErrNotFound},
		"not on the page":          {owner, with(in, func(i *speakcheck.Input) { i.Text = "a sentence from elsewhere" }), fakeAudio{3}, speakcheck.ErrInvalid},
		"no passage":               {owner, with(in, func(i *speakcheck.Input) { i.Text = " — " }), fakeAudio{3}, speakcheck.ErrInvalid},
		"too many words":           {owner, with(in, func(i *speakcheck.Input) { i.Text = strings.Repeat("plan ", 81) }), fakeAudio{3}, speakcheck.ErrInvalid},
		"no take":                  {owner, with(in, func(i *speakcheck.Input) { i.Take = nil }), fakeAudio{3}, speakcheck.ErrInvalid},
		"not audio":                {owner, with(in, func(i *speakcheck.Input) { i.Take = []byte("hello there, not audio") }), fakeAudio{3}, speakcheck.ErrUnreadable},
		"too long":                 {owner, in, fakeAudio{45}, speakcheck.ErrInvalid},
	} {
		svc := speakcheck.New(fakePages{owner, ws}, tc.audio, &fakeEars{text: "x"}, tmp)
		if _, err := svc.Check(context.Background(), tc.user, tc.in); !errors.Is(err, tc.want) {
			t.Errorf("%s: %v, want %v", name, err, tc.want)
		}
	}

	// The engine's answer is passed on as it is.
	svc = speakcheck.New(fakePages{owner, ws}, fakeAudio{3}, &fakeEars{err: speakcheck.ErrNoEngine}, tmp)
	if _, err := svc.Check(context.Background(), owner, in); !errors.Is(err, speakcheck.ErrNoEngine) {
		t.Fatalf("no engine: %v", err)
	}
}

func with(in speakcheck.Input, f func(*speakcheck.Input)) speakcheck.Input {
	f(&in)
	return in
}

// Dictation (plan 261021-1100 phase 2): the same take, heard the same way,
// with no passage to compare against.
func TestDictateHearsATakeWithoutAPassage(t *testing.T) {
	tmp := t.TempDir()
	owner, ws := uuid.New(), uuid.New()
	ears := &fakeEars{text: "  What is ATP?  "}
	svc := speakcheck.New(fakePages{owner, ws}, fakeAudio{4}, ears, tmp)
	got, err := svc.Dictate(context.Background(), owner, webm, "vi")
	if err != nil || got.Text != "What is ATP?" || ears.gotLang != "vi" {
		t.Fatalf("Dictate = %+v, %v (lang %q)", got, err, ears.gotLang)
	}
	if _, err := svc.Dictate(context.Background(), owner, nil, ""); !errors.Is(err, speakcheck.ErrInvalid) {
		t.Fatalf("an empty take: %v", err)
	}
	if _, err := svc.Dictate(context.Background(), owner, []byte("not audio"), ""); !errors.Is(err, speakcheck.ErrUnreadable) {
		t.Fatalf("a take that is not audio: %v", err)
	}
	if _, err := speakcheck.New(fakePages{owner, ws}, fakeAudio{40}, ears, tmp).Dictate(context.Background(), owner, webm, ""); !errors.Is(err, speakcheck.ErrInvalid) {
		t.Fatalf("a take over 30 s: %v", err)
	}
}
