package httpx

import (
	"net/http"

	"github.com/D0bby999/anytools/internal/blob"
)

// WriteStorageError answers a learner's file that their Drive cannot give or
// take right now (drive-user-storage phase 3): 409 drive_reconnect, 410
// drive_file_removed or 507 drive_full, each with its own sentence. It
// reports whether err was one of those; anything else is the caller's to map.
//
// Every handler that reads or writes a learner's own files calls it before
// its own mapping, because a removed file is also a blob.ErrNotFound and
// would otherwise be answered as a plain 404.
func WriteStorageError(w http.ResponseWriter, err error) bool {
	reason, ok := blob.Unavailable(err)
	if !ok {
		return false
	}
	WriteError(w, reason.Status, reason.Message, reason.Code)
	return true
}
