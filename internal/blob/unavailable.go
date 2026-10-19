package blob

import (
	"errors"
	"net/http"
)

// unavailable.go — why a learner's file in their Drive cannot be read or
// written right now (drive-user-storage phase 3).
//
// Nothing is lost in any of these cases: the rows, the parsed text, the
// chunks and the embeddings stay on the server, so search and chat keep
// working. Only the original is out of reach (playback, re-parse, download),
// or a new file cannot be kept. Each reason has its own code and sentence, so
// the page can say what happened and what to do; none of them falls back to
// the server's disk (plan decision 5).

// ErrReconnect is a Drive connection Google no longer honours (a revoked or
// expired grant), or one the learner disconnected. Reconnecting restores
// access to the same files.
var ErrReconnect = errors.New("blob: the learner's Google Drive needs to be reconnected")

// ErrRemoteFull is a Drive with no space left for the file (403
// storageQuotaExceeded). Nothing is written to the server instead.
var ErrRemoteFull = errors.New("blob: the learner's Google Drive is full")

// Reason is how one kind of unavailable file is answered.
type Reason struct {
	Status  int
	Code    string
	Message string
}

// The codes the web app reads; their sentences are in its locale files, and
// these are what any other client sees.
var (
	ReasonReconnect = Reason{http.StatusConflict, "drive_reconnect",
		"Reconnect Google Drive to use the files AnyLearn keeps there."}
	ReasonRemoved = Reason{http.StatusGone, "drive_file_removed",
		"This file was removed from your Drive."}
	ReasonFull = Reason{http.StatusInsufficientStorage, "drive_full",
		"Your Google Drive is full. Free some space in it and try again."}
)

// Unavailable reports why err left a file out of reach, if it is one of the
// reasons above. A plain ErrNotFound (no such file) is not one: it stays a
// 404 like any other missing resource.
func Unavailable(err error) (Reason, bool) {
	switch {
	case err == nil:
		return Reason{}, false
	case errors.Is(err, ErrReconnect):
		return ReasonReconnect, true
	case errors.Is(err, ErrRemoteFull):
		return ReasonFull, true
	case errors.Is(err, ErrRemoved):
		return ReasonRemoved, true
	}
	return Reason{}, false
}

// ReasonOf is the reason whose sentence a stored error message is, if any.
// A failed parse stores the sentence as the document's error (knowledge's
// ProcessDocument), and this gives the page its code back, so it can offer
// "Reconnect Google Drive" instead of plain text (drive-user-storage phase 4).
func ReasonOf(message string) (Reason, bool) {
	for _, r := range []Reason{ReasonReconnect, ReasonRemoved, ReasonFull} {
		if message == r.Message {
			return r, true
		}
	}
	return Reason{}, false
}

// Gone reports a file that is simply not there, as opposed to one the
// learner removed from their Drive, which has its own answer.
func Gone(err error) bool {
	return errors.Is(err, ErrNotFound) && !errors.Is(err, ErrRemoved)
}
