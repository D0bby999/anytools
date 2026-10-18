// Package zotero reads a learner's Zotero library through the Zotero Web API
// v3 (up-methods phase 20): search and browse its top-level items, read one
// item, find its stored PDF, download that file, and check a key.
//
// The calls follow DeepTutor's tools/zotero_search.py: items/top with
// itemType=-attachment, a limit capped at 25, the key sent as a Bearer token
// and Zotero-API-Version: 3. Every API request goes through an allowlisted
// client (api.zotero.org only) over the guarded fetch client
// (internal/security). A stored file is the one exception: Zotero answers
// /file with a redirect to its file storage, so that request may follow a
// hop to another public https host, and the key is removed before it does.
//
// Errors are *Error, whose message is a fixed sentence: it never carries a
// URL (the key is in /keys/{key}), a header or anything Zotero sent.
package zotero

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/D0bby999/anytools/internal/security"
)

// Caps.
const (
	// MaxResults is DeepTutor's MAX_LIMIT, and the panel's page size.
	MaxResults = 25
	// MaxFileBytes bounds a stored PDF, the knowledge base's upload cap.
	MaxFileBytes = 50 << 20
	// maxChildren bounds the attachments read to find an item's PDF.
	maxChildren = 50
	// maxJSONBytes bounds one API answer; 25 items with long abstracts fit.
	maxJSONBytes = 4 << 20
	// Field caps, so a library's longest abstract cannot fill a page.
	maxTitle    = 500
	maxAbstract = 20000
	maxCreators = 30
	maxField    = 2048
)

// APIBase is the production API.
const APIBase = "https://api.zotero.org"

// Error is a refusal whose message is written for the learner.
type Error struct {
	Code string
	Msg  string
}

func (e *Error) Error() string { return e.Msg }

// Error codes.
const (
	CodeBadKey      = "bad_key"
	CodeNotFound    = "not_found"
	CodeRateLimited = "rate_limited"
	CodeTooLarge    = "too_large"
	CodeNotPDF      = "not_pdf"
	CodeNetwork     = "network"
	CodeBadAnswer   = "bad_answer"
)

// Is reports whether err is a Zotero refusal with this code.
func Is(err error, code string) bool {
	var e *Error
	return errors.As(err, &e) && e.Code == code
}

// ─────────────────────────────────────────────────────────── a credential

// Credential is a library's numeric user id and a key that reads it. It is
// stored as one encrypted secret, "<user id>:<key>".
type Credential struct {
	UserID string
	Key    string
}

var (
	userIDPattern = regexp.MustCompile(`^[0-9]{1,12}$`)
	keyPattern    = regexp.MustCompile(`^[A-Za-z0-9]{16,64}$`)
	// ItemKeyPattern is Zotero's object key: eight characters of
	// [23456789ABCDEFGHIJKLMNPQRSTUVWXYZ], checked loosely.
	itemKeyPattern = regexp.MustCompile(`^[0-9A-Z]{8}$`)
)

// ErrBadCredential is a user id or key that cannot be one.
var ErrBadCredential = errors.New("a Zotero user ID is a number (zotero.org/settings/keys shows it), and a key is letters and digits")

// NewCredential checks a user id and a key as typed.
func NewCredential(userID, key string) (Credential, error) {
	c := Credential{UserID: strings.TrimSpace(userID), Key: strings.TrimSpace(key)}
	if !userIDPattern.MatchString(c.UserID) || !keyPattern.MatchString(c.Key) {
		return Credential{}, ErrBadCredential
	}
	return c, nil
}

// ParseCredential reads a stored secret.
func ParseCredential(secret string) (Credential, error) {
	id, key, ok := strings.Cut(secret, ":")
	if !ok {
		return Credential{}, ErrBadCredential
	}
	return NewCredential(id, key)
}

// Secret is the credential as it is stored.
func (c Credential) Secret() string { return c.UserID + ":" + c.Key }

// ValidItemKey reports whether k can be a Zotero item or collection key.
func ValidItemKey(k string) bool { return itemKeyPattern.MatchString(k) }

