package audio

import (
	"encoding/binary"
	"errors"
	"io"

	"github.com/D0bby999/anytools/internal/providers/tts"
)

// wav.go writes the one header the finished overview carries. Every chunk is
// raw PCM in the same format (tts.SampleRate, mono, 16-bit), requested that
// way from the provider, so joining is concatenation and no header a provider
// wrote is ever trusted. (DeepTutor joins WAV frames when their parameters
// match and re-encodes otherwise; asking for one format removes the second
// case altogether.)

// MaxSeconds caps an overview's audio.
const MaxSeconds = 20 * 60

// ErrTooLong is audio over MaxSeconds.
var ErrTooLong = errors.New("audio: the overview would be longer than 20 minutes")

// writeWAVHeader writes a 44-byte RIFF header for pcmBytes of 24 kHz mono
// 16-bit PCM.
func writeWAVHeader(w io.Writer, pcmBytes int64) error {
	if pcmBytes < 0 || pcmBytes > int64(MaxSeconds)*tts.BytesPerSecond {
		return ErrTooLong
	}
	const (
		channels      = 1
		bitsPerSample = 16
	)
	h := make([]byte, 44)
	copy(h[0:], "RIFF")
	binary.LittleEndian.PutUint32(h[4:], uint32(36+pcmBytes))
	copy(h[8:], "WAVE")
	copy(h[12:], "fmt ")
	binary.LittleEndian.PutUint32(h[16:], 16) // PCM fmt chunk size
	binary.LittleEndian.PutUint16(h[20:], 1)  // PCM
	binary.LittleEndian.PutUint16(h[22:], channels)
	binary.LittleEndian.PutUint32(h[24:], tts.SampleRate)
	binary.LittleEndian.PutUint32(h[28:], tts.SampleRate*channels*bitsPerSample/8)
	binary.LittleEndian.PutUint16(h[32:], channels*bitsPerSample/8)
	binary.LittleEndian.PutUint16(h[34:], bitsPerSample)
	copy(h[36:], "data")
	binary.LittleEndian.PutUint32(h[40:], uint32(pcmBytes))
	_, err := w.Write(h)
	return err
}

// Seconds is the duration of pcmBytes of the format above.
func Seconds(pcmBytes int64) float64 { return float64(pcmBytes) / tts.BytesPerSecond }

// chunkBudget bounds the audio one TTS request may return: its words at a
// slow 110 words a minute, and never under 10 seconds. A provider that sends
// more is sending something other than this text.
func chunkBudget(words int) int64 {
	seconds := float64(words) / 110 * 60
	if seconds < 10 {
		seconds = 10
	}
	return int64(seconds) * tts.BytesPerSecond
}
