package drive

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
)

// import.go — what happens when the user finishes with the Picker.
//
// The Picker hands the browser file and folder IDS, not content, and the
// browser posts them here. The server then does the work, for one reason that
// decides the shape of everything below: a folder must be expanded to its
// children AT PICK TIME.
//
// The spike could not establish that `drive.file` lets an app see a file added
// to a picked folder LATER (capability table row 2: UNKNOWN, leaning NO — the
// scope's own wording is per-file, and Uppy turned folder selection off by
// default because it "couldn't work reliably under drive.file"). So the promise
// this code makes is the one it can keep: everything in the folder at the
// moment you picked it is now granted and stays in sync, and anything added
// afterwards arrives through "Pick more". That is AC2's fallback wording, and
// the KB page says it in those words.

// MaxPicks bounds one import request. The Picker can return a lot of ids, and
// each one costs at least one Drive call.
const MaxPicks = 200

// MaxFolderChildren bounds what one picked folder contributes. A folder with
// ten thousand files in it is not a knowledge base; refusing with a number the
// user can see beats a request that runs for twenty minutes.
const MaxFolderChildren = 500

// Picked is one item the Google Picker returned.
type Picked struct {
	ID string `json:"id"`
	// Kind is the browser's claim about what this is. It is a HINT only: the
	// server asks Drive what the file actually is before expanding anything,
	// because a client that says "file" about a folder id (or the reverse)
	// must not be able to steer the server's behaviour.
	Kind string `json:"kind"`
}

// ImportOutcome is what happened to one file or folder.
type ImportOutcome struct {
	FileID     string     `json:"file_id"`
	Name       string     `json:"name"`
	Kind       string     `json:"kind"`
	State      string     `json:"state"`
	DocumentID *uuid.UUID `json:"document_id,omitempty"`
	// Children is how many files a picked folder contributed.
	Children int    `json:"children,omitempty"`
	Error    string `json:"error,omitempty"`
	// Code is the Drive storage reason (blob.Reason's code) when the file
	// could not be kept because the learner's Drive refused it, so the page
	// shows the reason and "Reconnect Google Drive" (drive-user-storage
	// phase 5).
	Code string `json:"code,omitempty"`
}

// ImportReport is the whole result of one Picker submission.
type ImportReport struct {
	KBID     uuid.UUID       `json:"kb_id"`
	Imported int             `json:"imported"`
	Failed   int             `json:"failed"`
	Items    []ImportOutcome `json:"items"`
}