// ─────────────────────────────────────────────────────────────── client

// Client reads one library per call.
type Client struct {
	api   *http.Client
	files *http.Client
	base  string
}

// NewClient restricts base (security.FetchClient in production) to the API.
func NewClient(base *http.Client) *Client { return NewClientFor(base, APIBase) }

// NewClientFor is NewClient with another API base; tests aim it at a fixture.
func NewClientFor(base *http.Client, api string) *Client {
	host := ""
	if u, err := url.Parse(api); err == nil {
		host = u.Host
	}
	return &Client{
		api:   security.AllowlistClientOver(base, host),
		files: fileClient(base),
		base:  strings.TrimRight(api, "/"),
	}
}

// fileClient follows /file's redirect to Zotero's storage. The key is
// removed on any hop off the API host: Go strips Authorization only when the
// new host is not a subdomain, and the guarded client refuses a cross-host
// hop that still carries one. Plain http is refused.
func fileClient(base *http.Client) *http.Client {
	previous := base.CheckRedirect
	return &http.Client{
		Timeout:   base.Timeout,
		Transport: base.Transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if req.URL.Scheme != "https" {
				return &Error{Code: CodeNetwork, Msg: "Zotero sent the file somewhere that is not https"}
			}
			if len(via) > 0 && !strings.EqualFold(req.URL.Host, via[0].URL.Host) {
				req.Header.Del("Authorization")
			}
			if previous != nil {
				return previous(req, via)
			}
			if len(via) >= 3 {
				return &Error{Code: CodeNetwork, Msg: "Zotero redirected the file too many times"}
			}
			return nil
		},
	}
}

func (c *Client) header(cred Credential) http.Header {
	h := http.Header{}
	h.Set("Zotero-API-Version", "3")
	h.Set("Authorization", "Bearer "+cred.Key)
	return h
}

