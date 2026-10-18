// Package media reads uploaded audio and video files (up-methods phase 15):
// what a file is, from its own bytes (sniff.go); how long it is, from its
// container's header (duration.go); and, for a learner who transcribes with
// their Gemini key, the round trip through Gemini's Files API
// (gemini_files.go).
//
// The extension list is anything-llm's (collector/utils/constants.js:28-37)
// plus .mov. Nothing here decodes audio: the server's ffmpeg does that, in
// internal/media, only when a transcription runs.
package media

import (
	"bytes"
	"encoding/binary"
	"path"
	"strings"
)

// Format is a sniffed media file.
type Format struct {
	// MIME is the type the file is stored and served with, from a closed
	// list (the documents_media_mime_known CHECK).
	MIME string
	// Video: the container holds a picture track, so the viewer shows a
	// <video>; otherwise an <audio>.
	Video bool
}

// Extensions are the accepted file extensions, lower case.
var Extensions = []string{".mp3", ".wav", ".m4a", ".ogg", ".oga", ".opus", ".webm", ".mp4", ".mpeg", ".mov"}

// IsMediaName reports whether filename has one of the accepted extensions.
// The bytes still decide (Sniff); this only chooses which upload cap applies.
func IsMediaName(filename string) bool {
	ext := strings.ToLower(path.Ext(filename))
	for _, e := range Extensions {
		if e == ext {
			return true
		}
	}
	return false
}

// SniffBytes is how much of the file Sniff needs to see. The duration and
// the picture track are read from the whole file (duration.go).
const SniffBytes = 64

// Sniff names the file from its extension AND its first bytes, and refuses
// any disagreement: a .mp3 whose body is a PNG is not a media file. ok is
// false for a name or body that is not one of the accepted kinds.
func Sniff(filename string, data []byte) (Format, bool) {
	ext := strings.ToLower(path.Ext(filename))
	switch ext {
	case ".mp3":
		if isMPEGAudio(data) {
			return Format{MIME: "audio/mpeg"}, true
		}
	case ".mpeg":
		// An MPEG program or video stream (anything-llm's video/mpeg), or a
		// bare MPEG audio stream under the older extension.
		if isMPEGProgram(data) {
			return Format{MIME: "video/mpeg", Video: true}, true
		}
		if isMPEGAudio(data) {
			return Format{MIME: "audio/mpeg"}, true
		}
	case ".wav":
		if len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WAVE" {
			return Format{MIME: "audio/wav"}, true
		}
	case ".ogg", ".oga", ".opus":
		if len(data) >= 4 && string(data[0:4]) == "OggS" {
			return Format{MIME: "audio/ogg"}, true
		}
	case ".webm":
		if isWebM(data) {
			if webmHasVideo(data) {
				return Format{MIME: "video/webm", Video: true}, true
			}
			return Format{MIME: "audio/webm"}, true
		}
	case ".m4a":
		if isISOBMFF(data, false) {
			return Format{MIME: "audio/mp4"}, true
		}
	case ".mp4":
		if isISOBMFF(data, false) {
			if mp4HasVideo(data) {
				return Format{MIME: "video/mp4", Video: true}, true
			}
			return Format{MIME: "audio/mp4"}, true
		}
	case ".mov":
		if isISOBMFF(data, true) {
			return Format{MIME: "video/quicktime", Video: true}, true
		}
	}
	return Format{}, false
}

// isMPEGAudio: an ID3v2 tag, or an MPEG audio frame header (an 11-bit sync,
// a known version and layer, and a bitrate and sample rate that are not the
// reserved values).
func isMPEGAudio(data []byte) bool {
	if len(data) >= 10 && string(data[0:3]) == "ID3" && data[3] <= 4 {
		return true
	}
	_, ok := parseFrameHeader(data)
	return ok
}

// isMPEGProgram: a pack header (00 00 01 BA) or a video sequence header
// (00 00 01 B3).
func isMPEGProgram(data []byte) bool {
	return len(data) >= 4 && data[0] == 0 && data[1] == 0 && data[2] == 1 && (data[3] == 0xBA || data[3] == 0xB3)
}

// isISOBMFF: the first box is `ftyp` (MP4, M4A, QuickTime since 2001).
// An older QuickTime file may start with any of its top-level atoms, which
// only .mov accepts.
func isISOBMFF(data []byte, quicktime bool) bool {
	if len(data) < 8 {
		return false
	}
	size := binary.BigEndian.Uint32(data[0:4])
	box := string(data[4:8])
	if box == "ftyp" {
		return size >= 8
	}
	if quicktime {
		switch box {
		case "moov", "mdat", "wide", "free", "skip":
			return size == 0 || size == 1 || size >= 8
		}
	}
	return false
}

// isWebM: the EBML magic, and a DocType of "webm" (a Matroska .mkv renamed
// is refused: browsers do not promise to play it).
func isWebM(data []byte) bool {
	if len(data) < 4 || !bytes.Equal(data[0:4], []byte{0x1A, 0x45, 0xDF, 0xA3}) {
		return false
	}
	head := data
	if len(head) > 64 {
		head = head[:64]
	}
	return bytes.Contains(head, []byte{0x42, 0x82}) && bytes.Contains(head, []byte("webm"))
}
