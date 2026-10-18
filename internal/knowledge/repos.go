package knowledge

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"path"
	"sort"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/github"
)

// repos.go — "Add a repository": a GitHub repository's files as documents.
//
// A sync is one sync_repo job: resolve the branch to its latest commit, and
// stop there if the documents already reflect it (DeepTutor's rule); else
// read the tarball once, store each kept file whose bytes changed, and mark
// the files that are gone. Documentation files are parsed as Markdown; code
// files are chunked on blank lines and cited by line range.

// NewRepo is "Add a repository" as the learner filled it in.
type NewRepo struct {
	URL        string
	Branch     string
	Path       string
	Extensions []string
	Ignore     []string
}

const maxExtensions = 40

// AddRepo records a repository and queues its first sync.
func (s *Service) AddRepo(ctx context.Context, userID, kbID uuid.UUID, in NewRepo) (*Repo, uuid.UUID, error) {
	deps, err := s.sourceDeps()
	if err != nil {
		return nil, uuid.Nil, err
	}
	if deps.GitHub == nil {
		return nil, uuid.Nil, ErrSourcesUnavailable
	}
	ref, err := github.ParseURL(in.URL)
	if err != nil {
		return nil, uuid.Nil, linkErr(LinkBadURL, err.Error(), nil)
	}
	branch := strings.TrimSpace(in.Branch)
	if branch == "" {
		branch = ref.Branch
	}
	if branch != "" && !github.ValidBranch(branch) {
		return nil, uuid.Nil, linkErr(LinkBadURL, "that branch name is not valid", nil)
	}
	rawPath := in.Path
	if strings.TrimSpace(rawPath) == "" {
		rawPath = ref.Path
	}
	prefix, ok := github.CleanPrefix(rawPath)
	if !ok {
		return nil, uuid.Nil, linkErr(LinkBadURL, "that folder is not a path inside the repository", nil)
	}
	exts, err := cleanExtensions(in.Extensions)
	if err != nil {
		return nil, uuid.Nil, err
	}
	var ignore []string
	for _, p := range in.Ignore {
		if p = strings.TrimSpace(p); p != "" {
			ignore = append(ignore, p)
		}
	}
	if err := github.ValidatePatterns(ignore); err != nil {
		return nil, uuid.Nil, linkErr(LinkBadURL, err.Error(), nil)
	}
	if ignore == nil {
		ignore = []string{}
	}

	repo, err := deps.Store.CreateRepo(ctx, Repo{
		UserID: userID, KBID: kbID, Owner: ref.Owner, Name: ref.Name, Branch: branch,
		PathPrefix: prefix, Extensions: exts, IgnorePaths: ignore,
	})
	if err != nil {
		return nil, uuid.Nil, err
	}
	jobID, err := s.queueRepoSync(ctx, userID, repo.ID)
	if err != nil {
		return nil, uuid.Nil, err
	}
	repo.Status, repo.JobID = RepoQueued, &jobID
	return repo, jobID, nil
}

// cleanExtensions lowercases the file types, adds the dot, and defaults to
// documentation types.
func cleanExtensions(in []string) ([]string, error) {
	if len(in) == 0 {
		return append([]string{}, github.DocExtensions...), nil
	}
	if len(in) > maxExtensions {
		return nil, linkErr(LinkBadURL, fmt.Sprintf("at most %d file types", maxExtensions), nil)
	}
	seen := map[string]bool{}
	var out []string
	for _, e := range in {
		e = strings.ToLower(strings.TrimSpace(e))
		if e == "" {
			continue
		}
		if !strings.HasPrefix(e, ".") {
			e = "." + e
		}
		if len(e) > 16 || strings.ContainsAny(e[1:], "./\\* ") {
			return nil, linkErr(LinkBadURL, fmt.Sprintf("%q is not a file type", e), nil)
		}
		if !seen[e] {
			seen[e] = true
			out = append(out, e)
		}
	}
	if len(out) == 0 {
		return append([]string{}, github.DocExtensions...), nil
	}
	sort.Strings(out)
	return out, nil
}

// ResyncRepo checks a repository for a new commit now, because the learner
// asked.
func (s *Service) ResyncRepo(ctx context.Context, userID, repoID uuid.UUID) (uuid.UUID, error) {
	if _, err := s.sourceDeps(); err != nil {
		return uuid.Nil, err
	}
	return s.queueRepoSync(ctx, userID, repoID)
}

