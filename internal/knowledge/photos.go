package knowledge

// Photos of pages and notes as sources (up-methods phase 16).
//
// One photo is a document of one page, stored as itself. Several photos the
// learner adds together are one document with one page per photo, in the
// order chosen, stored as one original (parse.PackPhotos). Either way the
// learner's `parse` route reads each photo, one call per page, and the page
// marker around each reading is ours.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/rag/chunk"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// photoPages is the blob.ObjectStore namespace of a photo document's page
// readings, kept until the document is indexed so a retry does not pay for a
// page that was already read.
const photoPages = "photopages"

// ErrPhotoSetTooLarge refuses photos that together exceed one upload.
var ErrPhotoSetTooLarge = fmt.Errorf("knowledge: the photos together are larger than the %d MB upload limit", MaxUploadBytes>>20)

// PhotoFile is one photo of a set, as the learner named it.
type PhotoFile struct {
	Name string
	Data []byte
}

// UploadPhotos adds photos as ONE document, one page per photo in the given
// order. One photo is simply an upload.
func (s *Service) UploadPhotos(ctx context.Context, userID, kbID uuid.UUID, files []PhotoFile) (*UploadResult, error) {
	switch {
	case len(files) == 0:
		return nil, fmt.Errorf("%w: no photos", parse.ErrUnsupportedType)
	case len(files) == 1:
		return s.Upload(ctx, userID, kbID, files[0].Name, files[0].Data)
	case len(files) > parse.MaxPhotosPerDocument:
		return nil, fmt.Errorf("%w: %d photos; the limit is %d", parse.ErrTooManyPhotos, len(files), parse.MaxPhotosPerDocument)
	}
	photos := make([][]byte, len(files))
	total := 0
	for i, f := range files {
		total += len(f.Data)
		if total > MaxUploadBytes {
			return nil, ErrPhotoSetTooLarge
		}
		kind, _, _, err := s.checkFile(f.Name, f.Data)
		if err != nil {
			return nil, fmt.Errorf("photo %d: %w", i+1, err)
		}
		if kind != parse.KindImage {
			return nil, fmt.Errorf("%w: only photos can be added together as one document", parse.ErrUnsupportedType)
		}
		photos[i] = f.Data
	}
	packed, err := parse.PackPhotos(photos)
	if err != nil {
		return nil, err
	}
	return s.storeAndQueue(ctx, userID, kbID, files[0].Name, parse.MimePhotoSet, packed, len(photos), "")
}

// readPhotos is a photo document's parse: each photo read through the chain,
// each reading stored before the next photo is sent.
func (s *Service) readPhotos(ctx context.Context, userID uuid.UUID, doc *Document, data []byte) (string, int, ProcessedBy, error) {
	photos, err := parse.PhotosOf(doc.MIME, data)
	if err != nil {
		return "", 0, ProcessedBy{}, err
	}
	chain, err := s.providers.ParserChain(ctx, userID)
	if err != nil {
		return "", 0, ProcessedBy{}, err
	}
	if len(chain) == 0 {
		return "", 0, ProcessedBy{}, parse.ErrPhotoNoModel
	}

	readings := make([]parse.PhotoReading, len(photos))
	for i, photo := range photos {
		if r, ok := s.storedPhotoPage(ctx, doc, i, photo); ok {
			readings[i] = r
			continue
		}
		r, err := parse.ReadPhoto(ctx, chain, photo, i+1, s.recordFallback(ctx, userID, doc))
		if err != nil {
			return "", 0, ProcessedBy{}, err
		}
		s.storePhotoPage(ctx, doc, i, photo, r)
		readings[i] = r
	}

	var md strings.Builder
	for _, r := range readings {
		md.WriteString(r.Markdown)
		md.WriteString("\n")
	}
	return md.String(), len(photos), photoProvenance(chain[0].ProviderName(), readings), nil
}

// photoChunks splits a photo document page by page. Short pages of a PDF
// may share a passage, cited by its first page; two photos never do, so a
// citation opens the photo its text was read from.
func (s *Service) photoChunks(markdown string, pageCount int) ([]chunk.Chunk, error) {
	var out []chunk.Chunk
	for _, page := range SplitPages(markdown) {
		pieces, err := chunk.Split(parse.Marker(page.Number)+"\n"+page.Markdown, pageCount, s.chunkOpts)
		if err != nil {
			return nil, err
		}
		for _, p := range pieces {
			p.Ord = len(out)
			out = append(out, p)
		}
	}
	return out, nil
}

