package exam

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg" // image.DecodeConfig reads the photo's size before pdfcpu decodes it
	_ "image/png"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/pdfcpu/pdfcpu/pkg/api"

	"github.com/D0bby999/anytools/internal/jobs"
	examprompts "github.com/D0bby999/anytools/internal/prompts/exam"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/tools"
)

// extract.go turns an uploaded paper into a template: read the pages (the
// learner's `parse` route, or the PDF's own text layer), then list the
// questions in batches of at most BatchPages pages, one model call each.
//
// Unit 0 of the job reads the paper and stores its page-marked Markdown;
// unit i ≥ 1 extracts batch i-1 and stores it. A retry resumes at the first
// unit not stored, so a paper read by a paid parse model is never read twice.

// maxImagePixels bounds a photographed paper before anything decodes it: a
// PNG header can promise a 60000×60000 image in a few bytes.
const maxImagePixels = 40_000_000

type extractPayload struct {
	TemplateID uuid.UUID `json:"template_id"`
}

// Upload checks a paper, stores it as the template's own object, and queues
// its extraction. The paper is not added to any knowledge base: a past paper
// is a template, not a study source.
func (s *Service) Upload(ctx context.Context, userID uuid.UUID, filename string, data []byte) (*Template, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("%w: the file is empty", ErrUnsupported)
	}
	if len(data) > MaxUploadBytes {
		return nil, errorf("the file must be %d MB or smaller", MaxUploadBytes>>20)
	}
	kind, paper, pages, err := s.preparePaper(ctx, userID, filename, data)
	if err != nil {
		return nil, err
	}
	// The questions are listed on the learner's Quizzes route: without one,
	// say so now rather than fail the job a moment later.
	if _, err := s.models.ChatFor(ctx, userID, functionQuiz); err != nil {
		return nil, err
	}

	sum := sha256.Sum256(data)
	t, err := s.store.CreateTemplate(ctx, Template{
		UserID: userID, Title: titleFrom(filename), Filename: trimRunes(filepath.Base(filename), 255),
		Kind: kind, SHA256: hex.EncodeToString(sum[:]), Bytes: int64(len(paper)), PageCount: pages,
		Status: TemplateQueued,
	})
	if err != nil {
		return nil, err
	}
	if err := s.files.PutObject(ctx, userID, nsPaper, t.ID, paper); err != nil {
		_, _ = s.store.DeleteTemplate(ctx, userID, t.ID)
		return nil, err
	}
	// Two attempts: a retry resumes at the first batch not yet stored.
	jobID, err := s.queue.Enqueue(ctx, userID, jobs.KindExtractExam, extractPayload{TemplateID: t.ID}, 2)
	if err != nil {
		_ = s.DeleteTemplate(ctx, userID, t.ID)
		return nil, err
	}
	if err := s.store.SetTemplateJob(ctx, userID, t.ID, jobID); err != nil {
		return nil, err
	}
	t.JobID = &jobID
	return t, nil
}

// preparePaper decides the kind, counts the pages, and returns the bytes to
// store: a photo becomes a one-page PDF, so every page a model reads is a
// page the browser can show.
func (s *Service) preparePaper(ctx context.Context, userID uuid.UUID, filename string, data []byte) (string, []byte, int, error) {
	switch strings.ToLower(filepath.Ext(strings.TrimSpace(filename))) {
	case ".png", ".jpg", ".jpeg":
		if ct := http.DetectContentType(data); ct != "image/png" && ct != "image/jpeg" {
			return "", nil, 0, fmt.Errorf("%w: the file is not a PNG or JPEG image", ErrUnsupported)
		}
		cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width*cfg.Height > maxImagePixels {
			return "", nil, 0, fmt.Errorf("%w: the image cannot be read or is too large", ErrUnsupported)
		}
		if err := s.needModel(ctx, userID); err != nil {
			return "", nil, 0, err
		}
		pdf, err := imageToPDF(data)
		if err != nil {
			return "", nil, 0, fmt.Errorf("%w: the image cannot be read", ErrUnsupported)
		}
		return KindImage, pdf, 1, nil
	}

	kind, _, err := parse.Detect(filename, data)
	if err != nil {
		return "", nil, 0, fmt.Errorf("%w: %s", ErrUnsupported, err)
	}
	var (
		pages int
		out   string
	)
	switch kind {
	case parse.KindPDF:
		out = KindPDF
		if pages, err = parse.PDFPageCount(data); err != nil {
			return "", nil, 0, fmt.Errorf("%w: the PDF cannot be read", ErrUnsupported)
		}
		if pages <= MaxPages {
			text, n, err := parse.LocalPDFText(data)
			if err != nil || parse.LooksScanned(text, n) {
				if err := s.needModel(ctx, userID); err != nil {
					return "", nil, 0, err
				}
			}
		}
	case parse.KindDOCX:
		out = KindDOCX
		if _, pages, err = parse.LocalDOCXText(data); err != nil {
			return "", nil, 0, fmt.Errorf("%w: the document cannot be read", ErrUnsupported)
		}
	case parse.KindText, parse.KindMD:
		out = KindText
		if _, pages, err = parse.LocalPlainText(data); err != nil {
			return "", nil, 0, fmt.Errorf("%w: the text cannot be read", ErrUnsupported)
		}
	default:
		return "", nil, 0, fmt.Errorf("%w: upload a PDF, a Word document, a text file or a photo", ErrUnsupported)
	}
	if pages < 1 {
		pages = 1
	}
	if pages > MaxPages {
		return "", nil, 0, errorf("the paper has %d pages; the limit is %d", pages, MaxPages)
	}
	return out, data, pages, nil
}