func (s *Service) queueRepoSync(ctx context.Context, userID, repoID uuid.UUID) (uuid.UUID, error) {
	deps := s.sources
	repo, err := deps.Store.GetRepo(ctx, userID, repoID)
	if err != nil {
		return uuid.Nil, err
	}
	if (repo.Status == RepoQueued && repo.JobID != nil) || repo.Status == RepoSyncing {
		return uuid.Nil, linkErr(LinkBusy, "this repository is already being synced", nil)
	}
	jobID, err := s.jobs.Enqueue(ctx, userID, JobSyncRepo, SourceJobPayload{RepoID: repoID}, 2)
	if err != nil {
		_ = deps.Store.SettleRepo(ctx, userID, repoID, "the sync could not be queued. Try again.")
		return uuid.Nil, err
	}
	if err := deps.Store.QueueRepoSync(ctx, userID, repoID, jobID); err != nil {
		if deps.Cancel != nil {
			_, _ = deps.Cancel.RequestCancel(ctx, userID, jobID)
		}
		if errors.Is(err, ErrDocumentFinal) {
			return uuid.Nil, linkErr(LinkBusy, "this repository is already being synced", err)
		}
		return uuid.Nil, err
	}
	return jobID, nil
}

// RepoSyncResult is what a sync did.
type RepoSyncResult struct {
	// Skipped: the latest commit is the one the documents reflect.
	Skipped                    bool
	Added, Changed, Unchanged  int
	Removed, Refused, Oversize int
	Capped                     bool
}

// SyncRepo is the sync_repo job. A repository deleted meanwhile, or one a
// newer job owns, is terminal.
func (s *Service) SyncRepo(ctx context.Context, userID, repoID, jobID uuid.UUID) (*RepoSyncResult, error) {
	deps, err := s.sourceDeps()
	if err != nil || deps.GitHub == nil {
		return nil, errTerminal{ErrSourcesUnavailable}
	}
	repo, err := deps.Store.GetRepo(ctx, userID, repoID)
	if err != nil {
		if errors.Is(err, authz.ErrNoAccess) {
			return nil, errTerminal{err}
		}
		return nil, err
	}
	if repo.JobID == nil || *repo.JobID != jobID || (repo.Status != RepoQueued && repo.Status != RepoSyncing) {
		return nil, errTerminal{errors.New("knowledge: the repository is no longer waiting for this sync")}
	}
	if err := deps.Store.BeginRepoSync(ctx, userID, repoID); err != nil {
		return nil, err
	}

	token := ""
	if deps.Tokens != nil {
		if token, err = deps.Tokens.GitHubToken(ctx, userID); err != nil {
			return nil, err
		}
	}
	head, err := deps.GitHub.LatestCommit(ctx, repo.Owner, repo.Name, repo.Branch, token)
	if err != nil {
		return nil, repoError(err)
	}
	res := &RepoSyncResult{}
	if head.SHA == repo.CommitSHA {
		res.Skipped = true
		return res, deps.Store.FinishRepoSync(ctx, userID, repoID, head.Branch, head.SHA, repo.Note, s.now())
	}

	ignore, err := github.NewIgnore(github.DefaultIgnore, repo.IgnorePaths)
	if err != nil {
		return nil, errTerminal{linkErr(LinkBadURL, err.Error(), err)}
	}
	existing, err := deps.Store.GroupDocuments(ctx, userID, nil, &repoID)
	if err != nil {
		return nil, err
	}
	byPath := make(map[string]*Document, len(existing))
	for i := range existing {
		byPath[existing[i].SourcePath] = &existing[i]
	}
	seen := map[string]bool{}

	rep, err := deps.GitHub.Import(ctx, repo.Owner, repo.Name, head.SHA, token, github.Filter{
		Prefix: repo.PathPrefix, Extensions: repo.Extensions, Ignore: ignore,
	}, func(f github.File) error {
		seen[f.Path] = true
		outcome, err := s.storeRepoFile(ctx, repo, head, f, byPath[f.Path])
		switch outcome {
		case PageAdded:
			res.Added++
		case PageChanged:
			res.Changed++
		case PageUnchanged:
			res.Unchanged++
		}
		return err
	})
	if err != nil {
		return nil, repoError(err)
	}
	res.Refused, res.Oversize, res.Capped = len(rep.Refused), len(rep.Skipped), rep.Capped
	for _, r := range rep.Refused {
		slog.Info("knowledge: refused an unsafe repository entry", "repo", repoID, "entry", r)
	}

	// A file past the cap was never read, so absence proves nothing then.
	if !rep.Capped {
		now := s.now()
		for p, doc := range byPath {
			if seen[p] || doc.RemovedAt != nil {
				continue
			}
			if err := deps.Store.SetRemoved(ctx, userID, doc.ID, &now); err != nil {
				return nil, err
			}
			res.Removed++
		}
	}
	return res, deps.Store.FinishRepoSync(ctx, userID, repoID, head.Branch, head.SHA, repoNote(rep), s.now())
}

