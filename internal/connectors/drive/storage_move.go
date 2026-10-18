package drive

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
)

// storage_move.go — what moving a learner's files needs from their Drive
// beyond Put, Open and Delete (drive-user-storage phase 2): finding a file
// AnyTools wrote by its appProperties, and reading Drive's own checksums of
// one file.
//
// Find is how a move resumes. A unit that uploaded a file and stopped before
// recording it left the file in the learner's "AnyTools" folder with its
// appProperties; the next attempt finds it there instead of uploading a
// second copy. Stat is the check before an old copy is deleted: Drive's own
// sha256Checksum (or md5Checksum when Drive gives no sha256) of what it
// holds, not what AnyTools believes it sent.
//
// Like the rest of storage.go, these are proven against drivetest's fixtures,
// shaped from Google's Drive v3 documentation for files.list and files.get
// (the sha256Checksum field included); no live run has been possible.

var _ blob.RemoteLookup = (*Storage)(nil)

const copyFields = "id,size,md5Checksum,sha256Checksum,trashed,appProperties"

// Find lists the files AnyTools wrote for one of the learner's files, by the
// appProperties Put gave them, oldest first. Trashed files are left out.
func (s *Storage) Find(ctx context.Context, userID uuid.UUID, kind, key string) ([]blob.RemoteCopy, error) {
	query := fmt.Sprintf("trashed = false"+
		" and appProperties has { key='%s' and value='%s' }"+
		" and appProperties has { key='%s' and value='%s' }"+
		" and appProperties has { key='%s' and value='%s' }",
		propUser, userID, propKind, escapeQueryLiteral(kind), propKey, escapeQueryLiteral(key))
	q := url.Values{}
	q.Set("q", query)
	q.Set("spaces", "drive")
	q.Set("orderBy", "createdTime")
	q.Set("pageSize", "20")
	q.Set("fields", "files("+copyFields+")")
	var found struct {
		Files []driveObject `json:"files"`
	}
	if err := s.call(ctx, userID, http.MethodGet, s.filesURL("", q), nil, &found); err != nil {
		return nil, err
	}
	out := make([]blob.RemoteCopy, 0, len(found.Files))
	for _, f := range found.Files {
		// Drive's query already matched these; a file whose properties say
		// otherwise is not trusted to be the one asked for.
		if !driveID.MatchString(f.ID) || f.Trashed ||
			f.AppProperties[propUser] != userID.String() || f.AppProperties[propKind] != kind || f.AppProperties[propKey] != key {
			continue
		}
		c, err := toCopy(f)
		if err != nil {
			continue
		}
		out = append(out, c)
	}
	return out, nil
}

// Stat reads one file's size, trashed flag and Drive's own checksums. A file
// gone from Drive is blob.ErrRemoved.
func (s *Storage) Stat(ctx context.Context, userID uuid.UUID, fileID string) (blob.RemoteCopy, error) {
	if !driveID.MatchString(fileID) {
		return blob.RemoteCopy{}, errors.New("drive: malformed file id")
	}
	q := url.Values{}
	q.Set("fields", copyFields)
	q.Set("supportsAllDrives", "true")
	var meta driveObject
	if err := s.call(ctx, userID, http.MethodGet, s.filesURL("/"+fileID, q), nil, &meta); err != nil {
		return blob.RemoteCopy{}, err
	}
	if meta.ID != fileID {
		return blob.RemoteCopy{}, errors.New("drive: the answer named another file")
	}
	return toCopy(meta)
}

func toCopy(f driveObject) (blob.RemoteCopy, error) {
	size, err := strconv.ParseInt(f.Size, 10, 64)
	if err != nil || size < 0 {
		return blob.RemoteCopy{}, errors.New("drive: a file came back without a size")
	}
	return blob.RemoteCopy{
		ID: f.ID, Size: size, MD5: f.MD5Checksum, SHA256: f.SHA256Checksum,
		PropSHA256: f.AppProperties[propSHA], Trashed: f.Trashed,
	}, nil
}

// EnsureFolders already exists on Storage (storage.go); blob.FolderMaker is
// how the Drive backend reaches it when the learner turns Drive storage on.
var _ blob.FolderMaker = (*Storage)(nil)
