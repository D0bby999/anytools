package knowledge

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/crawl"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/security"
)

// sites.go — "Add a site": a documentation site crawled into documents.
//
// A crawl is a crawl_site job of one unit per page (jobs.RunUnits). The
// frontier lives in site_pages: unit i is the page whose crawl_ord is i, and
// a page's links are appended at the next ords as it is read, so a retried
// job resumes at the first unfinished page and a cancel stops after the page
// in flight. robots.txt is read once when the crawl begins and stored with
// the site; every page and every discovered link is checked against it.

// AddSite records a site and queues its first crawl.
func (s *Service) AddSite(ctx context.Context, userID, kbID uuid.UUID, rawURL string, depth, pages int) (*Site, uuid.UUID, error) {
	deps, err := s.sourceDeps()
	if err != nil {
		return nil, uuid.Nil, err
	}
	if len(strings.TrimSpace(rawURL)) > 2048 {
		return nil, uuid.Nil, linkErr(LinkBadURL, "that link is too long", nil)
	}
	u, err := canonicalWebURL(rawURL)
	if err != nil {
		return nil, uuid.Nil, err
	}
	if depth < 0 || depth > crawl.MaxDepth {
		return nil, uuid.Nil, linkErr(LinkBadURL, fmt.Sprintf("depth must be between 0 and %d", crawl.MaxDepth), nil)
	}
	if pages < 1 || pages > crawl.MaxPages {
		return nil, uuid.Nil, linkErr(LinkBadURL, fmt.Sprintf("the page limit must be between 1 and %d", crawl.MaxPages), nil)
	}
	scope := crawl.NewScope(u)
	site, err := deps.Store.CreateSite(ctx, Site{
		UserID: userID, KBID: kbID, StartURL: u.String(), PathPrefix: scope.Prefix,
		MaxDepth: depth, MaxPages: pages, Title: u.Host + strings.TrimSuffix(u.Path, "/"),
	})
	if err != nil {
		return nil, uuid.Nil, err
	}
	jobID, err := s.queueCrawl(ctx, userID, site.ID)
	if err != nil {
		return nil, uuid.Nil, err
	}
	site.Status, site.JobID = SiteQueued, &jobID
	return site, jobID, nil
}

// ResyncSite crawls a site again now, because the learner asked.
func (s *Service) ResyncSite(ctx context.Context, userID, siteID uuid.UUID) (uuid.UUID, error) {
	if _, err := s.sourceDeps(); err != nil {
		return uuid.Nil, err
	}
	return s.queueCrawl(ctx, userID, siteID)
}

// CancelSite asks a site's crawl to stop after the page in flight.
func (s *Service) CancelSite(ctx context.Context, userID, siteID uuid.UUID) error {
	deps, err := s.sourceDeps()
	if err != nil {
		return err
	}
	site, err := deps.Store.GetSite(ctx, userID, siteID)
	if err != nil {
		return err
	}
	if site.JobID == nil || (site.Status != SiteQueued && site.Status != SiteCrawling) || deps.Cancel == nil {
		return linkErr(LinkBusy, "this site is not being crawled", nil)
	}
	ok, err := deps.Cancel.RequestCancel(ctx, userID, *site.JobID)
	if err != nil {
		return err
	}
	if !ok {
		return linkErr(LinkBusy, "this site is not being crawled", nil)
	}
	return nil
}

