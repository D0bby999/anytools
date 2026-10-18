package media

import (
	"bytes"
	"encoding/binary"
	"math"
)

// duration.go — a file's length, read from its container's header, so the
// learner sees what a transcription would cost before anything runs.
//
// The phase names three headers: MP4's `mvhd` (also M4A and QuickTime), the
// WAV header, and the last Ogg page's granule position. Two more are read the
// same way, because they are the most common podcast and browser formats: an
// MP3's Xing/Info or VBRI frame count (or, for a constant-bitrate file, its
// size over its bitrate), and WebM's Segment Info duration. Anything else (an
// MPEG program stream, a WebM written live without a duration) is unknown,
// and the page says so and asks the learner to confirm.
//
// Every reader works on bytes already in memory and bounded by
// MaxMediaBytes, never trusts a size field past the end of the data, and
// gives up rather than guessing.

// Duration is the file's length in seconds, when its header says.
func Duration(f Format, data []byte) (float64, bool) {
	var d float64
	var ok bool
	switch f.MIME {
	case "audio/mp4", "video/mp4", "video/quicktime":
		d, ok = mp4Duration(data)
	case "audio/wav":
		d, ok = wavDuration(data)
	case "audio/ogg":
		d, ok = oggDuration(data)
	case "audio/mpeg":
		d, ok = mp3Duration(data)
	case "audio/webm", "video/webm":
		d, ok = webmDuration(data)
	}
	if !ok || math.IsNaN(d) || math.IsInf(d, 0) || d <= 0 || d > 48*3600 {
		return 0, false
	}
	return d, true
}

// ───────────────────────────────────────────────────── ISO BMFF (MP4, MOV)

// eachBox calls fn for every box in data, in order, until fn returns false.
func eachBox(data []byte, fn func(typ string, body []byte) bool) {
	for len(data) >= 8 {
		size := uint64(binary.BigEndian.Uint32(data[0:4]))
		typ := string(data[4:8])
		header := uint64(8)
		switch size {
		case 0: // to the end of the data
			size = uint64(len(data))
		case 1: // a 64-bit size follows the type
			if len(data) < 16 {
				return
			}
			size, header = binary.BigEndian.Uint64(data[8:16]), 16
		}
		if size < header || size > uint64(len(data)) {
			return
		}
		if !fn(typ, data[header:size]) {
			return
		}
		data = data[size:]
	}
}

// child is the first box of typ inside body.
func child(body []byte, typ string) []byte {
	var out []byte
	eachBox(body, func(t string, b []byte) bool {
		if t == typ {
			out = b
			return false
		}
		return true
	})
	return out
}

// mp4Duration reads moov/mvhd: a duration in units of its own timescale.
func mp4Duration(data []byte) (float64, bool) {
	mvhd := child(child(data, "moov"), "mvhd")
	if len(mvhd) < 20 {
		return 0, false
	}
	var scale, dur uint64
	if mvhd[0] == 1 {
		if len(mvhd) < 32 {
			return 0, false
		}
		scale = uint64(binary.BigEndian.Uint32(mvhd[20:24]))
		dur = binary.BigEndian.Uint64(mvhd[24:32])
	} else {
		scale = uint64(binary.BigEndian.Uint32(mvhd[12:16]))
		dur = uint64(binary.BigEndian.Uint32(mvhd[16:20]))
	}
	if scale == 0 || dur == 0 || dur == math.MaxUint32 || dur == math.MaxUint64 {
		return 0, false
	}
	return float64(dur) / float64(scale), true
}

// mp4HasVideo: a moov/trak whose mdia/hdlr handler is `vide`.
func mp4HasVideo(data []byte) bool {
	found := false
	eachBox(child(data, "moov"), func(t string, trak []byte) bool {
		if t != "trak" {
			return true
		}
		hdlr := child(child(trak, "mdia"), "hdlr")
		if len(hdlr) >= 12 && string(hdlr[8:12]) == "vide" {
			found = true
			return false
		}
		return true
	})
	return found
}