// repoNote says what the import left out, in one line.
func repoNote(rep *github.Report) string {
	var parts []string
	if rep.Capped {
		parts = append(parts, fmt.Sprintf("Stopped at %d files or 100 MB; choose a folder or fewer file types to import the rest.", rep.Imported))
	}
	if n := len(rep.Skipped); n > 0 {
		parts = append(parts, fmt.Sprintf("%d files over 2 MB or not text were skipped.", n))
	}
	if n := len(rep.Refused); n > 0 {
		parts = append(parts, fmt.Sprintf("%d unsafe entries (links or paths outside the repository) were refused.", n))
	}
	return strings.Join(parts, " ")
}

// storeRepoFile writes one file as its document and says what happened.
func (s *Service) storeRepoFile(ctx context.Context, repo *Repo, head github.Head, f github.File, doc *Document) (string, error) {
	userID := repo.UserID
	digest := blob.Digest(f.Data)
	if doc != nil {
		if doc.SHA256 == digest {
			if doc.RemovedAt != nil {
				return PageUnchanged, s.sources.Store.SetRemoved(ctx, userID, doc.ID, nil)
			}
			return PageUnchanged, nil
		}
		if _, err := s.blobs.PutOriginal(ctx, userID, f.Data); err != nil {
			return "", err
		}
		updated, err := s.links.Store.ReplaceLinkContent(ctx, userID, doc.ID, LinkContent{
			MIME: doc.MIME, Bytes: int64(len(f.Data)), SHA256: digest, PageCount: 1,
			From: []string{StatusReady, StatusFailed},
		})
		if err != nil {
			s.dropOriginalIfUnused(ctx, userID, digest)
			if errors.Is(err, ErrDocumentFinal) || errors.Is(err, authz.ErrNoAccess) {
				// Still parsing (compared next time), or deleted meanwhile.
				return PageUnchanged, nil
			}
			return "", err
		}
		s.dropOriginalIfUnused(ctx, userID, doc.SHA256)
		_, err = s.queueParse(ctx, updated)
		return PageChanged, err
	}

	if _, err := s.blobs.PutOriginal(ctx, userID, f.Data); err != nil {
		return "", err
	}
	mime, unit := "text/markdown", PageUnitPage
	if isCodeFile(f.Path) {
		mime, unit = "text/plain", PageUnitLine
	}
	repoID := repo.ID
	now := s.now()
	created, err := s.links.Store.CreateLinkDocument(ctx, Document{
		UserID: userID, KBID: repo.KBID, SourceKind: SourceRepoFile, RepoID: &repoID,
		SourceURL: repoFileURL(repo, head.Branch, f.Path), SourcePath: f.Path,
		Title: documentTitle(f.Path), MIME: mime, Bytes: int64(len(f.Data)), SHA256: digest,
		PageCount: 1, PageUnit: unit, LastSyncedAt: &now,
	})
	if err != nil {
		s.dropOriginalIfUnused(ctx, userID, digest)
		if IsDuplicateDocument(err) {
			// The same file through another repository entry of this KB.
			return "", nil
		}
		return "", err
	}
	_, err = s.queueParse(ctx, created)
	return PageAdded, err
}

// repoFileURL is a file's stable address on GitHub: by branch, not commit,
// so it identifies the file across syncs.
func repoFileURL(repo *Repo, branch, p string) string {
	segs := strings.Split(p, "/")
	for i, seg := range segs {
		segs[i] = url.PathEscape(seg)
	}
	return fmt.Sprintf("https://github.com/%s/%s/blob/%s/%s", repo.Owner, repo.Name,
		url.PathEscape(branch), strings.Join(segs, "/"))
}

// isCodeFile reports whether a repository file is code (chunked by lines)
// rather than documentation (parsed as Markdown).
func isCodeFile(p string) bool {
	ext := strings.ToLower(path.Ext(p))
	for _, d := range github.DocExtensions {
		if ext == d {
			return false
		}
	}
	return true
}

func repoError(err error) error {
	var ge *github.Error
	if errors.As(err, &ge) {
		le := linkErr(LinkFetchFailed, ge.Msg, nil)
		switch ge.Code {
		case github.CodeNotFound, github.CodeBadToken, github.CodeEmpty, github.CodeTooLarge, github.CodeBadArchive:
			return errTerminal{le}
		}
		return le
	}
	return err
}

// FailRepoSync settles a sync that will not be retried. The documents keep
// what the last good sync stored.
func (s *Service) FailRepoSync(ctx context.Context, userID, repoID uuid.UUID, cause error) {
	deps, err := s.sourceDeps()
	if err != nil {
		return
	}
	reason := "the sync stopped before it finished. Try a re-sync."
	var le *LinkError
	if errors.As(cause, &le) {
		reason = le.Msg
	}
	if err := deps.Store.SettleRepo(context.WithoutCancel(ctx), userID, repoID, reason); err != nil {
		slog.Warn("knowledge: could not settle a repository sync", "repo", repoID, "error", err)
	}
}
