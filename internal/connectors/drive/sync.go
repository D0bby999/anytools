package drive

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
)

// sync.go — keeping granted files current through `changes.list`.
//
// The feed is account-wide and token-based: ask Drive for everything that has
// changed since a checkpoint, get a page of changes and a new checkpoint. Three
// things about it are not obvious and all three are load-bearing.
//
//  1. The feed reports changes to the WHOLE account, most of which are files
//     this app has never seen. Only changes matching an active grant are acted
//     on. That is also what makes AC2's fallback wording true: a file dropped
//     into a picked folder shows up in this feed, and is deliberately NOT
//     imported, because nobody has established that the app may read it.
//
//  2. A stored token older than Drive's retained history gets a 410. The only
//     recovery is a fresh baseline, and a fresh baseline means the changes in
//     between are gone — so after one, every grant is re-checked with files.get
//     rather than assumed unchanged.
//
//  3. A 403 insufficientFilePermissions is NOT a token problem. It means the
//     app has lost the file and only the user can give it back. Treating it as
//     a Gone would re-baseline the change feed on a loop and never say the one
//     thing that would fix it.

// SyncOutcome is what happened to one granted file.
type SyncOutcome struct {
	FileID     string     `json:"file_id"`
	Name       string     `json:"name"`
	State      string     `json:"state"`
	DocumentID *uuid.UUID `json:"document_id,omitempty"`
	Error      string     `json:"error,omitempty"`
}

// SyncReport is the result of one poll.
type SyncReport struct {
	// Baselined is true when this run only established a starting checkpoint.
	// It reports no changes because it genuinely has no history to compare
	// against — saying "0 changes" without this flag would read as "nothing
	// happened in your Drive", which is a different claim.
	Baselined bool `json:"baselined"`
	// Rebaselined is true when a 410 forced a fresh checkpoint and every grant
	// was re-checked directly.
	Rebaselined bool `json:"rebaselined"`
	// Checked is how many grants this run compared against Drive.
	Checked int `json:"checked"`
	// Reimported is how many documents were sent back through the pipeline.
	// AC2's test reads this number: editing one Doc must make it exactly 1.
	Reimported int           `json:"reimported"`
	RePick     int           `json:"re_pick"`
	Removed    int           `json:"removed"`
	Failed     int           `json:"failed"`
	Items      []SyncOutcome `json:"items"`
}

// Sync polls the change feed and re-imports what actually changed.
func (s *Service) Sync(ctx context.Context, userID uuid.UUID) (*SyncReport, error) {
	conn, err := s.store.GetConnection(ctx, userID)
	if err != nil {
		return nil, err
	}
	if conn.NeedsReconnect {
		return nil, ErrNeedsReconnect
	}

	state, err := s.store.GetSyncState(ctx, userID)
	if err != nil {
		return nil, err
	}
	if state == nil {
		state = &SyncState{UserID: userID}
	}

	client := s.client(userID)
	report := &SyncReport{Items: []SyncOutcome{}}

	// First run: establish a checkpoint and stop. Importing everything visible
	// would be wrong — the grants were imported when they were picked.
	if state.StartPageToken == "" {
		token, err := client.GetStartPageToken(ctx)
		if err != nil {
			return nil, s.recordSyncError(ctx, *state, err)
		}
		state.StartPageToken = token
		report.Baselined = true
		return report, s.saveSyncOK(ctx, *state)
	}

	res, err := client.SyncChanges(ctx, state.StartPageToken)
	if err != nil {
		return nil, s.recordSyncError(ctx, *state, err)
	}

	grants, err := s.store.ListActiveFileGrants(ctx, userID)
	if err != nil {
		return nil, err
	}

	if res.Rebaselined {
		report.Rebaselined = true
		state.Rebaselines++
		slog.Warn("drive: the change token was too old; re-baselining and re-checking every grant",
			"user", userID, "grants", len(grants))
		s.fullPass(ctx, client, userID, grants, report)
	} else {
		s.applyChanges(ctx, client, userID, grants, res.Changes, report)
	}

	state.StartPageToken = res.NextToken
	return report, s.saveSyncOK(ctx, *state)
}

// applyChanges acts on the changes that touch a granted file.
func (s *Service) applyChanges(ctx context.Context, client *Client, userID uuid.UUID,
	grants []Grant, changes []Change, report *SyncReport) {

	byFileID := make(map[string]Grant, len(grants))
	for _, g := range grants {
		byFileID[g.FileID] = g
	}

	// Drive can report the same file more than once in one drain (several
	// edits, several pages). Re-importing it twice would run the whole parse
	// pipeline for the second copy of the same bytes.
	done := make(map[string]bool, len(changes))

	for _, ch := range changes {
		grant, ok := byFileID[ch.FileID]
		if !ok || done[ch.FileID] {
			continue
		}
		done[ch.FileID] = true
		report.Checked++

		if ch.Removed || ch.File == nil || ch.File.Trashed {
			// A removal change carries no file object at all, which is why the
			// nil check sits beside the flag rather than after it.
			s.markRemoved(ctx, userID, grant, report)
			continue
		}
		if !fileChanged(grant, *ch.File) {
			continue
		}
		s.reimport(ctx, client, userID, grant, *ch.File, report)
	}
}