// ImportPicked records grants for what the user picked and imports the files.
//
// One item's failure never stops the rest. A Picker selection is a batch the
// user assembled by hand; failing the whole request because the fourth file is
// a Google Form would throw away three successful imports and tell them
// nothing about which one was the problem. Every item reports its own outcome.
func (s *Service) ImportPicked(ctx context.Context, userID, kbID uuid.UUID, picked []Picked) (*ImportReport, error) {
	if err := s.authz.OwnsKB(ctx, userID, kbID); err != nil {
		return nil, err
	}
	if len(picked) == 0 {
		return nil, errors.New("drive: nothing was picked")
	}
	if len(picked) > MaxPicks {
		return nil, fmt.Errorf("drive: %d items picked; the limit is %d per import", len(picked), MaxPicks)
	}
	// A connection must exist before any of this. Without the check the first
	// failure would be a token error attributed to the first file, which reads
	// as "that PDF is broken".
	if _, err := s.store.GetConnection(ctx, userID); err != nil {
		return nil, err
	}

	client := s.client(userID)
	report := &ImportReport{KBID: kbID, Items: []ImportOutcome{}}

	seen := make(map[string]bool, len(picked))
	for _, p := range picked {
		id := strings.TrimSpace(p.ID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		s.importOne(ctx, client, userID, kbID, id, report, seen)
	}
	return report, nil
}

// importOne resolves one picked id and routes it to the file or folder path.
func (s *Service) importOne(ctx context.Context, client *Client, userID, kbID uuid.UUID,
	fileID string, report *ImportReport, seen map[string]bool) {

	meta, err := client.GetFile(ctx, fileID)
	if err != nil {
		// A fresh pick that is already forbidden is unusual but possible (the
		// user revoked between picking and posting). It is recorded as a grant
		// in the re-pick state rather than dropped, so the KB page can say what
		// happened instead of the file silently not appearing.
		report.add(s.failPick(ctx, userID, kbID, fileID, "", KindFile, err))
		return
	}

	if meta.IsFolder() {
		s.importFolder(ctx, client, userID, kbID, *meta, report, seen)
		return
	}
	report.add(s.importFile(ctx, client, userID, kbID, *meta, ""))
}

// importFolder records the folder grant and imports its children.
func (s *Service) importFolder(ctx context.Context, client *Client, userID, kbID uuid.UUID,
	folder File, report *ImportReport, seen map[string]bool) {

	folderGrant, err := s.store.UpsertGrant(ctx, Grant{
		UserID: userID, KBID: kbID, FileID: folder.ID, Kind: KindFolder,
		Name: folder.Name, MIME: folder.MimeType, State: GrantActive,
	})
	if err != nil {
		report.add(ImportOutcome{FileID: folder.ID, Name: folder.Name, Kind: KindFolder,
			State: GrantActive, Error: "this folder could not be recorded"})
		slog.Error("drive: recording a folder grant failed", "error", err, "user", userID, "kb", kbID)
		return
	}

	children, err := client.ListFolderChildren(ctx, folder.ID)
	if err != nil {
		outcome := ImportOutcome{FileID: folder.ID, Name: folder.Name, Kind: KindFolder, State: GrantActive}
		if IsForbidden(err) {
			_ = s.store.SetGrantState(ctx, userID, folderGrant.ID, GrantRePick, rePickReason)
			outcome.State = GrantRePick
			outcome.Error = rePickReason
		} else {
			outcome.Error = "this folder's contents could not be listed"
			slog.Error("drive: listing folder children failed", "error", err, "user", userID)
		}
		report.add(outcome)
		return
	}

	if len(children) > MaxFolderChildren {
		report.add(ImportOutcome{FileID: folder.ID, Name: folder.Name, Kind: KindFolder, State: GrantActive,
			Error: fmt.Sprintf("this folder has %d files; the limit is %d per import", len(children), MaxFolderChildren)})
		return
	}

	imported := 0
	for _, child := range children {
		if child.Trashed || seen[child.ID] {
			continue
		}
		seen[child.ID] = true
		if child.IsFolder() {
			// Nested folders are NOT expanded, and the outcome says so rather
			// than leaving the user to notice the absence. Recursion here would
			// make one click's cost unbounded, and the scope question the spike
			// left open applies to every level of it.
			report.add(ImportOutcome{FileID: child.ID, Name: child.Name, Kind: KindFolder,
				State: GrantActive, Error: "nested folders are not expanded — pick this folder itself to add it"})
			continue
		}
		outcome := s.importFile(ctx, client, userID, kbID, child, folder.ID)
		report.add(outcome)
		if outcome.Error == "" {
			imported++
		}
	}

	report.Items = append(report.Items, ImportOutcome{
		FileID: folder.ID, Name: folder.Name, Kind: KindFolder,
		State: GrantActive, Children: imported,
	})
}

// importFile records a file grant and pushes the file into the pipeline.
//
// The grant is written BEFORE the content is fetched and its md5/modifiedTime
// are recorded only AFTER a successful import. That order is what makes a
// failed import retry: a grant carrying the new checksum of a file that never
// got indexed would look unchanged to the next sync, and the document would
// stay missing forever with nothing reporting why.
func (s *Service) importFile(ctx context.Context, client *Client, userID, kbID uuid.UUID,
	f File, parentFolderID string) ImportOutcome {

	outcome := ImportOutcome{FileID: f.ID, Name: f.Name, Kind: KindFile, State: GrantActive}

	grant, err := s.store.UpsertGrant(ctx, Grant{
		UserID: userID, KBID: kbID, FileID: f.ID, Kind: KindFile,
		ParentFileID: parentFolderID, Name: f.Name, MIME: f.MimeType, State: GrantActive,
	})
	if err != nil {
		slog.Error("drive: recording a file grant failed", "error", err, "user", userID, "kb", kbID)
		outcome.Error = "this file could not be recorded"
		return outcome
	}

	docID, err := s.importGrantedFile(ctx, client, userID, kbID, *grant, f)
	if err != nil {
		outcome.State, outcome.Error = s.recordImportFailure(ctx, userID, *grant, err)
		outcome.Code = importCode(err)
		return outcome
	}
	outcome.DocumentID = &docID
	return outcome
}

// importGrantedFile fetches one file's content and hands it to the pipeline.
func (s *Service) importGrantedFile(ctx context.Context, client *Client, userID, kbID uuid.UUID,
	grant Grant, f File) (uuid.UUID, error) {

	filename, data, err := fetchContent(ctx, client, f, s.maxBytes())
	if err != nil {
		return uuid.Nil, err
	}
	if len(data) == 0 {
		return uuid.Nil, errors.New("drive: this file is empty")
	}

	docID, err := s.importer.Import(ctx, ImportRequest{
		UserID: userID, KBID: kbID, ExternalID: f.ID, Filename: filename, Data: data,
	})
	if err != nil {
		return uuid.Nil, err
	}

	// Checksum and timestamp are recorded together with the document id, and
	// only now. See importFile's comment for why the order matters.
	if err := s.store.RecordGrantSynced(ctx, userID, grant.ID, docID, f.MD5Checksum, f.ModifiedTime); err != nil {
		slog.Error("drive: recording a synced grant failed", "error", err, "user", userID, "grant", grant.ID)
	}
	return docID, nil
}

const rePickReason = "Google no longer lets this app read this file. Pick it again to restore access."

// recordImportFailure writes the right grant state for a failed import.
//
// The one distinction that matters: a 403 means the app has LOST the file and
// only the user can restore it, so the grant is marked re-pick and the sync
// stops asking. Everything else is a failure worth retrying, so the grant stays
// active and carries the reason.
func (s *Service) recordImportFailure(ctx context.Context, userID uuid.UUID, grant Grant, cause error) (state, message string) {
	state, message = GrantActive, userFacingImportError(cause)
	if IsForbidden(cause) {
		state, message = GrantRePick, rePickReason
	}
	if err := s.store.SetGrantState(ctx, userID, grant.ID, state, message); err != nil {
		slog.Error("drive: recording a grant failure failed", "error", err, "user", userID, "grant", grant.ID)
	}
	slog.Warn("drive: importing a file failed", "error", cause, "user", userID, "grant", grant.ID, "state", state)
	return state, message
}

// failPick records a pick that could not even be resolved.
func (s *Service) failPick(ctx context.Context, userID, kbID uuid.UUID, fileID, name, kind string, cause error) ImportOutcome {
	outcome := ImportOutcome{FileID: fileID, Name: name, Kind: kind, State: GrantActive,
		Error: userFacingImportError(cause), Code: importCode(cause)}
	if !IsForbidden(cause) {
		slog.Error("drive: resolving a picked file failed", "error", cause, "user", userID)
		return outcome
	}

	outcome.State, outcome.Error = GrantRePick, rePickReason
	if _, err := s.store.UpsertGrant(ctx, Grant{
		UserID: userID, KBID: kbID, FileID: fileID, Kind: kind, Name: name,
		State: GrantRePick, LastError: rePickReason,
	}); err != nil {
		slog.Error("drive: recording a forbidden pick failed", "error", err, "user", userID)
	}
	return outcome
}

// userFacingImportError keeps Google's own wording out of the UI.
//
// A Drive error message can quote a file name or an account this app has no
// business repeating back, and a raw error string from the pipeline can carry a
// SQL statement. What the user gets is a sentence they can act on; the cause
// goes to the log with the ids.
func userFacingImportError(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, ErrUnsupportedDriveType):
		return strings.TrimPrefix(err.Error(), "drive: ")
	case errors.Is(err, ErrNeedsReconnect):
		return "Drive needs to be reconnected."
	case IsForbidden(err):
		return rePickReason
	}
	if reason, ok := blob.Unavailable(err); ok {
		return reason.Message
	}
	// The pipeline's own refusals — unsupported type, too many pages, a
	// duplicate — are already written for a person, so they pass through.
	if msg := err.Error(); strings.HasPrefix(msg, "knowledge: ") || strings.HasPrefix(msg, "parse: ") {
		return strings.TrimPrefix(strings.TrimPrefix(msg, "knowledge: "), "parse: ")
	}
	return "this file could not be imported"
}

// importCode is the storage reason's code for a failed import. A connection
// Google stopped honouring is drive_reconnect whichever side met it: reading
// the picked file, or keeping its copy in the learner's Drive. Reconnecting
// is the one fix for both.
func importCode(err error) string {
	if reason, ok := blob.Unavailable(err); ok {
		return reason.Code
	}
	if errors.Is(err, ErrNeedsReconnect) {
		return blob.ReasonReconnect.Code
	}
	return ""
}

func (s *Service) maxBytes() int64 {
	if s.maxImportBytes > 0 {
		return s.maxImportBytes
	}
	return defaultMaxImportBytes
}

func (r *ImportReport) add(o ImportOutcome) {
	r.Items = append(r.Items, o)
	if o.Error != "" {
		r.Failed++
		return
	}
	if o.Kind == KindFile {
		r.Imported++
	}
}