// queueCrawl enqueues a crawl_site job and moves the site to queued.
func (s *Service) queueCrawl(ctx context.Context, userID, siteID uuid.UUID) (uuid.UUID, error) {
	deps := s.sources
	site, err := deps.Store.GetSite(ctx, userID, siteID)
	if err != nil {
		return uuid.Nil, err
	}
	// A new site is queued with no job yet; any other queued or crawling
	// site has a crawl on its way. The store re-checks under the row's lock.
	if (site.Status == SiteQueued && site.JobID != nil) || site.Status == SiteCrawling {
		return uuid.Nil, linkErr(LinkBusy, "this site is already being crawled", nil)
	}
	// Two attempts, resumable per page: a retry never fetches a page twice.
	jobID, err := s.jobs.Enqueue(ctx, userID, JobCrawlSite, SourceJobPayload{SiteID: siteID}, 2)
	if err != nil {
		_ = deps.Store.SettleSite(ctx, userID, siteID, SiteFailed, "the crawl could not be queued. Try again.")
		return uuid.Nil, err
	}
	if err := deps.Store.QueueSiteCrawl(ctx, userID, siteID, jobID); err != nil {
		if deps.Cancel != nil {
			_, _ = deps.Cancel.RequestCancel(ctx, userID, jobID)
		}
		if errors.Is(err, ErrDocumentFinal) {
			return uuid.Nil, linkErr(LinkBusy, "this site is already being crawled", err)
		}
		return uuid.Nil, err
	}
	return jobID, nil
}

// StartCrawl prepares a crawl_site job and returns how many pages its
// frontier holds. A queued site begins a generation (robots.txt read once,
// the frontier reset to the start URL); a crawling one is a retried job and
// resumes. A site deleted or settled meanwhile is terminal.
func (s *Service) StartCrawl(ctx context.Context, userID, siteID, jobID uuid.UUID) (int, error) {
	deps, err := s.sourceDeps()
	if err != nil {
		return 0, errTerminal{err}
	}
	site, err := deps.Store.GetSite(ctx, userID, siteID)
	if err != nil {
		if errors.Is(err, authz.ErrNoAccess) {
			return 0, errTerminal{err}
		}
		return 0, err
	}
	if site.JobID == nil || *site.JobID != jobID {
		return 0, errTerminal{errors.New("knowledge: a newer crawl owns this site")}
	}
	switch site.Status {
	case SiteQueued:
		start, err := url.Parse(site.StartURL)
		if err != nil {
			return 0, errTerminal{err}
		}
		body, found, err := crawl.FetchRobots(ctx, deps.Fetch, start)
		if err != nil {
			// A crawl reads many pages nobody picked one by one, so an
			// unreadable robots.txt stops it rather than being ignored.
			return 0, errTerminal{linkErr(LinkRobots, "the site's robots.txt could not be read, so the site was not crawled. Try again later.", err)}
		}
		var robots *string
		if found {
			robots = &body
		}
		if err := deps.Store.BeginCrawl(ctx, userID, siteID, robots); err != nil {
			return 0, err
		}
	case SiteCrawling:
	default:
		return 0, errTerminal{errors.New("knowledge: the site is no longer waiting for a crawl")}
	}
	return deps.Store.CrawlTotal(ctx, userID, siteID)
}

// CrawlTotal is how many pages the current generation's frontier holds.
func (s *Service) CrawlTotal(ctx context.Context, userID, siteID uuid.UUID) (int, error) {
	deps, err := s.sourceDeps()
	if err != nil {
		return 0, errTerminal{err}
	}
	return deps.Store.CrawlTotal(ctx, userID, siteID)
}

