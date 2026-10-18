package parse

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// ─────────────────────────────────────────────────── the seam phase 4 fills

// PageFinish is why a provider stopped generating. Only the provider's own
// stop field may produce these; "the text looks short" is a separate signal
// (isShortParse), because conflating the two hides the case where a model
// stops cleanly on a page it could not read.
type PageFinish string

const (
	// PageFinishStop is a clean completion.
	PageFinishStop PageFinish = "stop"
	// PageFinishTruncated is an output-length cutoff: Gemini MAX_TOKENS,
	// OpenAI incomplete/max_output_tokens, Anthropic max_tokens.
	PageFinishTruncated PageFinish = "truncated"
	// PageFinishOther is any other terminal reason (a safety stop, a filter).
	PageFinishOther PageFinish = "other"
)

// PageRequest is one window of a document handed to a provider.
type PageRequest struct {
	// Data is a standalone document containing exactly pages Start..End.
	Data []byte
	// MIME is Data's media type, normally application/pdf.
	MIME string
	// Start and End are the ABSOLUTE page numbers Data covers in the source
	// document. The provider is told these numbers and must use them; the
	// caller verifies that it did.
	Start, End int
}

// PageResult is one window's parsed output.
type PageResult struct {
	Markdown     string
	Finish       PageFinish
	Model        string
	InputTokens  int
	OutputTokens int
}

// PageParser converts one page window to Markdown.
//
// This is the interface phase 4's provider clients satisfy; it is re-exported
// as knowledge.Parser, which is the name the merge wires up. Implementations
// MUST retry 429 and 5xx with backoff internally — Spike B lost pages 11–20 of
// a 29-page document to a single transient 503 and reported success.
type PageParser interface {
	ParsePages(ctx context.Context, req PageRequest) (PageResult, error)
	// ProviderName is the stable id recorded in documents.processed_by, e.g.
	// "gemini". It is shown to the user, so it names the lane, not the model.
	ProviderName() string
}

// ─────────────────────────────────────────────────────────── batch reporting

// BatchReport is one measured window, kept for the same reason Spike B kept
// them: when a document comes out wrong, the per-window record is the only
// thing that says which window and why.
type BatchReport struct {
	Start        int    `json:"start_page"`
	End          int    `json:"end_page"`
	Model        string `json:"model,omitempty"`
	Finish       string `json:"finish_reason"`
	Retried      bool   `json:"retried_smaller_window"`
	ShortParse   bool   `json:"short_parse"`
	Chars        int    `json:"markdown_chars"`
	InputTokens  int    `json:"input_tokens"`
	OutputTokens int    `json:"output_tokens"`
	Error        string `json:"error,omitempty"`
}

// Report is the outcome of parsing one document.
type Report struct {
	Markdown  string
	PageCount int
	// Provider and Model name the lane that actually produced Markdown — the
	// thing shown in the UI badge and stored in documents.processed_by. RT-14:
	// a chain that silently re-sends a document to the next provider is exactly
	// what the user must be able to see.
	Provider string
	Model    string
	// Downgraded is true when the first provider in the chain was not the one
	// that succeeded.
	Downgraded       bool
	Batches          []BatchReport
	TruncationEvents int
	ShortParseFlags  int
}

// Options tune the batching rules. The zero value is the measured default.
type Options struct {
	BatchPages      int
	MaxPages        int
	MinCharsPerPage int
	// MaxRetryDepth bounds the halving recursion. 10 → 5 → 2 → 1 is depth 3;
	// four leaves room without allowing a runaway on a pathological provider.
	MaxRetryDepth int
}

func (o Options) withDefaults() Options {
	if o.BatchPages <= 0 {
		o.BatchPages = DefaultBatchPages
	}
	if o.MaxPages <= 0 {
		o.MaxPages = DefaultMaxPages
	}
	if o.MinCharsPerPage <= 0 {
		o.MinCharsPerPage = DefaultMinCharsPerPage
	}
	if o.MaxRetryDepth <= 0 {
		o.MaxRetryDepth = 4
	}
	return o
}

// FallbackFunc is called when one provider in the chain gives up and the next
// is about to be tried. The knowledge service turns it into a document event,
// which is what makes a silent downgrade visible (RT-14).
type FallbackFunc func(from, to string, cause error)

// Batcher applies the page-window, truncation and short-parse rules on top of
// whatever PageParser it is given.
type Batcher struct{ opts Options }

// NewBatcher returns a Batcher.
func NewBatcher(opts Options) *Batcher { return &Batcher{opts: opts.withDefaults()} }

// Options returns the effective settings, for handlers that report them.
func (b *Batcher) Options() Options { return b.opts }

// ErrNoParser is returned when the chain is empty — the user has configured no
// model that can read a PDF.
var ErrNoParser = errors.New("parse: no model is configured to read this document")

