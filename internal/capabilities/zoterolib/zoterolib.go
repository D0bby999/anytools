// Package zoterolib is a knowledge base's "Add from Zotero" (up-methods
// phase 20): search and browse the learner's own Zotero library, and add one
// item to the knowledge base, on the learner's own key.
//
// An item with a PDF in the learner's Zotero storage goes in as that file:
// it is their own copy, so no licence check applies. Any other item goes in
// as a Markdown note of its metadata and abstract with a link, as related
// papers do for a closed paper (internal/capabilities/related). The item's
// key is stored on the document, so the same item is never added twice.
//
// Every call resolves the knowledge base with the caller's id FIRST: another
// user's knowledge base answers like a missing one before the learner's key
// is read or Zotero is asked anything.
package zoterolib

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/zotero"
	"github.com/D0bby999/anytools/internal/tools"
)

var (
	// ErrNotFound covers another user's knowledge base and a missing one.
	ErrNotFound = errors.New("zoterolib: not found")
	// ErrNotConnected is a learner with no Zotero key.
	ErrNotConnected = errors.New("zoterolib: add a Zotero key in Settings → Search keys first")
	// ErrAlreadyAdded is an item already in the knowledge base.
	ErrAlreadyAdded = errors.New("zoterolib: this item is already in the knowledge base")
	// ErrBadKey is something that cannot be a Zotero item or collection key.
	ErrBadKey = errors.New("zoterolib: that is not a Zotero key")
)

// KBs says whether a knowledge base is the caller's.
type KBs interface {
	OwnsKB(ctx context.Context, userID, kbID uuid.UUID) (bool, error)
}

// Credentials reads the learner's Zotero key (byok.Service).
type Credentials interface {
	ZoteroCredential(ctx context.Context, userID uuid.UUID) (zotero.Credential, bool, error)
}

// Library is the Zotero Web API (*zotero.Client).
type Library interface {
	Search(ctx context.Context, cred zotero.Credential, q string, limit int) ([]zotero.Item, error)
	Collections(ctx context.Context, cred zotero.Credential, parent string) ([]zotero.Collection, error)
	CollectionItems(ctx context.Context, cred zotero.Credential, collection string, limit int) ([]zotero.Item, error)
	Item(ctx context.Context, cred zotero.Credential, key string) (*zotero.Item, error)
	StoredPDF(ctx context.Context, cred zotero.Credential, itemKey string) (*zotero.Attachment, error)
	File(ctx context.Context, cred zotero.Credential, attachmentKey string) ([]byte, error)
}

// Documents adds a file to a knowledge base through the ordinary upload
// path, recording the item's key. AddZotero returns ErrAlreadyAdded (or
// wraps it) for a duplicate.
type Documents interface {
	ZoteroItemAdded(ctx context.Context, userID, kbID uuid.UUID, itemKey string) (bool, error)
	AddZotero(ctx context.Context, userID, kbID uuid.UUID, itemKey, filename string, data []byte) error
}

// Service is "Add from Zotero".
type Service struct {
	kbs   KBs
	creds Credentials
	lib   Library
	docs  Documents
}

// NewService builds the service.
func NewService(kbs KBs, creds Credentials, lib Library, docs Documents) *Service {
	return &Service{kbs: kbs, creds: creds, lib: lib, docs: docs}
}

// open resolves the knowledge base, then the learner's key, in that order.
func (s *Service) open(ctx context.Context, userID, kbID uuid.UUID) (zotero.Credential, error) {
	ok, err := s.kbs.OwnsKB(ctx, userID, kbID)
	if err != nil {
		return zotero.Credential{}, err
	}
	if !ok {
		return zotero.Credential{}, ErrNotFound
	}
	cred, has, err := s.creds.ZoteroCredential(ctx, userID)
	if err != nil {
		return zotero.Credential{}, err
	}
	if !has {
		return zotero.Credential{}, ErrNotConnected
	}
	return cred, nil
}

// Search finds items by title, creator and year.
func (s *Service) Search(ctx context.Context, userID, kbID uuid.UUID, q string) ([]zotero.Item, error) {
	cred, err := s.open(ctx, userID, kbID)
	if err != nil {
		return nil, err
	}
	return s.lib.Search(ctx, cred, q, zotero.MaxResults)
}

// Browse lists the library's top-level collections, or a collection's
// subcollections and items.
func (s *Service) Browse(ctx context.Context, userID, kbID uuid.UUID, collection string) ([]zotero.Collection, []zotero.Item, error) {
	cred, err := s.open(ctx, userID, kbID)
	if err != nil {
		return nil, nil, err
	}
	if collection != "" && !zotero.ValidItemKey(collection) {
		return nil, nil, ErrBadKey
	}
	cols, err := s.lib.Collections(ctx, cred, collection)
	if err != nil {
		return nil, nil, err
	}
	items := []zotero.Item{}
	if collection != "" {
		if items, err = s.lib.CollectionItems(ctx, cred, collection, zotero.MaxResults); err != nil {
			return nil, nil, err
		}
	}
	return cols, items, nil
}

