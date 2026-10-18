// Package parse turns an uploaded file into Markdown carrying page markers we
// can cite.
//
// The contract this package enforces comes straight out of Spike B
// (reports/spike-parse.md), where every rule below was exercised rather than
// assumed:
//
//   - Pages are counted and SPLIT locally. The model is handed one window at a
//     time together with the absolute page numbers that window is known to
//     cover. It never gets to decide what page something was on.
//   - A truncated response is re-parsed as two half windows, recursing to a
//     single page. The spike forced ten MAX_TOKENS events this way and page
//     accuracy stayed 10/10, because the numbers survive truncation — they do
//     not come from the model.
//   - A batch producing fewer than 400 Markdown characters per input page is
//     flagged. Healthy batches measured 3.4–4.4k, so the floor is ten times
//     below the observed minimum and still caught 8 of the 10 truncated
//     batches independently of the provider's own finish reason.
//
// Phase 4 owns the provider clients (parser.go, gemini.go, openai.go,
// anthropic.go). This file and its local_* siblings own the splitting, the
// batching, the truncation rule and the no-key fallbacks.
package parse

import (
	"bytes"
	"errors"
	"fmt"
	"strconv"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// DefaultMaxPages is the per-document page cap.
//
// It is not a round number chosen for looks. Spike B measured ~7 s per page
// through Gemini, so 400 pages is already ~47 minutes of wall clock for one
// document, and it sits under Gemini's own 1000-page API ceiling. Phase 11
// owns the security review of this number.
const DefaultMaxPages = 400

// DefaultBatchPages is the page window handed to a model in one call.
const DefaultBatchPages = 10

// DefaultMinCharsPerPage is the short-parse floor. See the package comment.
const DefaultMinCharsPerPage = 400

// ErrPageCapExceeded is returned for a document longer than the cap.
var ErrPageCapExceeded = errors.New("parse: document exceeds the page cap")

// ErrNotPaginated is returned by SplitPDF for input that is not a PDF.
var ErrNotPaginated = errors.New("parse: input is not a paginated document")

// pdfConfig is deliberately relaxed about validation. A PDF that a viewer opens
// but a strict parser rejects is a file the user will insist is fine, and they
// will be right; refusing it teaches them the product is broken.
func pdfConfig() *model.Configuration {
	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	return conf
}

// PDFPageCount reports how many pages a PDF has, reading it locally.
//
// Counting before parsing is what makes the page cap enforceable at upload
// time rather than after forty minutes of provider calls.
func PDFPageCount(data []byte) (int, error) {
	n, err := api.PageCount(bytes.NewReader(data), pdfConfig())
	if err != nil {
		return 0, fmt.Errorf("parse: pdf page count: %w", err)
	}
	if n <= 0 {
		return 0, errors.New("parse: pdf reports zero pages")
	}
	return n, nil
}

// SplitPDF returns a standalone PDF containing pages [start,end] of data.
//
// This is the whole reason the caller can state an absolute page range to a
// model and be believed: the bytes really do contain those pages and only
// those pages.
func SplitPDF(data []byte, start, end int) ([]byte, error) {
	if start < 1 || end < start {
		return nil, fmt.Errorf("parse: bad page range %d-%d", start, end)
	}
	var out bytes.Buffer
	sel := []string{strconv.Itoa(start) + "-" + strconv.Itoa(end)}
	if start == end {
		sel = []string{strconv.Itoa(start)}
	}
	if err := api.Trim(bytes.NewReader(data), &out, sel, pdfConfig()); err != nil {
		return nil, fmt.Errorf("parse: split pdf %d-%d: %w", start, end, err)
	}
	return out.Bytes(), nil
}

// Window is one page range to be parsed in a single call.
type Window struct{ Start, End int }

// Windows divides pageCount pages into batches of at most size.
func Windows(pageCount, size int) []Window {
	if size < 1 {
		size = DefaultBatchPages
	}
	var out []Window
	for start := 1; start <= pageCount; start += size {
		end := start + size - 1
		if end > pageCount {
			end = pageCount
		}
		out = append(out, Window{Start: start, End: end})
	}
	return out
}