// fullPass re-checks every grant directly. Used after a 410, when the change
// feed's history between the old and new tokens no longer exists.
func (s *Service) fullPass(ctx context.Context, client *Client, userID uuid.UUID,
	grants []Grant, report *SyncReport) {

	for _, g := range grants {
		report.Checked++
		meta, err := client.GetFile(ctx, g.FileID)
		if err != nil {
			if IsForbidden(err) {
				s.markRePick(ctx, userID, g, report)
				continue
			}
			report.Failed++
			report.Items = append(report.Items, SyncOutcome{FileID: g.FileID, Name: g.Name,
				State: g.State, Error: "this file could not be checked"})
			slog.Error("drive: re-checking a grant failed", "error", err, "user", userID, "grant", g.ID)
			continue
		}
		if meta.Trashed {
			s.markRemoved(ctx, userID, g, report)
			continue
		}
		if !fileChanged(g, *meta) {
			continue
		}
		s.reimport(ctx, client, userID, g, *meta, report)
	}
}

// fileChanged decides whether a granted file's content moved.
//
// md5 when Drive supplies one, modifiedTime otherwise — and the fallback is not
// a nicety. A Google Doc carries NO md5Checksum (asserted against the recorded
// files.list fixture), so comparing md5 alone would see "" != "" as unchanged
// forever and a Doc would never re-import. Comparing modifiedTime alone would
// re-import a binary whose timestamp moved without its bytes changing, spending
// the user's parse and embed quota on an identical file.
//
// A grant with neither recorded is one whose import never succeeded, and it
// counts as changed so the next sync retries it.
func fileChanged(g Grant, f File) bool {
	if f.MD5Checksum != "" {
		return f.MD5Checksum != g.MD5
	}
	if f.ModifiedTime != "" {
		return f.ModifiedTime != g.ModifiedTime
	}
	return g.MD5 == "" && g.ModifiedTime == ""
}

// reimport sends one changed file back through the pipeline.
func (s *Service) reimport(ctx context.Context, client *Client, userID uuid.UUID,
	g Grant, f File, report *SyncReport) {

	docID, err := s.importGrantedFile(ctx, client, userID, g.KBID, g, f)
	if err != nil {
		state, msg := s.recordImportFailure(ctx, userID, g, err)
		if state == GrantRePick {
			report.RePick++
		} else {
			report.Failed++
		}
		report.Items = append(report.Items, SyncOutcome{FileID: g.FileID, Name: g.Name, State: state, Error: msg})
		return
	}
	report.Reimported++
	report.Items = append(report.Items, SyncOutcome{FileID: g.FileID, Name: g.Name,
		State: GrantActive, DocumentID: &docID})
}

func (s *Service) markRemoved(ctx context.Context, userID uuid.UUID, g Grant, report *SyncReport) {
	const reason = "This file was removed from Drive. Its document stays in the knowledge base until you delete it."
	if err := s.store.SetGrantState(ctx, userID, g.ID, GrantRemoved, reason); err != nil {
		slog.Error("drive: marking a grant removed failed", "error", err, "user", userID, "grant", g.ID)
	}
	report.Removed++
	report.Items = append(report.Items, SyncOutcome{FileID: g.FileID, Name: g.Name, State: GrantRemoved, Error: reason})
}

func (s *Service) markRePick(ctx context.Context, userID uuid.UUID, g Grant, report *SyncReport) {
	if err := s.store.SetGrantState(ctx, userID, g.ID, GrantRePick, rePickReason); err != nil {
		slog.Error("drive: marking a grant for re-picking failed", "error", err, "user", userID, "grant", g.ID)
	}
	report.RePick++
	report.Items = append(report.Items, SyncOutcome{FileID: g.FileID, Name: g.Name, State: GrantRePick, Error: rePickReason})
}

// saveSyncOK checkpoints a successful poll.
func (s *Service) saveSyncOK(ctx context.Context, st SyncState) error {
	now := s.now()
	st.LastSyncAt = &now
	st.LastError = ""
	return s.store.SaveSyncState(ctx, st)
}

// recordSyncError stores the failure WITHOUT advancing the checkpoint.
//
// Advancing it would skip every change between the old token and the failure,
// permanently: those changes are only ever offered once. The token stays where
// it is so the next run asks the same question again.
func (s *Service) recordSyncError(ctx context.Context, st SyncState, cause error) error {
	st.LastError = userFacingSyncError(cause)
	if err := s.store.SaveSyncState(ctx, st); err != nil {
		slog.Error("drive: recording a sync failure failed", "error", err, "user", st.UserID)
	}
	return cause
}

func userFacingSyncError(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, ErrNeedsReconnect):
		return "Drive needs to be reconnected."
	case errors.Is(err, ErrNotConfigured):
		return "Drive is not configured on this deployment."
	}
	return "The last sync with Google Drive did not finish."
}

// SyncAll polls every connected user. The 15-minute job calls it.
//
// One user's failure never stops the others: a single revoked grant must not
// stop everyone else's documents from staying current. Each failure is logged
// against its user and the loop continues.
func (s *Service) SyncAll(ctx context.Context) (users, failed int) {
	ids, err := s.store.ListConnectedUsers(ctx)
	if err != nil {
		slog.Error("drive: listing connected users failed", "error", err)
		return 0, 0
	}
	for _, id := range ids {
		select {
		case <-ctx.Done():
			return users, failed
		default:
		}
		users++
		if _, err := s.Sync(ctx, id); err != nil {
			failed++
			// ErrNeedsReconnect is already recorded on the connection and shown
			// in readiness; logging it at error level every quarter hour for
			// every disconnected user would bury everything else.
			if errors.Is(err, ErrNeedsReconnect) {
				slog.Info("drive: skipping a user whose grant Google rejected", "user", id)
				continue
			}
			slog.Error("drive: sync failed", "error", err, "user", id)
		}
	}
	return users, failed
}

// SyncInterval is how often the background job polls. Fifteen minutes is the
// plan's number and is comfortably inside Drive's change-history window, so a
// running instance should never see a 410 — one that does has been down.
const SyncInterval = 15 * time.Minute