// Added says how an item went into the knowledge base.
type Added struct {
	Title string `json:"title"`
	// AsPDF is true when the item's stored PDF was imported; false when a
	// Markdown note of its metadata was.
	AsPDF bool `json:"as_pdf"`
	// Note says why a stored PDF was not used, when there was one.
	Note string `json:"note,omitempty"`
}

// Add puts an item into the knowledge base. The item is re-read from
// Zotero by its key: no title, URL or file comes from the client.
func (s *Service) Add(ctx context.Context, userID, kbID uuid.UUID, itemKey string) (*Added, error) {
	cred, err := s.open(ctx, userID, kbID)
	if err != nil {
		return nil, err
	}
	if !zotero.ValidItemKey(itemKey) {
		return nil, ErrBadKey
	}
	if dup, err := s.docs.ZoteroItemAdded(ctx, userID, kbID, itemKey); err != nil {
		return nil, err
	} else if dup {
		return nil, ErrAlreadyAdded
	}
	it, err := s.lib.Item(ctx, cred, itemKey)
	if err != nil {
		return nil, err
	}
	name := safeFilename(it.Title)
	out := &Added{Title: it.Title}

	att, err := s.lib.StoredPDF(ctx, cred, itemKey)
	if err != nil {
		return nil, err
	}
	if att != nil {
		data, ferr := s.lib.File(ctx, cred, att.Key)
		switch {
		case ferr == nil:
			if err := s.docs.AddZotero(ctx, userID, kbID, itemKey, name+".pdf", data); err != nil {
				return nil, err
			}
			out.AsPDF = true
			return out, nil
		case zotero.Is(ferr, zotero.CodeNotFound), zotero.Is(ferr, zotero.CodeTooLarge), zotero.Is(ferr, zotero.CodeNotPDF):
			// The file is not in Zotero's storage (a WebDAV library), is
			// past the cap, or is not a PDF: the item's details still go in.
			out.Note = ferr.Error()
		default:
			return nil, ferr
		}
	}
	if err := s.docs.AddZotero(ctx, userID, kbID, itemKey, name+".md", []byte(Markdown(*it))); err != nil {
		return nil, err
	}
	return out, nil
}

// Markdown is an item as a knowledge-base document: what it is and where it
// lives, never the work itself.
func Markdown(it zotero.Item) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", it.Title)
	if len(it.Creators) > 0 {
		fmt.Fprintf(&b, "**Creators:** %s\n\n", strings.Join(it.Creators, ", "))
	}
	if it.Year != "" {
		fmt.Fprintf(&b, "**Year:** %s\n\n", it.Year)
	}
	if it.ItemType != "" {
		fmt.Fprintf(&b, "**Item type:** %s\n\n", it.ItemType)
	}
	if it.Publication != "" {
		fmt.Fprintf(&b, "**Published in:** %s\n\n", it.Publication)
	}
	if it.DOI != "" {
		fmt.Fprintf(&b, "**DOI:** %s\n\n", it.DOI)
	}
	if link := readLink(it); link != "" {
		fmt.Fprintf(&b, "**Read it at:** <%s>\n\n", link)
	}
	if it.Abstract != "" {
		fmt.Fprintf(&b, "## Abstract\n\n%s\n\n", it.Abstract)
	}
	b.WriteString("_Added from your Zotero library as a reference: the item's file is not stored here._\n")
	return b.String()
}

// readLink is the DOI as a link, else the item's own URL, else the item in
// the learner's web library; only an http(s) link without spaces.
func readLink(it zotero.Item) string {
	candidates := []string{it.URL, it.WebURL}
	if doi := strings.TrimSpace(it.DOI); doi != "" {
		doi = strings.TrimPrefix(strings.TrimPrefix(doi, "https://doi.org/"), "doi:")
		candidates = append([]string{"https://doi.org/" + doi}, candidates...)
	}
	for _, c := range candidates {
		c = strings.TrimSpace(c)
		u, err := url.Parse(c)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil ||
			strings.ContainsAny(c, " \t\n<>") {
			continue
		}
		return c
	}
	return ""
}

var unsafeFilename = regexp.MustCompile(`[^\p{L}\p{N} ._-]+`)

func safeFilename(title string) string {
	f := strings.TrimSpace(unsafeFilename.ReplaceAllString(title, " "))
	f = strings.Join(strings.Fields(f), " ")
	if f == "" {
		f = "zotero item"
	}
	if utf8.RuneCountInString(f) > 100 {
		f = string([]rune(f)[:100])
	}
	return f
}

// ────────────────────────────────────────────────────────── for research

// Searcher is tools.ZoteroSearcher over the learner's key: no knowledge
// base is involved, and a learner with no key is tools.ErrNoZotero.
type Searcher struct {
	Creds Credentials
	Lib   Library
}

// Connected implements tools.ZoteroSearcher.
func (s Searcher) Connected(ctx context.Context, userID uuid.UUID) (bool, error) {
	_, ok, err := s.Creds.ZoteroCredential(ctx, userID)
	return ok, err
}

// SearchZotero implements tools.ZoteroSearcher.
func (s Searcher) SearchZotero(ctx context.Context, userID uuid.UUID, query string, limit int) ([]zotero.Item, error) {
	cred, ok, err := s.Creds.ZoteroCredential(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, tools.ErrNoZotero
	}
	return s.Lib.Search(ctx, cred, query, limit)
}