// CrawlPage is one unit: fetch the page at ord, add its in-scope links to the
// frontier, and store it as a document if its bytes are new. A page that
// fails is recorded on its row and the crawl goes on; only a cancelled
// context or a database error fails the unit.
func (s *Service) CrawlPage(ctx context.Context, userID, siteID uuid.UUID, ord int) error {
	deps, err := s.sourceDeps()
	if err != nil {
		return errTerminal{err}
	}
	site, err := deps.Store.GetSite(ctx, userID, siteID)
	if err != nil {
		if errors.Is(err, authz.ErrNoAccess) {
			return errTerminal{err}
		}
		return err
	}
	page, err := deps.Store.PageAt(ctx, userID, siteID, ord)
	if err != nil || page == nil {
		return err
	}
	result := func(status, reason string, docID *uuid.UUID) error {
		return deps.Store.SetPageResult(ctx, userID, siteID, page.URL, status, reason, docID)
	}

	u, err := url.Parse(page.URL)
	if err != nil {
		return result(PageSkipped, "the address could not be read", nil)
	}
	start, err := url.Parse(site.StartURL)
	if err != nil {
		return errTerminal{err}
	}
	scope := crawl.Scope{Scheme: start.Scheme, Host: start.Host, Prefix: site.PathPrefix}
	if site.RobotsTxt != nil && !crawl.Permits(*site.RobotsTxt, crawl.Agent, u) {
		return result(PageSkipped, "the site's robots.txt asks tools like AnyTools not to read this page", nil)
	}

	limiter := deps.Limiter
	if limiter == nil {
		limiter = crawl.Shared
	}
	release, err := limiter.Acquire(ctx, u.Host)
	if err != nil {
		return err
	}
	got, err := security.FetchPage(ctx, scope.Client(deps.Fetch), security.PageRequest{
		URL:       page.URL,
		Accept:    "text/html,application/xhtml+xml,application/pdf;q=0.9",
		UserAgent: linkUserAgent,
		Types:     webTypes,
	})
	release()
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var status *security.HTTPStatusError
		if errors.As(err, &status) && (status.Status == 404 || status.Status == 410) && page.DocumentID != nil {
			now := s.now()
			if err := deps.Store.SetRemoved(ctx, userID, *page.DocumentID, &now); err != nil {
				return err
			}
			return result(PageRemoved, "removed from the site", page.DocumentID)
		}
		if errors.Is(err, crawl.ErrOffScope) {
			return result(PageSkipped, "the page redirected outside the site", page.DocumentID)
		}
		return result(PageFailed, syncSentence(fetchLinkError(err)), page.DocumentID)
	}

	filename := "page.html"
	if got.MediaType == "application/pdf" {
		filename = "page.pdf"
	}
	_, mime, pageCount, err := s.checkFile(filename, got.Body)
	if err != nil {
		reason := "the page could not be read as HTML or PDF"
		if errors.Is(err, parse.ErrPageCapExceeded) {
			reason = err.Error()
		}
		return result(PageSkipped, reason, page.DocumentID)
	}

	if got.MediaType != "application/pdf" && page.Depth < site.MaxDepth {
		final := got.FinalURL
		if final == nil {
			final = u
		}
		var next []string
		for _, link := range crawl.Links(got.Body, final, scope) {
			if site.RobotsTxt != nil && !crawl.Permits(*site.RobotsTxt, crawl.Agent, link) {
				continue
			}
			next = append(next, link.String())
		}
		if len(next) > 0 {
			if _, err := deps.Store.AddFrontier(ctx, userID, siteID, next, page.Depth+1, site.MaxPages); err != nil {
				return err
			}
		}
	}

	title := ""
	if got.MediaType != "application/pdf" {
		title = htmlTitle(got.Body)
	}
	if title == "" {
		title = u.Host + strings.TrimSuffix(u.Path, "/")
	}
	title = documentTitle(title)
	if ord == 0 {
		if err := deps.Store.SetSiteTitle(ctx, userID, siteID, title); err != nil {
			return err
		}
	}
	return s.storeSitePage(ctx, site, page, got.Body, mime, pageCount, title)
}

