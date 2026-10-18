package drive

import (
	"context"
	"errors"
	"fmt"
	"path"
	"strings"

	"github.com/D0bby999/anytools/internal/rag/parse"
)

// content.go — turning a Drive file into bytes the phase 5 pipeline can read.
//
// Three lanes, and which one a file takes is decided entirely by its MIME type:
//
//   - A Google DOC exports to text/markdown. That is the whole reason Docs skip
//     the LLM parse: the export keeps headings and tables (the spike's fixture
//     asserts `# Week 1` and a `| Stage | Cost |` row survive), so the chunker
//     can split it directly and nobody's parse quota is spent.
//   - A Google SHEET exports to text/csv, which is then rendered as a Markdown
//     table. See csvToMarkdown for why the rendering step exists.
//   - Anything else is downloaded byte-for-byte and handed to the pipeline
//     under its own filename, so the existing type detection — extension
//     proposes, content sniff vetoes — decides what it is. This package
//     deliberately keeps no second opinion about file types.
//
// Google-native types with no lane (Slides, Drawings, Forms, Sites) are
// refused with a sentence naming the type. They cannot be downloaded at all —
// files.get returns `fileNotDownloadable` — so silently trying would produce an
// error message about a Drive API detail rather than about the user's file.

// ErrUnsupportedDriveType reports a Google-native file with no import lane.
var ErrUnsupportedDriveType = errors.New("drive: this Google file type cannot be imported yet")

// googleNativePrefix marks a file that has no bytes of its own.
const googleNativePrefix = "application/vnd.google-apps."

// fetchContent downloads or exports one file and returns the bytes plus the
// filename the pipeline should detect its type from.
func fetchContent(ctx context.Context, c *Client, f File, maxBytes int64) (string, []byte, error) {
	switch f.MimeType {
	case MimeGoogleDoc:
		data, _, err := c.ExportDoc(ctx, f.ID, MimeMarkdown)
		if err != nil {
			return "", nil, err
		}
		return withExtension(f.Name, ".md"), data, nil

	case MimeGoogleSheet:
		data, _, err := c.ExportDoc(ctx, f.ID, MimeCSV)
		if err != nil {
			return "", nil, err
		}
		md, err := csvToMarkdown(data)
		if err != nil {
			return "", nil, err
		}
		return withExtension(f.Name, ".md"), md, nil
	}

	if strings.HasPrefix(f.MimeType, googleNativePrefix) {
		return "", nil, fmt.Errorf("%w: %s", ErrUnsupportedDriveType, friendlyGoogleType(f.MimeType))
	}

	data, err := c.DownloadFile(ctx, f.ID, maxBytes)
	if err != nil {
		return "", nil, err
	}
	return f.Name, data, nil
}

// withExtension appends ext unless name already ends in it.
//
// Case-insensitive, because a Doc called "Notes.MD" would otherwise become
// "Notes.MD.md" and the document would show the doubled name in the KB list.
func withExtension(name, ext string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Untitled"
	}
	// A Drive name is free text and becomes a filename; a path separator in it
	// must not turn into one.
	name = strings.NewReplacer("/", "-", "\\", "-").Replace(name)
	if strings.EqualFold(path.Ext(name), ext) {
		return name
	}
	return name + ext
}

// friendlyGoogleType names a Google-native type the way the user would.
func friendlyGoogleType(mime string) string {
	switch mime {
	case "application/vnd.google-apps.presentation":
		return "Google Slides"
	case "application/vnd.google-apps.drawing":
		return "Google Drawings"
	case "application/vnd.google-apps.form":
		return "Google Forms"
	case "application/vnd.google-apps.site":
		return "Google Sites"
	case MimeGoogleFolder:
		return "a folder"
	}
	return strings.TrimPrefix(mime, googleNativePrefix)
}

// maxSheetCells bounds the rendering below. A spreadsheet with a million cells
// is not a document anyone is going to ask questions of, and rendering it would
// spend the whole import on one file.
const maxSheetCells = 200_000

// csvToMarkdown renders exported spreadsheet CSV as a Markdown table.
//
// The rendering itself is parse.CSVToMarkdown, shared with an uploaded .csv,
// .tsv or .xlsx (phase 19 of up-methods). It is the one place this connector
// reshapes content, and it is deterministic — no model, no quota, no
// provenance question about who read the file. What stays here is the Drive
// budget and the sentences a Drive import fails with.
func csvToMarkdown(data []byte) ([]byte, error) {
	md, err := parse.CSVToMarkdown(data, ',', maxSheetCells)
	switch {
	case errors.Is(err, parse.ErrSheetEmpty):
		return nil, errors.New("drive: this spreadsheet is empty")
	case errors.Is(err, parse.ErrTooLarge):
		return nil, fmt.Errorf("drive: this spreadsheet is too large to import (over %d cells)", maxSheetCells)
	case err != nil:
		return nil, fmt.Errorf("drive: this spreadsheet's CSV export could not be read: %w", err)
	}
	return md, nil
}
