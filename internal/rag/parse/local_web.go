package parse

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"

	readability "github.com/go-shiori/go-readability"
	"github.com/taylorskalyo/goreader/epub"
)

// LocalEPUBText extracts an EPUB in spine order, one marker per spine item.
//
// The "page" of an EPUB is a fiction — reflowable text has no fixed pages — so
// the marker numbers the spine item instead. That is the unit a reader can
// actually navigate to, and phase 8's reader will anchor on the same thing.
func localEPUBText(data []byte) (string, int, error) {
	if err := checkEPUBMetadata(data); err != nil {
		return "", 0, err
	}
	r, err := epub.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", 0, fmt.Errorf("parse: epub: %w", err)
	}
	if len(r.Rootfiles) == 0 {
		return "", 0, fmt.Errorf("parse: epub: no rootfile")
	}
	root := r.Rootfiles[0]
	if len(root.Spine.Itemrefs) == 0 {
		return "", 0, fmt.Errorf("parse: epub: empty spine")
	}

	if len(root.Spine.Itemrefs) > DefaultMaxPages {
		return "", 0, fmt.Errorf("%w: %d chapters, the limit is %d", ErrPageCapExceeded, len(root.Spine.Itemrefs), DefaultMaxPages)
	}
	budget := newInflateBudget()
	var sb strings.Builder
	count := 0
	for _, ref := range root.Spine.Itemrefs {
		if ref.Item == nil {
			continue
		}
		rc, err := ref.Item.Open()
		if err != nil {
			// One unreadable chapter must not cost the whole book.
			continue
		}
		raw, err := readBudgeted(rc, ref.Item.HREF, budget)
		rc.Close()
		if errors.Is(err, ErrTooLarge) && budget.left <= 0 {
			// The book as a whole is too big; skipping on would read nothing
			// more, and a half-read book reported as whole is worse.
			return "", 0, err
		}
		if err != nil {
			continue
		}
		text := htmlToText(raw)
		if strings.TrimSpace(text) == "" {
			continue
		}
		count++
		sb.WriteString(Marker(count))
		sb.WriteString("\n")
		sb.WriteString(text)
		sb.WriteString("\n\n")
	}
	if count == 0 {
		return "", 0, fmt.Errorf("parse: epub: no readable spine items")
	}
	return strings.TrimSpace(sb.String()) + "\n", count, nil
}

// LocalHTMLText extracts the readable article from an HTML file.
//
// go-readability is the same algorithm a browser's reader mode runs, which is
// the point: a saved web page is 90 % navigation, and indexing the navigation
// makes every document in the knowledge base retrieve for "Privacy Policy".
func localHTMLText(data []byte, sourceURL string) (string, int, error) {
	var base *url.URL
	if sourceURL != "" {
		if u, err := url.Parse(sourceURL); err == nil {
			base = u
		}
	}
	article, err := readability.FromReader(bytes.NewReader(data), base)
	if err != nil || strings.TrimSpace(article.TextContent) == "" {
		// Readability declines on pages that are not articles. Falling back to
		// a plain tag strip is better than refusing the upload.
		text := htmlToText(data)
		if strings.TrimSpace(text) == "" {
			return "", 0, fmt.Errorf("parse: html: no readable text")
		}
		return Marker(1) + "\n" + text + "\n", 1, nil
	}
	body := strings.TrimSpace(article.TextContent)
	if article.Title != "" {
		body = "# " + article.Title + "\n\n" + body
	}
	return Marker(1) + "\n" + body + "\n", 1, nil
}

// LocalPlainText passes Markdown and text through unchanged under one marker.
//
// Markdown is already the target format; re-parsing it would be a round trip
// through a model that can only lose fidelity.
func LocalPlainText(data []byte) (string, int, error) {
	text := strings.TrimSpace(string(data))
	if text == "" {
		return "", 0, fmt.Errorf("parse: file is empty")
	}
	// A stray marker in user text would be read as a page boundary by every
	// downstream consumer, so neutralise it rather than trusting the input.
	text = pageMarkerRE.ReplaceAllString(text, "<!-- page-ref -->")
	return Marker(1) + "\n" + text + "\n", 1, nil
}

// htmlToText strips tags with the stdlib-adjacent tokenizer readability already
// pulls in, dropping script and style content.
func htmlToText(raw []byte) string {
	doc, err := readability.FromReader(bytes.NewReader(raw), nil)
	if err == nil && strings.TrimSpace(doc.TextContent) != "" {
		return collapseBlankLines(doc.TextContent)
	}
	return collapseBlankLines(stripTags(string(raw)))
}

// stripTags is the last resort for markup readability refuses.
func stripTags(s string) string {
	var out strings.Builder
	depth := 0
	skipUntil := ""
	lower := strings.ToLower(s)
	for i := 0; i < len(s); i++ {
		if skipUntil != "" {
			if strings.HasPrefix(lower[i:], skipUntil) {
				i += len(skipUntil) - 1
				skipUntil = ""
			}
			continue
		}
		switch s[i] {
		case '<':
			if strings.HasPrefix(lower[i:], "<script") {
				skipUntil = "</script>"
				continue
			}
			if strings.HasPrefix(lower[i:], "<style") {
				skipUntil = "</style>"
				continue
			}
			depth++
		case '>':
			if depth > 0 {
				depth--
				out.WriteByte('\n')
			}
		default:
			if depth == 0 {
				out.WriteByte(s[i])
			}
		}
	}
	return out.String()
}

// LocalEPUBText is localEPUBText behind the parser panic guard (guard.go).
func LocalEPUBText(data []byte) (string, int, error) {
	return guarded("epub", func() (string, int, error) { return localEPUBText(data) })
}

// LocalHTMLText is localHTMLText behind the parser panic guard (guard.go).
func LocalHTMLText(data []byte, sourceURL string) (string, int, error) {
	return guarded("html", func() (string, int, error) { return localHTMLText(data, sourceURL) })
}

// maxEPUBMetadataBytes bounds container.xml and the .opf package document.
// Real ones are a few kilobytes; the library reads both with an unbounded
// copy, so they are measured here first.
const maxEPUBMetadataBytes = 8 << 20

// checkEPUBMetadata inflates the two metadata parts the EPUB library reads
// unbounded, under a limit, before the library is allowed to open the file.
func checkEPUBMetadata(data []byte) error {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return fmt.Errorf("parse: epub: %w", err)
	}
	if len(zr.File) > maxZipEntries {
		return fmt.Errorf("%w: %d entries", ErrTooLarge, len(zr.File))
	}
	for _, f := range zr.File {
		if f.Name != "META-INF/container.xml" && !strings.HasSuffix(strings.ToLower(f.Name), ".opf") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return fmt.Errorf("parse: epub: %w", err)
		}
		n, err := io.Copy(io.Discard, io.LimitReader(rc, maxEPUBMetadataBytes+1))
		rc.Close()
		if err != nil {
			return fmt.Errorf("parse: epub: %w", err)
		}
		if n > maxEPUBMetadataBytes {
			return fmt.Errorf("%w (%s)", ErrTooLarge, f.Name)
		}
	}
	return nil
}