// needModel refuses a paper only a model can read when no `parse` route
// exists, with the one message the learner can act on.
func (s *Service) needModel(ctx context.Context, userID uuid.UUID) error {
	chain, err := s.parsers.ParserChain(ctx, userID)
	if err != nil {
		return err
	}
	if len(chain) == 0 {
		return ErrNeedsParseModel
	}
	return nil
}

// imageToPDF places a photo on a PDF page.
func imageToPDF(img []byte) ([]byte, error) {
	var out bytes.Buffer
	if err := api.ImportImages(nil, &out, []io.Reader{bytes.NewReader(img)}, nil, nil); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func titleFrom(filename string) string {
	base := filepath.Base(strings.TrimSpace(filename))
	title := trimRunes(strings.TrimSuffix(base, filepath.Ext(base)), 200)
	if title == "" || title == "." {
		return "Exam paper"
	}
	return title
}

// Batches are the extraction windows of a paper: [1,8], [9,16], ….
func Batches(pages int) []parse.Window { return parse.Windows(pages, BatchPages) }

// HandleExtract is the extract_exam job.
func (s *Service) HandleExtract(ctx context.Context, job *jobs.Job) error {
	var p extractPayload
	if err := json.Unmarshal(job.Payload, &p); err != nil {
		return jobs.Terminal(fmt.Errorf("exam: unreadable payload: %w", err))
	}
	t, err := s.store.GetTemplate(ctx, job.UserID, p.TemplateID)
	if err != nil {
		// Deleted while queued.
		return nil
	}
	if t.Status == TemplateReview || t.Status == TemplateReady || t.Status == TemplateFailed {
		return nil
	}

	windows := Batches(t.PageCount)
	r := &paperReader{s: s, t: t}
	err = s.queue.RunUnits(ctx, job, 1+len(windows), func(ctx context.Context, i int) (int, error) {
		if i == 0 {
			return r.read(ctx)
		}
		return r.extract(ctx, i-1, windows[i-1])
	})
	if err != nil {
		return terminalIfFinal(err)
	}
	return s.finishExtraction(ctx, t)
}

// paperReader holds what one run of the job has read, so each batch does not
// reload the paper.
type paperReader struct {
	s  *Service
	t  *Template
	md string
	// pages and textLayer are keyed by page number.
	pages     map[int]string
	lead      string
	textLayer map[int]string
}

// read is unit 0: the paper's page-marked Markdown, stored as an object.
func (r *paperReader) read(ctx context.Context) (int, error) {
	s, t := r.s, r.t
	if err := s.store.SetTemplateStatus(ctx, t.UserID, t.ID, TemplateParsing, ""); err != nil {
		return 0, err
	}
	data, err := s.files.GetObject(ctx, t.UserID, nsPaper, t.ID)
	if err != nil {
		return 0, jobs.Terminal(fmt.Errorf("exam: the stored paper is missing: %w", err))
	}

	var (
		md       string
		parsedBy string
		billed   int
	)
	switch t.Kind {
	case KindDOCX:
		md, _, err = parse.LocalDOCXText(data)
		parsedBy = "local:docx"
	case KindText:
		md, _, err = parse.LocalPlainText(data)
		parsedBy = "local:text"
	default:
		md, parsedBy, billed, err = r.readPDF(ctx, data)
	}
	if err != nil {
		return billed, err
	}
	if err := s.files.PutObject(ctx, t.UserID, nsParsed, t.ID, []byte(md)); err != nil {
		return billed, err
	}
	return billed, s.store.SetTemplateStatus(ctx, t.UserID, t.ID, TemplateExtracting, parsedBy)
}

// readPDF reads a PDF with the learner's parse chain when they have one, and
// with its own text layer otherwise, as knowledge-base documents are read.
func (r *paperReader) readPDF(ctx context.Context, data []byte) (string, string, int, error) {
	textLayer, pages, localErr := parse.LocalPDFText(data)
	readable := localErr == nil && !parse.LooksScanned(textLayer, pages)

	chain, err := r.s.parsers.ParserChain(ctx, r.t.UserID)
	if err != nil {
		return "", "", 0, err
	}
	if len(chain) == 0 {
		if !readable {
			return "", "", 0, jobs.Terminal(ErrNeedsParseModel)
		}
		return textLayer, "local:text layer", 0, nil
	}
	rep, err := r.s.batcher.ParsePDF(ctx, chain, data, nil)
	billed := max(len(rep.Batches), 1)
	if err != nil {
		if readable {
			slog.Warn("exam: every parse model failed; reading the text layer", "template", r.t.ID, "error", err)
			return textLayer, "local:text layer (the parse model failed)", billed, nil
		}
		return "", "", billed, err
	}
	by := rep.Provider
	if rep.Model != "" {
		by += "/" + rep.Model
	}
	return rep.Markdown, by, billed, nil
}

// load reads the stored Markdown once per run, and the text layer when a
// model read the PDF: the cross-check external findings §5 recommends.
func (r *paperReader) load(ctx context.Context) error {
	if r.pages != nil {
		return nil
	}
	raw, err := r.s.files.GetObject(ctx, r.t.UserID, nsParsed, r.t.ID)
	if err != nil {
		return jobs.Terminal(fmt.Errorf("exam: the read paper is missing: %w", err))
	}
	r.md = string(raw)
	r.lead, r.pages = splitPages(r.md)

	t, err := r.s.store.GetTemplate(ctx, r.t.UserID, r.t.ID)
	if err != nil {
		return err
	}
	if t.Kind == KindPDF && !strings.HasPrefix(t.ParsedBy, "local:") {
		if data, err := r.s.files.GetObject(ctx, t.UserID, nsPaper, t.ID); err == nil {
			if text, n, err := parse.LocalPDFText(data); err == nil && !parse.LooksScanned(text, n) {
				_, r.textLayer = splitPages(text)
			}
		}
	}
	return nil
}

// splitPages keys a page-marked document's pages by number. A document with
// no markers is all page 1.
func splitPages(md string) (string, map[int]string) {
	lead, bodies, nums := parse.SplitAtMarkers(md)
	out := map[int]string{}
	if len(nums) == 0 {
		out[1] = lead
		return "", out
	}
	for i, n := range nums {
		if out[n] != "" {
			out[n] += "\n\n" + bodies[i]
		} else {
			out[n] = bodies[i]
		}
	}
	return lead, out
}

// extract is unit b+1: one batch of pages, one model call, stored.
func (r *paperReader) extract(ctx context.Context, b int, w parse.Window) (int, error) {
	if err := r.load(ctx); err != nil {
		return 0, err
	}
	t := r.t
	var excerpt strings.Builder
	if w.Start == 1 && r.lead != "" {
		excerpt.WriteString(r.lead + "\n\n")
	}
	for p := w.Start; p <= w.End; p++ {
		fmt.Fprintf(&excerpt, "%s\n%s\n\n", parse.Marker(p), r.pages[p])
	}
	var user strings.Builder
	fmt.Fprintf(&user, "Extract every question that starts on pages %d to %d of this %d-page paper.\n\n",
		w.Start, w.End, t.PageCount)
	user.WriteString(tools.Wrap(t.Title+" pages "+pageRange(w), "exam:"+t.ID.String()+":pages", excerpt.String()))
	if next, ok := r.pages[w.End+1]; ok && strings.TrimSpace(next) != "" {
		fmt.Fprintf(&user, "\n\nContext only (page %d), to finish a question that runs over; start nothing here:\n\n", w.End+1)
		user.WriteString(tools.Wrap(t.Title+" page "+strconv.Itoa(w.End+1), "exam:"+t.ID.String()+":context",
			parse.Marker(w.End+1)+"\n"+next))
	}
	if len(r.textLayer) > 0 {
		var layer strings.Builder
		for p := w.Start; p <= w.End; p++ {
			fmt.Fprintf(&layer, "%s\n%s\n\n", parse.Marker(p), r.textLayer[p])
		}
		user.WriteString("\n\nThe same pages from the PDF's own text layer, for checking spellings and diacritics:\n\n")
		user.WriteString(tools.Wrap(t.Title+" text layer "+pageRange(w), "exam:"+t.ID.String()+":text-layer", layer.String()))
		slog.Info("exam: extraction cross-checked against the text layer",
			"template", t.ID, "pages", pageRange(w), "parsed_by", t.ParsedBy)
	}

	provider, err := r.s.models.ChatFor(ctx, t.UserID, functionQuiz)
	if err != nil {
		return 0, err
	}
	var reply struct {
		Questions []rawItem `json:"questions"`
	}
	if err := askJSON(ctx, provider, examprompts.Extract, user.String(), &reply); err != nil {
		return 1, err
	}
	items := make([]Item, 0, len(reply.Questions))
	for _, q := range reply.Questions {
		items = append(items, q.item())
	}
	return 1, r.s.store.SaveBatch(ctx, t.UserID, t.ID, b, items)
}

func pageRange(w parse.Window) string {
	if w.Start == w.End {
		return strconv.Itoa(w.Start)
	}
	return fmt.Sprintf("%d–%d", w.Start, w.End)
}

// finishExtraction merges the batches in order, validates the whole, and
// moves the template to review.
func (s *Service) finishExtraction(ctx context.Context, t *Template) error {
	batches, err := s.store.Batches(ctx, t.UserID, t.ID)
	if err != nil {
		return err
	}
	var merged []Item
	seen := map[string]bool{}
	for b := 0; b < len(Batches(t.PageCount)); b++ {
		for _, it := range batches[b] {
			// The same number twice is a question two batches both claimed.
			key := strings.ToLower(strings.TrimSpace(it.Number))
			if key != "" && seen[key] {
				continue
			}
			seen[key] = true
			merged = append(merged, it)
		}
	}
	switch {
	case len(merged) == 0:
		return s.store.FailTemplate(ctx, t.UserID, t.ID, "no questions were found in this paper")
	case len(merged) > MaxItems:
		return s.store.FailTemplate(ctx, t.UserID, t.ID,
			fmt.Sprintf("this paper has %d questions; a template holds at most %d", len(merged), MaxItems))
	}
	items, warnings := ValidateItems(merged, t.PageCount)
	return s.store.FinishExtraction(ctx, t.UserID, t.ID, items, warnings, TotalPoints(items))
}

// rawItem is one question as the extractor replies. Numbers and points arrive
// as numbers or strings, depending on the model.
type rawItem struct {
	Number       flex         `json:"number"`
	Type         string       `json:"type"`
	Topic        string       `json:"topic"`
	StemMD       string       `json:"stem_md"`
	Options      []Option     `json:"options"`
	AnswerKey    flex         `json:"answer_key"`
	Points       flex         `json:"points"`
	Difficulty   string       `json:"difficulty"`
	SourcePage   flex         `json:"source_page"`
	FigurePage   flex         `json:"figure_page"`
	SubQuestions []rawSubItem `json:"sub_questions"`
}

type rawSubItem struct {
	Label  flex   `json:"label"`
	StemMD string `json:"stem_md"`
	Points flex   `json:"points"`
}

func (q rawItem) item() Item {
	it := Item{
		Number: q.Number.String(), Type: q.Type, Topic: q.Topic, StemMD: q.StemMD, Options: q.Options,
		AnswerKey: q.AnswerKey.String(), Points: q.Points.Float(), Difficulty: q.Difficulty,
		SourcePage: int(q.SourcePage.Float()),
	}
	if fp := int(q.FigurePage.Float()); fp > 0 {
		it.FigurePage = &fp
	}
	for _, sq := range q.SubQuestions {
		it.SubQuestions = append(it.SubQuestions, SubQuestion{Label: sq.Label.String(), StemMD: sq.StemMD, Points: sq.Points.Float()})
	}
	return it
}

// flex is a JSON scalar read as whatever it is: "3", 3, "3 points", null.
type flex struct{ raw json.RawMessage }

func (f *flex) UnmarshalJSON(b []byte) error {
	f.raw = append(json.RawMessage(nil), b...)
	return nil
}

func (f flex) String() string {
	var s string
	if json.Unmarshal(f.raw, &s) == nil {
		return strings.TrimSpace(s)
	}
	var n json.Number
	if json.Unmarshal(f.raw, &n) == nil {
		return n.String()
	}
	return ""
}

func (f flex) Float() float64 {
	var n float64
	if json.Unmarshal(f.raw, &n) == nil {
		return n
	}
	if m := numberPart.FindString(f.String()); m != "" {
		v, err := strconv.ParseFloat(strings.ReplaceAll(m, ",", "."), 64)
		if err == nil {
			return v
		}
	}
	return 0
}

// numberPart is the number in "2 points" or "1,5 điểm".
var numberPart = regexp.MustCompile(`\d+(?:[.,]\d+)?`)
