package knowledge

import (
	"context"
	"errors"
	"log/slog"

	"github.com/google/uuid"
)

// drive_import.go — the entry point a connector uses to put a file it fetched
// from somewhere else into this pipeline.
//
// Added by phase 13 as a NEW file: nothing in the rest of this package changed.
// The alternative was for internal/connectors/drive to write `documents` rows
// itself, which would have put the upload cap, the page cap, the type sniff,
// the blob write and the job enqueue in two places — and the second copy is the
// one that drifts. Upload() and ImportExternal() are deliberately the same
// sequence of decisions in the same order.
//
// Two differences from Upload, and only two:
//
//  1. The document is UPSERTED on an external id rather than inserted. A Drive
//     file that changes must become a new VERSION of the document the user
//     already has — same row, same citations — not a second document with the
//     same title sitting next to the first one.
//  2. The store surface is passed IN rather than held on the Service. Widening
//     the Store interface would oblige every existing implementation and fake
//     to grow a method they have no use for; a connector that needs this passes
//     its own.

// ExternalImport is one file arriving from a connector.
type ExternalImport struct {
	UserID uuid.UUID
	KBID   uuid.UUID
	// SourceKind is the documents.source_kind value, e.g. SourceDrive.
	SourceKind string
	// ExternalID identifies the file in the source system. It is what makes a
	// re-import an update of the same document.
	ExternalID string
	// Filename supplies the extension the type detection reads. A connector
	// that converted a file on the way in (a Google Doc exported to Markdown)
	// passes the CONVERTED name, because that is what the bytes are now.
	Filename string
	Data     []byte
}

// ExternalDocuments is the persistence surface an external import needs.
//
// UpsertExternalDocument must, for an existing (kb, external id): keep the row
// and its id, write the new title/mime/bytes/sha256/page count, BUMP the
// version, and put the status back to `queued` with no error. The version bump
// is not cosmetic — blob.PutParsed writes `<doc>-v<version>.md`, so without it
// a re-import that failed halfway would have already overwritten the Markdown
// the viewer is currently serving.
type ExternalDocuments interface {
	UpsertExternalDocument(ctx context.Context, d Document, externalID string) (*Document, error)
}

// ImportExternal stores a connector's file and queues it for processing.
//
// The order is Upload's order and for Upload's reasons: validate the type
// before writing anything, count pages before queueing, create the row last. A
// document that exists in the database but whose bytes were rejected is a row
// the worker picks up and fails on three times.
func (s *Service) ImportExternal(ctx context.Context, docs ExternalDocuments, in ExternalImport) (*UploadResult, error) {
	if docs == nil {
		return nil, errors.New("knowledge: no external document store was supplied")
	}
	if in.ExternalID == "" {
		return nil, errors.New("knowledge: an external import needs a source id")
	}
	if in.SourceKind == "" {
		in.SourceKind = SourceDrive
	}
	_, mime, pageCount, err := s.checkFile(in.Filename, in.Data)
	if err != nil {
		return nil, err
	}

	digest, err := s.blobs.PutOriginal(ctx, in.UserID, in.Data)
	if err != nil {
		return nil, err
	}

	doc, err := docs.UpsertExternalDocument(ctx, Document{
		UserID:     in.UserID,
		KBID:       in.KBID,
		SourceKind: in.SourceKind,
		Title:      documentTitle(in.Filename),
		MIME:       mime,
		Bytes:      int64(len(in.Data)),
		SHA256:     digest,
		PageCount:  pageCount,
	}, in.ExternalID)
	if err != nil {
		return nil, err
	}

	jobID, err := s.jobs.Enqueue(ctx, in.UserID, "parse_document",
		ParseJobPayload{DocumentID: doc.ID, KBID: in.KBID}, 3)
	if err != nil {
		// Same treatment as Upload's: the document exists but nothing will ever
		// work on it, so the row says so in a FIXED sentence. documents.error is
		// serialized straight to the browser and an Enqueue failure is a wrapped
		// pgx error carrying the failing statement.
		slog.Error("knowledge: could not queue an imported document for processing",
			"error", err, "document", doc.ID, "kb", in.KBID)
		_ = s.store.SetDocumentStatus(ctx, in.UserID, doc.ID, StatusFailed,
			"this document could not be queued for processing. Try importing it again.")
		return nil, err
	}

	s.events.PublishStatus(in.UserID, in.KBID, doc.ID, StatusQueued, "", nil)
	return &UploadResult{Document: doc, JobID: jobID}, nil
}