// storeSitePage writes a fetched page as its document: new, changed, or
// unchanged (and no longer removed).
func (s *Service) storeSitePage(ctx context.Context, site *Site, page *SitePage, data []byte, mime string, pageCount int, title string) error {
	deps := s.sources
	userID := site.UserID
	result := func(status, reason string, docID *uuid.UUID) error {
		return deps.Store.SetPageResult(ctx, userID, site.ID, page.URL, status, reason, docID)
	}
	digest := blob.Digest(data)

	if page.DocumentID != nil {
		doc, err := s.store.GetDocument(ctx, userID, *page.DocumentID)
		switch {
		case err == nil && doc.SHA256 == digest:
			if doc.RemovedAt != nil {
				if err := deps.Store.SetRemoved(ctx, userID, doc.ID, nil); err != nil {
					return err
				}
			}
			return result(PageUnchanged, "", &doc.ID)
		case err == nil:
			if _, err := s.blobs.PutOriginal(ctx, userID, data); err != nil {
				return err
			}
			updated, err := s.links.Store.ReplaceLinkContent(ctx, userID, doc.ID, LinkContent{
				Title: title, MIME: mime, Bytes: int64(len(data)), SHA256: digest,
				PageCount: pageCount, From: []string{StatusReady, StatusFailed},
			})
			if err != nil {
				s.dropOriginalIfUnused(ctx, userID, digest)
				if errors.Is(err, ErrDocumentFinal) {
					return result(PageUnchanged, "the page is still being processed; it will be compared next time", &doc.ID)
				}
				return err
			}
			s.dropOriginalIfUnused(ctx, userID, doc.SHA256)
			if _, err := s.queueParse(ctx, updated); err != nil {
				return err
			}
			return result(PageChanged, "", &doc.ID)
		case !errors.Is(err, authz.ErrNoAccess):
			return err
		}
		// The learner deleted the document: it is added again below.
	}

	if _, err := s.blobs.PutOriginal(ctx, userID, data); err != nil {
		return err
	}
	now := s.now()
	siteID := site.ID
	doc, err := s.links.Store.CreateLinkDocument(ctx, Document{
		UserID: userID, KBID: site.KBID, SourceKind: SourceSitePage, SourceURL: page.URL, SiteID: &siteID,
		Title: title, MIME: mime, Bytes: int64(len(data)), SHA256: digest, PageCount: pageCount,
		LastSyncedAt: &now,
	})
	if err != nil {
		s.dropOriginalIfUnused(ctx, userID, digest)
		if IsDuplicateDocument(err) {
			return result(PageSkipped, "this page is already in the knowledge base from another site", nil)
		}
		return err
	}
	if _, err := s.queueParse(ctx, doc); err != nil {
		return err
	}
	return result(PageAdded, "", &doc.ID)
}

// FinishCrawl ends a generation: pages it did not reach are gone from the
// site, and their documents are marked removed.
func (s *Service) FinishCrawl(ctx context.Context, userID, siteID uuid.UUID) error {
	deps, err := s.sourceDeps()
	if err != nil {
		return errTerminal{err}
	}
	_, err = deps.Store.FinishCrawl(ctx, userID, siteID, s.now())
	return err
}

// FailCrawl settles a crawl that will not be retried. Pages already read
// stay; nothing is marked removed, since the crawl did not see the whole site.
func (s *Service) FailCrawl(ctx context.Context, userID, siteID uuid.UUID, cause error, cancelled bool) {
	deps, err := s.sourceDeps()
	if err != nil {
		return
	}
	status, reason := SiteFailed, "the crawl stopped before it finished. Try a re-sync."
	var le *LinkError
	switch {
	case cancelled:
		status, reason = SiteCancelled, ""
	case errors.As(cause, &le):
		reason = le.Msg
	}
	if err := deps.Store.SettleSite(context.WithoutCancel(ctx), userID, siteID, status, reason); err != nil {
		slog.Warn("knowledge: could not settle a crawl", "site", siteID, "error", err)
	}
}

// UnitRunner runs units [done, total) of the job in hand, persisting each
// (jobs.Queue.RunUnits bound to the job).
type UnitRunner func(ctx context.Context, total int, unit func(ctx context.Context, i int) (int, error)) error

// RunCrawl is the crawl_site job: the frontier's pages run as units, pass
// after pass while reading pages finds new ones, then the generation ends.
// A page costs no provider call (billed 0); its parse is a job of its own.
func (s *Service) RunCrawl(ctx context.Context, userID, siteID, jobID uuid.UUID, run UnitRunner) error {
	total, err := s.StartCrawl(ctx, userID, siteID, jobID)
	if err != nil {
		return err
	}
	for {
		err := run(ctx, total, func(ctx context.Context, i int) (int, error) {
			return 0, s.CrawlPage(ctx, userID, siteID, i)
		})
		if err != nil {
			return err
		}
		n, err := s.CrawlTotal(ctx, userID, siteID)
		if err != nil {
			return err
		}
		if n == total {
			break
		}
		total = n
	}
	return s.FinishCrawl(ctx, userID, siteID)
}