// ─────────────────────────────────────────────────────────────────── WAV

// wavDuration is the data chunk's length over the fmt chunk's byte rate.
func wavDuration(data []byte) (float64, bool) {
	if len(data) < 12 {
		return 0, false
	}
	var byteRate uint32
	rest := data[12:]
	for len(rest) >= 8 {
		id := string(rest[0:4])
		size := uint64(binary.LittleEndian.Uint32(rest[4:8]))
		body := rest[8:]
		switch id {
		case "fmt ":
			if len(body) < 12 {
				return 0, false
			}
			byteRate = binary.LittleEndian.Uint32(body[8:12])
		case "data":
			// A file written while streaming leaves the size unset or too big:
			// the data is then the rest of the file.
			if size == math.MaxUint32 || size > uint64(len(body)) {
				size = uint64(len(body))
			}
			if byteRate == 0 {
				return 0, false
			}
			return float64(size) / float64(byteRate), true
		}
		if size > uint64(len(body)) {
			return 0, false
		}
		step := 8 + size + size%2
		if step > uint64(len(rest)) {
			return 0, false
		}
		rest = rest[step:]
	}
	return 0, false
}

// ─────────────────────────────────────────────────────────────────── Ogg

// oggDuration is the last page's granule position over the codec's sample
// rate (Opus: always 48 kHz, less its pre-skip; Vorbis: from its header).
func oggDuration(data []byte) (float64, bool) {
	if len(data) < 28 || string(data[0:4]) != "OggS" {
		return 0, false
	}
	serial := binary.LittleEndian.Uint32(data[14:18])
	segments := int(data[26])
	start := 27 + segments
	if len(data) < start {
		return 0, false
	}
	packet := data[start:]

	var rate, preskip float64
	switch {
	case len(packet) >= 12 && string(packet[0:8]) == "OpusHead":
		rate, preskip = 48000, float64(binary.LittleEndian.Uint16(packet[10:12]))
	case len(packet) >= 16 && string(packet[0:7]) == "\x01vorbis":
		rate = float64(binary.LittleEndian.Uint32(packet[12:16]))
	default:
		return 0, false
	}
	if rate == 0 {
		return 0, false
	}

	// The last page of the same stream that carries a granule position.
	for at := bytes.LastIndex(data, []byte("OggS")); at >= 0; at = bytes.LastIndex(data[:at], []byte("OggS")) {
		if at+27 > len(data) || binary.LittleEndian.Uint32(data[at+14:at+18]) != serial {
			continue
		}
		granule := int64(binary.LittleEndian.Uint64(data[at+6 : at+14]))
		if granule <= 0 {
			continue
		}
		return (float64(granule) - preskip) / rate, true
	}
	return 0, false
}

// ─────────────────────────────────────────────────────────────────── MP3

// frameHeader is one MPEG audio frame's header, decoded.
type frameHeader struct {
	bitrate, sampleRate int // bits per second, Hz
	samples             int // per frame
	length              int // bytes, header included
	mpeg1, mono         bool
}

var (
	bitratesV1 = [3][16]int{
		{0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0}, // layer I
		{0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0},    // layer II
		{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0},     // layer III
	}
	bitratesV2 = [3][16]int{
		{0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0}, // layer I
		{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},      // layers II, III
		{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},
	}
	sampleRates = map[int][3]int{3: {44100, 48000, 32000}, 2: {22050, 24000, 16000}, 0: {11025, 12000, 8000}}
)