// get reads one JSON answer from the API.
func (c *Client) get(ctx context.Context, cred Credential, path string, q url.Values, out any, notFound string) error {
	if !userIDPattern.MatchString(cred.UserID) || !keyPattern.MatchString(cred.Key) {
		return &Error{Code: CodeBadKey, Msg: ErrBadCredential.Error()}
	}
	link := c.base + path
	if len(q) > 0 {
		link += "?" + q.Encode()
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	page, err := security.FetchPage(ctx, c.api, security.PageRequest{
		URL:       link,
		Accept:    "application/json",
		UserAgent: "AnyTools/1.0",
		Types:     []string{"application/json"},
		Header:    c.header(cred),
		MaxBytes:  maxJSONBytes,
	})
	if err != nil {
		return fetchError(err, notFound)
	}
	if err := json.Unmarshal(page.Body, out); err != nil {
		return &Error{Code: CodeBadAnswer, Msg: "Zotero's answer could not be read"}
	}
	return nil
}

func fetchError(err error, notFound string) error {
	var status *security.HTTPStatusError
	var zerr *Error
	switch {
	case errors.As(err, &zerr):
		return zerr
	case security.IsInternalAddress(err) || errors.Is(err, security.ErrFetchURL) || errors.Is(err, security.ErrHostNotAllowed):
		return &Error{Code: CodeNetwork, Msg: "Zotero's address did not resolve to the public internet"}
	case errors.Is(err, security.ErrPageTooLarge), errors.Is(err, security.ErrStreamTooLarge):
		return &Error{Code: CodeTooLarge, Msg: "Zotero's answer was larger than allowed"}
	case errors.As(err, &status) && (status.Status == 401 || status.Status == 403):
		return &Error{Code: CodeBadKey, Msg: "Zotero refused your key; check it, and that it can read your library, in Settings → Search keys"}
	case errors.As(err, &status) && status.Status == 404:
		return &Error{Code: CodeNotFound, Msg: notFound}
	case errors.As(err, &status) && status.Status == 429:
		return &Error{Code: CodeRateLimited, Msg: "Zotero is limiting requests; try again in a minute"}
	case errors.As(err, &status):
		return &Error{Code: CodeNetwork, Msg: fmt.Sprintf("Zotero answered HTTP %d", status.Status)}
	case errors.Is(err, security.ErrPageType):
		return &Error{Code: CodeBadAnswer, Msg: "Zotero answered with something other than your library"}
	case errors.Is(err, context.Canceled):
		return err
	}
	return &Error{Code: CodeNetwork, Msg: "Zotero could not be reached; try again later"}
}

const libraryNotFound = "Zotero has no library for that user ID; check it in Settings → Search keys"

// ──────────────────────────────────────────────────────────────── items

// Item is one top-level library item, as the panel lists it and as a note
// describes it.
type Item struct {
	Key         string   `json:"key"`
	ItemType    string   `json:"item_type"`
	Title       string   `json:"title"`
	Creators    []string `json:"creators"`
	Year        string   `json:"year"`
	Publication string   `json:"publication,omitempty"`
	DOI         string   `json:"doi,omitempty"`
	URL         string   `json:"url,omitempty"`
	Abstract    string   `json:"abstract,omitempty"`
	// WebURL is the item in the learner's web library.
	WebURL string `json:"-"`
}

type rawItem struct {
	Key   string `json:"key"`
	Links struct {
		Alternate struct {
			Href string `json:"href"`
		} `json:"alternate"`
	} `json:"links"`
	Data struct {
		Key      string `json:"key"`
		ItemType string `json:"itemType"`
		Title    string `json:"title"`
		Creators []struct {
			Name      string `json:"name"`
			FirstName string `json:"firstName"`
			LastName  string `json:"lastName"`
		} `json:"creators"`
		Date             string `json:"date"`
		PublicationTitle string `json:"publicationTitle"`
		DOI              string `json:"DOI"`
		URL              string `json:"url"`
		AbstractNote     string `json:"abstractNote"`
		// Attachments only.
		ContentType string `json:"contentType"`
		LinkMode    string `json:"linkMode"`
		Filename    string `json:"filename"`
	} `json:"data"`
}

var yearPattern = regexp.MustCompile(`\b(1[5-9]|20)\d{2}\b`)

// normalize is DeepTutor's _normalize: creators by name or first and last,
// the year from the date, "Untitled" for an item with no title.
func (r rawItem) normalize() Item {
	d := r.Data
	it := Item{
		Key:         d.Key,
		ItemType:    clip(d.ItemType, 64),
		Title:       clip(oneLine(d.Title), maxTitle),
		Publication: clip(oneLine(d.PublicationTitle), maxTitle),
		DOI:         clip(strings.TrimSpace(d.DOI), 256),
		URL:         clip(strings.TrimSpace(d.URL), maxField),
		Abstract:    clip(strings.TrimSpace(d.AbstractNote), maxAbstract),
		WebURL:      clip(strings.TrimSpace(r.Links.Alternate.Href), maxField),
		Creators:    []string{},
	}
	if it.Key == "" {
		it.Key = r.Key
	}
	if it.Title == "" {
		it.Title = "Untitled"
	}
	for _, c := range d.Creators {
		name := oneLine(c.Name)
		if name == "" {
			name = oneLine(c.FirstName + " " + c.LastName)
		}
		if name != "" && len(it.Creators) < maxCreators {
			it.Creators = append(it.Creators, clip(name, 200))
		}
	}
	if m := yearPattern.FindString(d.Date); m != "" {
		it.Year = m
	}
	return it
}

func (c *Client) items(ctx context.Context, cred Credential, path string, q url.Values) ([]Item, error) {
	var raw []rawItem
	if err := c.get(ctx, cred, path, q, &raw, libraryNotFound); err != nil {
		return nil, err
	}
	out := make([]Item, 0, len(raw))
	for _, r := range raw {
		if !ValidItemKey(r.Data.Key) || r.Data.ItemType == "attachment" {
			continue
		}
		out = append(out, r.normalize())
		if len(out) == MaxResults {
			break
		}
	}
	return out, nil
}

func clampLimit(limit int) string {
	if limit <= 0 || limit > MaxResults {
		limit = MaxResults
	}
	return strconv.Itoa(limit)
}

// Search finds top-level items matching q (title, creator and year).
func (c *Client) Search(ctx context.Context, cred Credential, q string, limit int) ([]Item, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return []Item{}, nil
	}
	return c.items(ctx, cred, "/users/"+cred.UserID+"/items/top", url.Values{
		"q": {clip(q, 200)}, "itemType": {"-attachment"}, "limit": {clampLimit(limit)}, "format": {"json"},
	})
}

