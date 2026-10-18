package media

import (
	"bytes"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// The fixtures are real files, three seconds of a 440 Hz tone (and a grey
// picture for the video ones), made with ffmpeg's lavfi sources:
//
//	tone.mp3         libmp3lame 32k, with a Xing/Info header
//	tone-cbr.mp3     libmp3lame 32k, -write_xing 0 (no frame count)
//	tone.wav         pcm_s16le 8 kHz mono
//	tone.m4a         aac 24k in MP4
//	tone.ogg         libvorbis in Ogg
//	tone.opus        libopus in Ogg
//	tone-audio.webm  libopus in WebM, no picture
//	clip.webm        libvpx + libopus
//	clip.mp4         libx264 + aac
//	clip.mov         libx264 + aac, QuickTime
//	clip.mpeg        mpeg1video + mp2, MPEG program stream
func fixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestEveryAcceptedFormatIsSniffedFromItsBytes(t *testing.T) {
	cases := []struct {
		file, name, mime string
		video            bool
	}{
		{"tone.mp3", "episode.mp3", "audio/mpeg", false},
		{"tone-cbr.mp3", "episode.MP3", "audio/mpeg", false},
		{"tone.wav", "class.wav", "audio/wav", false},
		{"tone.m4a", "memo.m4a", "audio/mp4", false},
		{"tone.ogg", "talk.ogg", "audio/ogg", false},
		{"tone.ogg", "talk.oga", "audio/ogg", false},
		{"tone.opus", "talk.opus", "audio/ogg", false},
		{"tone-audio.webm", "voice.webm", "audio/webm", false},
		{"clip.webm", "meeting.webm", "video/webm", true},
		{"clip.mp4", "lecture.mp4", "video/mp4", true},
		{"tone.m4a", "audio-only.mp4", "audio/mp4", false},
		{"clip.mov", "phone.mov", "video/quicktime", true},
		{"clip.mpeg", "old.mpeg", "video/mpeg", true},
		{"tone-cbr.mp3", "old.mpeg", "audio/mpeg", false},
	}
	for _, c := range cases {
		f, ok := Sniff(c.name, fixture(t, c.file))
		if !ok || f.MIME != c.mime || f.Video != c.video {
			t.Errorf("%s as %s: got %+v ok=%v, want %s video=%v", c.file, c.name, f, ok, c.mime, c.video)
		}
		if !IsMediaName(c.name) {
			t.Errorf("%s is not taken as a media name", c.name)
		}
	}
}

func TestANameThatDisagreesWithTheBytesIsRefused(t *testing.T) {
	png := append([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"), bytes.Repeat([]byte{0}, 64)...)
	html := []byte("<!doctype html><title>x</title>")
	mkv := append([]byte{0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x82, 0x88}, []byte("matroska")...)
	cases := []struct {
		name string
		data []byte
	}{
		{"song.mp3", png},
		{"song.mp3", html},
		{"song.mp3", fixture(t, "tone.wav")},
		{"class.wav", fixture(t, "tone.mp3")},
		{"talk.ogg", fixture(t, "clip.mp4")},
		{"talk.opus", png},
		{"lecture.mp4", fixture(t, "tone.ogg")},
		{"memo.m4a", fixture(t, "clip.webm")},
		{"meeting.webm", mkv},
		{"meeting.webm", fixture(t, "clip.mp4")},
		{"phone.mov", html},
		{"old.mpeg", png},
		{"notes.txt", fixture(t, "tone.mp3")},
		{"song.mp3", nil},
		{"song.mp3", []byte{0xFF}},
		// An MPEG sync with a reserved version, a free bitrate or a bad rate.
		{"song.mp3", []byte{0xFF, 0xEA, 0x90, 0x00}},
		{"song.mp3", []byte{0xFF, 0xFB, 0x00, 0x00}},
		{"song.mp3", []byte{0xFF, 0xFB, 0x9C, 0x00}},
	}
	for _, c := range cases {
		if f, ok := Sniff(c.name, c.data); ok {
			t.Errorf("%s with %d bytes of something else was accepted as %s", c.name, len(c.data), f.MIME)
		}
	}
	if IsMediaName("notes.txt") || IsMediaName("song.mp3.exe") || IsMediaName("mp3") {
		t.Error("a non-media name was taken for a media one")
	}
}

func TestDurationsAreReadFromEachContainersHeader(t *testing.T) {
	cases := []struct {
		file, name string
		want       float64
	}{
		{"tone.mp3", "a.mp3", 3.0},         // Xing frame count
		{"tone-cbr.mp3", "a.mp3", 3.1},     // size over bitrate
		{"tone.wav", "a.wav", 3.0},         // data over byte rate
		{"tone.m4a", "a.m4a", 3.0},         // mvhd
		{"clip.mp4", "a.mp4", 3.0},         // mvhd
		{"clip.mov", "a.mov", 3.0},         // mvhd
		{"tone.ogg", "a.ogg", 3.0},         // Vorbis granule
		{"tone.opus", "a.opus", 3.0},       // Opus granule less pre-skip
		{"tone-audio.webm", "a.webm", 3.0}, // Segment Info
		{"clip.webm", "a.webm", 3.0},       // Segment Info
		{"tone-cbr.mp3", "a.mpeg", 3.1},    // MPEG audio under .mpeg
	}
	for _, c := range cases {
		data := fixture(t, c.file)
		f, ok := Sniff(c.name, data)
		if !ok {
			t.Fatalf("%s did not sniff", c.file)
		}
		got, ok := Duration(f, data)
		if !ok || math.Abs(got-c.want) > 0.15 {
			t.Errorf("%s: duration %.3f ok=%v, want about %.1f", c.file, got, ok, c.want)
		}
	}
}

func TestAnUnreadableLengthIsUnknownNotGuessed(t *testing.T) {
	// An MPEG program stream has no duration header.
	if d, ok := Duration(Format{MIME: "video/mpeg", Video: true}, fixture(t, "clip.mpeg")); ok {
		t.Errorf("an MPEG program stream got a duration of %.1f", d)
	}
	// Each container cut before the part that says how long it is.
	for _, c := range []struct{ file, name string }{
		{"tone.wav", "a.wav"}, {"clip.mp4", "a.mp4"}, {"tone.ogg", "a.ogg"}, {"clip.webm", "a.webm"},
	} {
		data := fixture(t, c.file)
		f, _ := Sniff(c.name, data)
		if d, ok := Duration(f, data[:24]); ok {
			t.Errorf("%s cut to 24 bytes got a duration of %.1f", c.file, d)
		}
	}
	// A size field pointing past the end is not followed.
	bad := append([]byte{0xFF, 0xFF, 0xFF, 0xF0}, []byte("moov")...)
	if d, ok := Duration(Format{MIME: "video/mp4"}, bad); ok {
		t.Errorf("an MP4 box claiming 4 GB got a duration of %.1f", d)
	}
	// A header that claims a length of years is refused: mvhd's timescale
	// set to 1 and its duration to about 136 years.
	mp4 := append([]byte{}, fixture(t, "clip.mp4")...)
	at := bytes.Index(mp4, []byte("mvhd")) + 4
	mp4[at+12], mp4[at+13], mp4[at+14], mp4[at+15] = 0, 0, 0, 1
	mp4[at+16], mp4[at+17], mp4[at+18], mp4[at+19] = 0xFF, 0xFF, 0xFF, 0x00
	if d, ok := Duration(Format{MIME: "video/mp4"}, mp4); ok {
		t.Errorf("an MP4 claiming %.0f seconds was believed", d)
	}
}