func parseFrameHeader(b []byte) (frameHeader, bool) {
	if len(b) < 4 || b[0] != 0xFF || b[1]&0xE0 != 0xE0 {
		return frameHeader{}, false
	}
	version := int(b[1]>>3) & 3 // 0: 2.5, 1: reserved, 2: MPEG-2, 3: MPEG-1
	layerBits := int(b[1]>>1) & 3
	brIndex, srIndex := int(b[2]>>4), int(b[2]>>2)&3
	if version == 1 || layerBits == 0 || brIndex == 0 || brIndex == 15 || srIndex == 3 {
		return frameHeader{}, false
	}
	layer := 4 - layerBits // 1, 2 or 3
	h := frameHeader{mpeg1: version == 3, mono: b[3]>>6 == 3, sampleRate: sampleRates[version][srIndex]}
	if h.mpeg1 {
		h.bitrate = bitratesV1[layer-1][brIndex] * 1000
	} else {
		h.bitrate = bitratesV2[layer-1][brIndex] * 1000
	}
	pad := int(b[2]>>1) & 1
	switch {
	case layer == 1:
		h.samples = 384
		h.length = (12*h.bitrate/h.sampleRate + pad) * 4
	case layer == 3 && !h.mpeg1:
		h.samples = 576
		h.length = 72*h.bitrate/h.sampleRate + pad
	default:
		h.samples = 1152
		h.length = 144*h.bitrate/h.sampleRate + pad
	}
	return h, h.length > 4
}

// mp3Duration: the frame count of a Xing/Info or VBRI header, or a constant
// bitrate's size over rate.
func mp3Duration(data []byte) (float64, bool) {
	start := 0
	if len(data) >= 10 && string(data[0:3]) == "ID3" {
		size := int(data[6]&0x7F)<<21 | int(data[7]&0x7F)<<14 | int(data[8]&0x7F)<<7 | int(data[9]&0x7F)
		start = 10 + size
		if data[5]&0x10 != 0 {
			start += 10 // a footer
		}
	}
	// The first frame: a header whose next frame also parses, within 64 KB.
	var h frameHeader
	found := false
	for limit := min(len(data), start+64<<10); start+4 <= limit; start++ {
		var ok bool
		if h, ok = parseFrameHeader(data[start:]); !ok {
			continue
		}
		next := start + h.length
		if next+4 > len(data) {
			break
		}
		if _, ok := parseFrameHeader(data[next:]); ok {
			found = true
			break
		}
	}
	if !found {
		return 0, false
	}

	frame := data[start:]
	side := 32
	switch {
	case h.mpeg1 && h.mono, !h.mpeg1 && !h.mono:
		side = 17
	case !h.mpeg1 && h.mono:
		side = 9
	}
	if x := 4 + side; len(frame) >= x+12 && (string(frame[x:x+4]) == "Xing" || string(frame[x:x+4]) == "Info") {
		if flags := binary.BigEndian.Uint32(frame[x+4 : x+8]); flags&1 != 0 {
			if frames := binary.BigEndian.Uint32(frame[x+8 : x+12]); frames > 0 {
				return float64(frames) * float64(h.samples) / float64(h.sampleRate), true
			}
		}
	}
	if len(frame) >= 36+18 && string(frame[36:40]) == "VBRI" {
		if frames := binary.BigEndian.Uint32(frame[50:54]); frames > 0 {
			return float64(frames) * float64(h.samples) / float64(h.sampleRate), true
		}
	}
	audio := len(data) - start
	if len(data) >= 128 && string(data[len(data)-128:len(data)-125]) == "TAG" {
		audio -= 128
	}
	if h.bitrate == 0 || audio <= 0 {
		return 0, false
	}
	return float64(audio) * 8 / float64(h.bitrate), true
}

// ───────────────────────────────────────────────────────────────── WebM

// EBML element ids, with their length marker bits kept, as the spec writes them.
const (
	ebmlSegment       = 0x18538067
	ebmlInfo          = 0x1549A966
	ebmlTimecodeScale = 0x2AD7B1
	ebmlDuration      = 0x4489
	ebmlTracks        = 0x1654AE6B
	ebmlTrackEntry    = 0xAE
	ebmlTrackType     = 0x83
	ebmlCluster       = 0x1F43B675
)