// ParsePDF parses a whole PDF through a chain of providers.
//
// The chain is tried in order and the FIRST one to produce a usable document
// wins. A provider is abandoned on a transport/auth error or on a window that
// stays broken after the halving retry; the next one starts the document from
// page 1, because a document half-parsed by one model and half by another has
// no single provenance to record and no consistent style to chunk.
func (b *Batcher) ParsePDF(ctx context.Context, chain []PageParser, data []byte, onFallback FallbackFunc) (Report, error) {
	if len(chain) == 0 {
		return Report{}, ErrNoParser
	}
	pages, err := PDFPageCount(data)
	if err != nil {
		return Report{}, err
	}
	if pages > b.opts.MaxPages {
		return Report{}, fmt.Errorf("%w: %d pages, limit %d", ErrPageCapExceeded, pages, b.opts.MaxPages)
	}

	var lastErr error
	for i, parser := range chain {
		rep, err := b.parseWith(ctx, parser, data, pages)
		if err == nil {
			rep.Downgraded = i > 0
			return rep, nil
		}
		// A cancelled context is the user going away, not a provider failing.
		// Walking the rest of the chain here would spend three more accounts'
		// quota on a request nobody is waiting for.
		if ctx.Err() != nil {
			return Report{}, ctx.Err()
		}
		lastErr = err
		if i+1 < len(chain) && onFallback != nil {
			onFallback(parser.ProviderName(), chain[i+1].ProviderName(), err)
		}
	}
	return Report{}, fmt.Errorf("parse: every configured model failed: %w", lastErr)
}

func (b *Batcher) parseWith(ctx context.Context, parser PageParser, data []byte, pages int) (Report, error) {
	rep := Report{PageCount: pages, Provider: parser.ProviderName()}
	var md strings.Builder

	for _, w := range Windows(pages, b.opts.BatchPages) {
		text, batches, err := b.parseWindow(ctx, parser, data, w.Start, w.End, 0, false)
		rep.Batches = append(rep.Batches, batches...)
		if err != nil {
			return rep, err
		}
		md.WriteString(text)
	}

	for _, br := range rep.Batches {
		if br.Finish == string(PageFinishTruncated) {
			rep.TruncationEvents++
		}
		if br.ShortParse {
			rep.ShortParseFlags++
		}
		// The model id is whatever the provider reported; they are identical
		// across windows in practice, and taking the last one is honest if a
		// provider ever rotates a model mid-document.
		if br.Model != "" {
			rep.Model = br.Model
		}
	}
	rep.Markdown = strings.TrimSpace(md.String()) + "\n"
	return rep, nil
}

// parseWindow parses one window and applies the truncation rule.
//
// On a truncated response, or on markers the splitter cannot vouch for, the
// same pages are re-parsed as two smaller windows, recursing to a single page
// where the splitter's number is authoritative. A single page that is STILL
// truncated is a hard failure for this provider, never a silent short parse —
// Spike B's whole point was that the quiet version of this failure looks like
// a successful parse until someone opens a citation.
func (b *Batcher) parseWindow(ctx context.Context, parser PageParser, data []byte, start, end, depth int, isRetry bool) (string, []BatchReport, error) {
	pages := end - start + 1

	slice, err := SplitPDF(data, start, end)
	if err != nil {
		return "", []BatchReport{{Start: start, End: end, Retried: isRetry, Error: err.Error()}}, err
	}

	res, err := parser.ParsePages(ctx, PageRequest{Data: slice, MIME: "application/pdf", Start: start, End: end})
	if err != nil {
		return "", []BatchReport{{Start: start, End: end, Retried: isRetry, Error: err.Error()}}, err
	}

	text := strings.TrimSpace(res.Markdown)
	br := BatchReport{
		Start: start, End: end, Retried: isRetry,
		Model:        res.Model,
		Finish:       string(res.Finish),
		Chars:        len(text),
		InputTokens:  res.InputTokens,
		OutputTokens: res.OutputTokens,
	}
	br.ShortParse = isShortParse(text, pages, b.opts.MinCharsPerPage)

	truncated := res.Finish == PageFinishTruncated
	markersUnusable := checkMarkers(text, start, end) == markersBad

	if pages == 1 {
		// Base case. The splitter owns the number outright here, so bad markers
		// are simply overwritten; only a genuinely truncated or empty page is a
		// failure.
		if truncated {
			err := fmt.Errorf("parse: page %d still truncated at a one-page window", start)
			br.Error = err.Error()
			return "", []BatchReport{br}, err
		}
		return authoritativeSinglePage(text, start) + "\n", []BatchReport{br}, nil
	}

	if truncated || markersUnusable || br.ShortParse {
		if depth >= b.opts.MaxRetryDepth {
			err := fmt.Errorf("parse: pages %d-%d unusable after %d halvings (finish=%s markers_ok=%t short=%t)",
				start, end, depth, res.Finish, !markersUnusable, br.ShortParse)
			br.Error = err.Error()
			return "", []BatchReport{br}, err
		}
		mid := start + pages/2 - 1
		leftText, leftBatches, err := b.parseWindow(ctx, parser, data, start, mid, depth+1, true)
		if err != nil {
			return "", append([]BatchReport{br}, leftBatches...), err
		}
		rightText, rightBatches, err := b.parseWindow(ctx, parser, data, mid+1, end, depth+1, true)
		batches := append(append([]BatchReport{br}, leftBatches...), rightBatches...)
		if err != nil {
			return "", batches, err
		}
		return leftText + rightText, batches, nil
	}

	return text + "\n\n", []BatchReport{br}, nil
}

// ShortParseAgainstTextLayer reports whether an LLM parse produced
// implausibly less text than the document's own text layer.
//
// The phase rule: under 60 % of the local extraction means the model skipped
// material, and the document is failed rather than indexed. It only applies
// when the text layer exists at all — a scanned PDF extracts to nothing, and
// 60 % of nothing would pass everything.
func ShortParseAgainstTextLayer(parsed, localTextLayer string) bool {
	local := len(strings.TrimSpace(localTextLayer))
	if local < 1000 {
		return false
	}
	return len(strings.TrimSpace(parsed)) < local*60/100
}