// CollectionItems lists a collection's top-level items.
func (c *Client) CollectionItems(ctx context.Context, cred Credential, collection string, limit int) ([]Item, error) {
	if !ValidItemKey(collection) {
		return nil, &Error{Code: CodeNotFound, Msg: "that is not a Zotero collection"}
	}
	return c.items(ctx, cred, "/users/"+cred.UserID+"/collections/"+collection+"/items/top", url.Values{
		"itemType": {"-attachment"}, "limit": {clampLimit(limit)}, "format": {"json"},
	})
}

// Item reads one item by its key.
func (c *Client) Item(ctx context.Context, cred Credential, key string) (*Item, error) {
	if !ValidItemKey(key) {
		return nil, &Error{Code: CodeNotFound, Msg: "that is not a Zotero item"}
	}
	var raw rawItem
	if err := c.get(ctx, cred, "/users/"+cred.UserID+"/items/"+key, url.Values{"format": {"json"}},
		&raw, "that item is not in your Zotero library"); err != nil {
		return nil, err
	}
	if raw.Data.Key != key {
		return nil, &Error{Code: CodeBadAnswer, Msg: "Zotero's answer could not be read"}
	}
	if raw.Data.ItemType == "attachment" {
		return nil, &Error{Code: CodeNotFound, Msg: "pick a library item, not one of its attachments"}
	}
	it := raw.normalize()
	return &it, nil
}

// ────────────────────────────────────────────────────────── collections

// Collection is one collection of the library.
type Collection struct {
	Key            string `json:"key"`
	Name           string `json:"name"`
	Items          int    `json:"items"`
	Subcollections int    `json:"subcollections"`
}