// photoProvenance is what processed_by says about a photo document: the
// model that read its first page, and any page another lane read.
func photoProvenance(first string, readings []parse.PhotoReading) ProcessedBy {
	lead := readings[0]
	pb := ProcessedBy{Parser: lead.Provider, Model: lead.Model}
	var others []string
	for i, r := range readings {
		if r.Provider != first {
			pb.Downgraded = true
		}
		if r.Provider != lead.Provider || r.Model != lead.Model {
			others = append(others, fmt.Sprintf("page %d by %s %s", i+1, r.Provider, r.Model))
		}
	}
	switch {
	case len(others) > 0:
		pb.Note = "not every photo was read by the same model: " + strings.Join(others, ", ")
	case pb.Downgraded:
		pb.Note = first + " could not read these photos, so " + lead.Provider + " did"
	}
	return pb
}

// storedPhoto is one page reading kept between attempts. It is reused only
// for the same version of the document and the same photo.
type storedPhoto struct {
	Version int                `json:"version"`
	Digest  string             `json:"digest"`
	Reading parse.PhotoReading `json:"reading"`
}

func photoPageObject(docID uuid.UUID, i int) uuid.UUID {
	return uuid.NewSHA1(docID, []byte(fmt.Sprintf("photo-%d", i)))
}

func (s *Service) photoObjects() blob.ObjectStore {
	objects, _ := s.blobs.(blob.ObjectStore)
	return objects
}

func (s *Service) storedPhotoPage(ctx context.Context, doc *Document, i int, photo parse.Photo) (parse.PhotoReading, bool) {
	objects := s.photoObjects()
	if objects == nil {
		return parse.PhotoReading{}, false
	}
	raw, err := objects.GetObject(ctx, doc.UserID, photoPages, photoPageObject(doc.ID, i))
	if err != nil {
		return parse.PhotoReading{}, false
	}
	var kept storedPhoto
	if json.Unmarshal(raw, &kept) != nil || kept.Version != doc.Version || kept.Digest != blob.Digest(photo.Data) {
		return parse.PhotoReading{}, false
	}
	return kept.Reading, true
}

// storePhotoPage keeps a reading. A failure only costs a retry its reuse.
func (s *Service) storePhotoPage(ctx context.Context, doc *Document, i int, photo parse.Photo, r parse.PhotoReading) {
	objects := s.photoObjects()
	if objects == nil {
		return
	}
	raw, err := json.Marshal(storedPhoto{Version: doc.Version, Digest: blob.Digest(photo.Data), Reading: r})
	if err == nil {
		err = objects.PutObject(ctx, doc.UserID, photoPages, photoPageObject(doc.ID, i), raw)
	}
	if err != nil {
		slog.Warn("knowledge: a photo's reading was not kept for a retry", "document", doc.ID, "page", i+1, "error", err)
	}
}

// dropPhotoPages deletes a photo document's kept readings: once it is
// indexed, and when it is deleted.
func (s *Service) dropPhotoPages(ctx context.Context, userID, docID uuid.UUID) {
	objects := s.photoObjects()
	if objects == nil {
		return
	}
	for i := 0; i < parse.MaxPhotosPerDocument; i++ {
		_ = objects.DeleteObject(ctx, userID, photoPages, photoPageObject(docID, i))
	}
}

// ErrNotAPhoto answers a photo request for a document that is not one, or a
// page it does not have.
var ErrNotAPhoto = errors.New("knowledge: no such photo")

// DocumentPhoto returns page n's photo of a photo document, for the reading
// view to show beside its text. Ownership is checked by the caller first, as
// for DocumentContent; the store reads by user too.
func (s *Service) DocumentPhoto(ctx context.Context, userID, docID uuid.UUID, page int) (*Document, parse.Photo, error) {
	doc, err := s.store.GetDocument(ctx, userID, docID)
	if err != nil {
		return nil, parse.Photo{}, err
	}
	if !parse.IsPhotoMIME(doc.MIME) || page < 1 || page > max(doc.PageCount, 1) {
		return nil, parse.Photo{}, ErrNotAPhoto
	}
	data, err := s.blobs.GetOriginal(ctx, userID, doc.SHA256)
	if err != nil {
		return nil, parse.Photo{}, err
	}
	photos, err := parse.PhotosOf(doc.MIME, data)
	if err != nil {
		return nil, parse.Photo{}, err
	}
	if page > len(photos) {
		return nil, parse.Photo{}, ErrNotAPhoto
	}
	return doc, photos[page-1], nil
}
