package parse

import (
	"errors"
	"fmt"
	"log/slog"
)

// ErrParserPanicked is returned when a third-party parser panicked on a file.
var ErrParserPanicked = errors.New("parse: the file could not be read")

// guarded runs one local extraction and turns a panic into an error.
//
// The libraries behind local extraction (ledongthuc/pdf, the docx and epub
// readers) panic on malformed input: fuzzing one valid PDF produced 66 files
// out of 561 that passed the page-count gate and then panicked the text-layer
// read (security audit F-1). The file is the uploader's to shape, so a panic
// here is an input error, reported as one, never a process exit.
func guarded(kind string, fn func() (string, int, error)) (md string, pages int, err error) {
	defer func() {
		if r := recover(); r != nil {
			// No stack: this is a malformed upload, not a bug in AnyTools, and
			// a stack per bad file would bury the log.
			slog.Warn("parse: local "+kind+" extraction panicked", "panic", fmt.Sprint(r))
			md, pages, err = "", 0, fmt.Errorf("%w (%s)", ErrParserPanicked, kind)
		}
	}()
	md, pages, err = fn()
	if err == nil && len(md) > MaxExtractedTextBytes {
		return "", 0, fmt.Errorf("%w: %d MB of text", ErrTooLarge, len(md)>>20)
	}
	return md, pages, err
}

// MaxExtractedTextBytes caps what one document may yield as text. Every byte
// of it is chunked and embedded on the user's own key; 400 dense pages are
// about 2 MB, so 32 MB leaves room for any real document and none for a file
// built to burn someone's quota.
const MaxExtractedTextBytes = 32 << 20