// Collections lists the library's top-level collections, or parent's
// subcollections.
func (c *Client) Collections(ctx context.Context, cred Credential, parent string) ([]Collection, error) {
	path := "/users/" + cred.UserID + "/collections/top"
	if parent != "" {
		if !ValidItemKey(parent) {
			return nil, &Error{Code: CodeNotFound, Msg: "that is not a Zotero collection"}
		}
		path = "/users/" + cred.UserID + "/collections/" + parent + "/collections"
	}
	var raw []struct {
		Key  string `json:"key"`
		Meta struct {
			NumCollections int `json:"numCollections"`
			NumItems       int `json:"numItems"`
		} `json:"meta"`
		Data struct {
			Key  string `json:"key"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := c.get(ctx, cred, path, url.Values{"limit": {"100"}, "format": {"json"}, "sort": {"title"}},
		&raw, libraryNotFound); err != nil {
		return nil, err
	}
	out := make([]Collection, 0, len(raw))
	for _, r := range raw {
		if !ValidItemKey(r.Data.Key) {
			continue
		}
		out = append(out, Collection{Key: r.Data.Key, Name: clip(oneLine(r.Data.Name), maxTitle),
			Items: r.Meta.NumItems, Subcollections: r.Meta.NumCollections})
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────── stored PDF

// Attachment is a PDF stored in the learner's Zotero storage.
type Attachment struct {
	Key      string
	Filename string
}

// StoredPDF returns the item's first PDF held in Zotero's own storage, or
// nil. A linked file or a link to a web page is on the learner's computer or
// someone else's server, not in their Zotero storage, so it is not offered.
func (c *Client) StoredPDF(ctx context.Context, cred Credential, itemKey string) (*Attachment, error) {
	if !ValidItemKey(itemKey) {
		return nil, &Error{Code: CodeNotFound, Msg: "that is not a Zotero item"}
	}
	var raw []rawItem
	if err := c.get(ctx, cred, "/users/"+cred.UserID+"/items/"+itemKey+"/children",
		url.Values{"limit": {strconv.Itoa(maxChildren)}, "format": {"json"}},
		&raw, "that item is not in your Zotero library"); err != nil {
		return nil, err
	}
	for _, r := range raw {
		d := r.Data
		if d.ItemType == "attachment" && strings.EqualFold(d.ContentType, "application/pdf") &&
			(d.LinkMode == "imported_file" || d.LinkMode == "imported_url") && ValidItemKey(d.Key) {
			return &Attachment{Key: d.Key, Filename: clip(oneLine(d.Filename), 200)}, nil
		}
	}
	return nil, nil
}

// File downloads a stored attachment, at most MaxFileBytes, and checks that
// it is a PDF.
func (c *Client) File(ctx context.Context, cred Credential, attachmentKey string) ([]byte, error) {
	if !ValidItemKey(attachmentKey) || !userIDPattern.MatchString(cred.UserID) || !keyPattern.MatchString(cred.Key) {
		return nil, &Error{Code: CodeNotFound, Msg: "that is not a Zotero attachment"}
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	s, err := security.OpenStream(ctx, c.files, security.PageRequest{
		URL:       c.base + "/users/" + cred.UserID + "/items/" + attachmentKey + "/file",
		Accept:    "application/pdf, application/octet-stream",
		UserAgent: "AnyTools/1.0",
		// Zotero's storage serves the type the file was stored with; the
		// bytes are checked below whatever it says.
		Types:  []string{"application/pdf", "application/octet-stream", "binary/octet-stream", "application/x-pdf", ""},
		Header: c.header(cred),
	}, MaxFileBytes)
	if err != nil {
		if errors.Is(err, security.ErrHostNotAllowed) {
			return nil, &Error{Code: CodeNetwork, Msg: "Zotero sent the file somewhere it may not be read from"}
		}
		return nil, fetchError(err, "this item's file is not in your Zotero storage")
	}
	defer s.Body.Close()
	data, err := io.ReadAll(s.Body)
	if errors.Is(err, security.ErrStreamTooLarge) {
		return nil, &Error{Code: CodeTooLarge, Msg: "the PDF is larger than 50 MB"}
	}
	if err != nil {
		return nil, fetchError(err, "")
	}
	if !bytes.HasPrefix(data, []byte("%PDF-")) {
		return nil, &Error{Code: CodeNotPDF, Msg: "the stored file is not a PDF"}
	}
	return data, nil
}

// ──────────────────────────────────────────────────────────────── a key

// Verify checks a credential with one call to /keys/{key}: the key must
// exist, belong to the user id, and be allowed to read the library.
func (c *Client) Verify(ctx context.Context, cred Credential) error {
	var out struct {
		UserID json.Number `json:"userID"`
		Access struct {
			User struct {
				Library bool `json:"library"`
			} `json:"user"`
		} `json:"access"`
	}
	if !keyPattern.MatchString(cred.Key) {
		return &Error{Code: CodeBadKey, Msg: ErrBadCredential.Error()}
	}
	err := c.get(ctx, cred, "/keys/"+cred.Key, nil, &out, "Zotero does not know this key; create one at zotero.org/settings/keys")
	if err != nil {
		if Is(err, CodeBadKey) {
			return &Error{Code: CodeBadKey, Msg: "Zotero does not know this key; create one at zotero.org/settings/keys"}
		}
		return err
	}
	if out.UserID.String() != cred.UserID {
		return &Error{Code: CodeBadKey, Msg: "this key belongs to another Zotero user ID; zotero.org/settings/keys shows yours"}
	}
	if !out.Access.User.Library {
		return &Error{Code: CodeBadKey, Msg: "this key cannot read your library; allow library access when you create it"}
	}
	return nil
}

// ─────────────────────────────────────────────────────────────── helpers

func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

func clip(s string, n int) string {
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "")
	}
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