// ebmlElement reads one element's id and body. unknown: the size is "until
// the parent ends", which a live recording writes for its segment.
func ebmlElement(b []byte) (id uint32, body []byte, rest []byte, ok bool) {
	idLen := vintLength(b)
	if idLen == 0 || idLen > 4 || len(b) < idLen {
		return 0, nil, nil, false
	}
	for _, c := range b[:idLen] {
		id = id<<8 | uint32(c)
	}
	b = b[idLen:]
	sizeLen := vintLength(b)
	if sizeLen == 0 || len(b) < sizeLen {
		return 0, nil, nil, false
	}
	size := uint64(b[0]) & (0xFF >> sizeLen)
	allOnes := size == uint64(0xFF>>sizeLen)
	for _, c := range b[1:sizeLen] {
		size = size<<8 | uint64(c)
		allOnes = allOnes && c == 0xFF
	}
	b = b[sizeLen:]
	if allOnes || size > uint64(len(b)) {
		// Unknown, or cut short: the rest of the data.
		return id, b, nil, true
	}
	return id, b[:size], b[size:], true
}

func vintLength(b []byte) int {
	if len(b) == 0 || b[0] == 0 {
		return 0
	}
	n := 1
	for mask := byte(0x80); b[0]&mask == 0; mask >>= 1 {
		n++
	}
	return n
}

// webmSegment walks the Segment's children before the first Cluster.
func webmSegment(data []byte, fn func(id uint32, body []byte)) {
	for rest := data; len(rest) > 0; {
		id, body, next, ok := ebmlElement(rest)
		if !ok {
			return
		}
		if id == ebmlSegment {
			for seg := body; len(seg) > 0; {
				cid, cbody, cnext, ok := ebmlElement(seg)
				if !ok || cid == ebmlCluster {
					return
				}
				fn(cid, cbody)
				seg = cnext
			}
			return
		}
		rest = next
	}
}

func ebmlUint(b []byte) uint64 {
	var v uint64
	for _, c := range b {
		v = v<<8 | uint64(c)
	}
	return v
}

// webmDuration is Segment/Info/Duration (a float in TimecodeScale units,
// nanoseconds each by default).
func webmDuration(data []byte) (float64, bool) {
	scale, dur, haveDur := uint64(1000000), 0.0, false
	webmSegment(data, func(id uint32, body []byte) {
		if id != ebmlInfo {
			return
		}
		for rest := body; len(rest) > 0; {
			cid, cbody, next, ok := ebmlElement(rest)
			if !ok {
				return
			}
			switch {
			case cid == ebmlTimecodeScale && len(cbody) > 0 && len(cbody) <= 8:
				scale = ebmlUint(cbody)
			case cid == ebmlDuration && len(cbody) == 4:
				dur, haveDur = float64(math.Float32frombits(binary.BigEndian.Uint32(cbody))), true
			case cid == ebmlDuration && len(cbody) == 8:
				dur, haveDur = math.Float64frombits(binary.BigEndian.Uint64(cbody)), true
			}
			rest = next
		}
	})
	if !haveDur || scale == 0 {
		return 0, false
	}
	return dur * float64(scale) / 1e9, true
}

// webmHasVideo: a TrackEntry whose TrackType is 1 (video).
func webmHasVideo(data []byte) bool {
	found := false
	webmSegment(data, func(id uint32, body []byte) {
		if id != ebmlTracks {
			return
		}
		for rest := body; len(rest) > 0 && !found; {
			eid, entry, next, ok := ebmlElement(rest)
			if !ok {
				return
			}
			if eid == ebmlTrackEntry {
				for e := entry; len(e) > 0; {
					fid, fbody, fnext, ok := ebmlElement(e)
					if !ok {
						break
					}
					if fid == ebmlTrackType && ebmlUint(fbody) == 1 {
						found = true
					}
					e = fnext
				}
			}
			rest = next
		}
	})
	return found
}
