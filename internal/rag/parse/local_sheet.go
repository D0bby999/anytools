package parse

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"path"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"
)

// local_sheet.go — spreadsheets (.xlsx, .csv, .tsv) as page-marked Markdown.
//
// Conversion is local and deterministic: no model reads a spreadsheet. The
// approach follows anything-llm's collector (`convert/asXlsx.js`): one heading
// per sheet, dates read as the text the sheet shows, every other number read
// raw. The raw read is the point of that rule. A spreadsheet stores a long ID
// as a number, and Excel's General display (and excelize's formatted read,
// which rounds past 15 significant digits) turns 1234567890123456 into
// 1.23457E+15 — a passage that can no longer answer "which order was that?".

const (
	// MaxSheetUnzipBytes bounds what one workbook may inflate to, summed over
	// every entry. The declared sizes are checked before anything is inflated,
	// and archive/zip refuses an entry that inflates past its declared size, so
	// a header that lies is a read error rather than an allocation.
	MaxSheetUnzipBytes = 200 << 20
	// MaxSheetCells bounds the cells read across every sheet of one upload.
	// Blank padding counts: a single cell addressed at XFD1 makes a row of
	// 16,384, and an empty row counts as one, so a sheet whose only cell sits
	// on row 1,048,576 costs a million iterations of budget, not of surprise.
	MaxSheetCells = 2_000_000
	// maxSheetNameRunes caps a sheet name in its heading. Excel stops at 31;
	// a hand-built file does not have to.
	maxSheetNameRunes = 100
)

// ErrSheetEmpty is returned for a spreadsheet with no cells at all.
var ErrSheetEmpty = errors.New("parse: this spreadsheet is empty")

// ─────────────────────────────────────────────────────────────── CSV and rows

// CSVToMarkdown renders delimited text as a Markdown table.
//
// Moved here from the Drive connector so an uploaded .csv and an exported
// Google Sheet share one renderer. The rendering step is deliberate: a CSV
// handed to the chunker as plain text becomes one undifferentiated wall in
// which no column header is attached to the values under it; the same data as
// a Markdown table keeps the header row next to each cell, which is what makes
// a retrieved passage answerable.
//
// comma is ',' or '\t'. maxCells bounds the read; the caller picks it, because
// the Drive import and an upload have different budgets.
func CSVToMarkdown(data []byte, comma rune, maxCells int) ([]byte, error) {
	r := csv.NewReader(bytes.NewReader(data))
	r.Comma = comma
	// A spreadsheet's rows are genuinely ragged: trailing empty columns are
	// trimmed by the exporter. Refusing them would fail the import of a
	// perfectly ordinary sheet.
	r.FieldsPerRecord = -1
	// A TSV has no quoting convention; a stray quote mid-field is text.
	r.LazyQuotes = comma == '\t'

	var rows [][]string
	cells := 0
	for {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("parse: the rows could not be read: %w", err)
		}
		cells += len(rec)
		if cells > maxCells {
			return nil, fmt.Errorf("%w: over %d cells", ErrTooLarge, maxCells)
		}
		rows = append(rows, rec)
	}
	if len(rows) == 0 {
		return nil, ErrSheetEmpty
	}
	return []byte(RowsToMarkdown(rows)), nil
}

// RowsToMarkdown renders rows as a Markdown table whose first row is the
// header. Short rows are widened to the widest one.
func RowsToMarkdown(rows [][]string) string {
	width := 0
	for _, row := range rows {
		if len(row) > width {
			width = len(row)
		}
	}

	var b strings.Builder
	writeRow := func(row []string) {
		b.WriteString("|")
		for i := 0; i < width; i++ {
			cell := ""
			if i < len(row) {
				cell = row[i]
			}
			b.WriteString(" " + escapeCell(cell) + " |")
		}
		b.WriteString("\n")
	}

	if len(rows) == 0 {
		return ""
	}
	writeRow(rows[0])
	b.WriteString("|")
	for i := 0; i < width; i++ {
		b.WriteString(" --- |")
	}
	b.WriteString("\n")
	for _, row := range rows[1:] {
		writeRow(row)
	}
	return b.String()
}

// escapeCell keeps one cell inside one table cell.
//
// A pipe would end the column early and a newline would end the row, so a
// single cell containing either would silently reshape every row after it.
// It is also why no cell can forge a page marker: every table line starts
// with a pipe, and a marker is only read at the start of a line.
func escapeCell(s string) string {
	return strings.NewReplacer("|", `\|`, "\n", " ", "\r", "").Replace(s)
}

// localCSVText reads an uploaded .csv or .tsv as one page.
func localCSVText(data []byte, comma rune) (string, int, error) {
	// Excel writes a byte-order mark at the start of a "CSV UTF-8" export;
	// left in, it becomes part of the first header.
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	md, err := CSVToMarkdown(data, comma, MaxSheetCells)
	if err != nil {
		return "", 0, err
	}
	return Marker(1) + "\n" + string(md), 1, nil
}

// ───────────────────────────────────────────────────────────────────── XLSX

// localXLSXText renders a workbook, one visible sheet per page.
//
// Each page is headed `## Sheet: <name>`, which the chunker carries into every
// passage's heading path; that is how a citation names its sheet. Hidden
// sheets are skipped and the first page says which. Formulas show their cached
// values: recalculating would run the uploader's formulas on the server, and
// the cached value is what the sheet showed whoever saved it.
func localXLSXText(data []byte) (string, int, error) { return readXLSX(data, MaxSheetCells) }

// readXLSX is localXLSXText with the cell budget as a parameter, for tests.
func readXLSX(data []byte, maxCells int) (string, int, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", 0, fmt.Errorf("parse: xlsx: %w", err)
	}
	if len(zr.File) > maxZipEntries {
		return "", 0, fmt.Errorf("%w: %d parts", ErrTooLarge, len(zr.File))
	}
	var declared uint64
	for _, f := range zr.File {
		declared += f.UncompressedSize64
		if declared > MaxSheetUnzipBytes {
			return "", 0, fmt.Errorf("%w: the workbook expands past %d MB", ErrTooLarge, MaxSheetUnzipBytes>>20)
		}
	}
	// Then every part is inflated once to nowhere. archive/zip stops a part at
	// its declared size and checks its CRC, but excelize ignores that error and
	// keeps whatever it read, so a part that understates its size would be
	// parsed truncated, silently. Memory stays flat: nothing is kept.
	for _, f := range zr.File {
		if err := drainZipEntry(f); err != nil {
			return "", 0, fmt.Errorf("parse: xlsx part %q: %w", f.Name, err)
		}
	}

	// Both limits at the same value: excelize spills any part over the XML
	// limit to a temporary file, and the declared total above already bounds
	// what can be held in memory.
	xf, err := excelize.OpenReader(bytes.NewReader(data), excelize.Options{
		UnzipSizeLimit: MaxSheetUnzipBytes, UnzipXMLSizeLimit: MaxSheetUnzipBytes,
	})
	if err != nil {
		return "", 0, fmt.Errorf("parse: xlsx: %w", err)
	}
	defer xf.Close()

	book, err := readWorkbook(xf)
	if err != nil {
		return "", 0, err
	}
	var visible []workbookSheet
	var hidden []string
	for _, s := range book.sheets {
		if s.hidden {
			hidden = append(hidden, sheetName(s.name))
			continue
		}
		visible = append(visible, s)
	}
	if len(visible) == 0 {
		return "", 0, errors.New("parse: xlsx: the workbook has no visible sheets")
	}
	// Counted before any sheet is read, as a deck's slides are.
	if len(visible) > DefaultMaxPages {
		return "", 0, fmt.Errorf("%w: %d sheets, the limit is %d", ErrPageCapExceeded, len(visible), DefaultMaxPages)
	}

	dates, err := newDateFormatter(xf, book.date1904)
	if err != nil {
		return "", 0, err
	}
	defer dates.close()

	budget := maxCells
	var sb strings.Builder
	for i, s := range visible {
		rows, err := readSheetRows(xf, s, dates, &budget)
		if err != nil {
			return "", 0, err
		}
		sb.WriteString(Marker(i + 1))
		sb.WriteString("\n## Sheet: ")
		sb.WriteString(sheetName(s.name))
		sb.WriteString("\n\n")
		if i == 0 && len(hidden) > 0 {
			noun := "sheets were"
			if len(hidden) == 1 {
				noun = "sheet was"
			}
			fmt.Fprintf(&sb, "_%d hidden %s skipped: %s._\n\n", len(hidden), noun, strings.Join(hidden, ", "))
		}
		if len(rows) == 0 {
			sb.WriteString("_This sheet has no cells._\n\n")
			continue
		}
		sb.WriteString(RowsToMarkdown(rows))
		sb.WriteString("\n")
	}
	return strings.TrimSpace(sb.String()) + "\n", len(visible), nil
}

func drainZipEntry(f *zip.File) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	_, err = io.Copy(io.Discard, rc)
	return err
}

// sheetName is a sheet's name as one bounded heading line.
func sheetName(name string) string {
	name = strings.Join(strings.Fields(name), " ")
	if r := []rune(name); len(r) > maxSheetNameRunes {
		name = string(r[:maxSheetNameRunes])
	}
	if name == "" {
		return "Untitled"
	}
	return name
}

// readSheetRows reads one sheet's cell values, charging them to budget.
//
// Two passes over the same part. The first is a light stream of the sheet XML
// for what excelize's row iterator does not report — each cell's style, so a
// date can be told from a number, and its type, so a boolean reads TRUE. The
// second is excelize's raw iterator, which resolves shared and inline strings
// and cached formula values.
func readSheetRows(xf *excelize.File, s workbookSheet, dates *dateFormatter, budget *int) ([][]string, error) {
	overrides, err := sheetOverrides(xf, s.part, dates, budget)
	if err != nil {
		return nil, err
	}
	it, err := xf.Rows(s.name)
	if err != nil {
		return nil, fmt.Errorf("parse: xlsx sheet %q: %w", sheetName(s.name), err)
	}
	defer it.Close()

	var rows [][]string
	rowNum := 0
	for it.Next() {
		rowNum++
		cols, err := it.Columns(excelize.Options{RawCellValue: true})
		if err != nil {
			return nil, fmt.Errorf("parse: xlsx sheet %q: %w", sheetName(s.name), err)
		}
		*budget -= max(len(cols), 1)
		if *budget < 0 {
			return nil, fmt.Errorf("%w: too many cells", ErrTooLarge)
		}
		for c := range cols {
			if v, ok := overrides[cellAt{rowNum, c + 1}]; ok {
				cols[c] = v
			}
		}
		rows = append(rows, trimTrailingEmpty(cols))
	}
	if err := it.Error(); err != nil {
		return nil, fmt.Errorf("parse: xlsx sheet %q: %w", sheetName(s.name), err)
	}
	return trimEmptyRows(rows), nil
}

func isBlank(s string) bool { return strings.TrimSpace(s) == "" }

// trimTrailingEmpty drops the empty cells at the end of a row, which is what
// drops a sheet's empty trailing columns once every row has been trimmed.
func trimTrailingEmpty(row []string) []string {
	n := len(row)
	for n > 0 && isBlank(row[n-1]) {
		n--
	}
	return row[:n]
}

// trimEmptyRows drops empty rows at the end, and at the start, where they
// would otherwise become an empty header for the whole table.
func trimEmptyRows(rows [][]string) [][]string {
	for len(rows) > 0 && len(rows[len(rows)-1]) == 0 {
		rows = rows[:len(rows)-1]
	}
	for len(rows) > 0 && len(rows[0]) == 0 {
		rows = rows[1:]
	}
	return rows
}

// ─────────────────────────────────────────────────── workbook and sheet XML

type workbookSheet struct {
	name   string
	part   string // e.g. xl/worksheets/sheet1.xml
	hidden bool
}

type workbookInfo struct {
	sheets   []workbookSheet
	date1904 bool
}

// readWorkbook reads the sheet list, visibility and date system from
// xl/workbook.xml, and each sheet's part from the workbook's relationships.
// excelize keeps the part path private, and the style stream needs it.
func readWorkbook(xf *excelize.File) (workbookInfo, error) {
	var wb struct {
		Pr struct {
			Date1904 string `xml:"date1904,attr"`
		} `xml:"workbookPr"`
		Sheets []struct {
			Name  string     `xml:"name,attr"`
			State string     `xml:"state,attr"`
			Attrs []xml.Attr `xml:",any,attr"`
		} `xml:"sheets>sheet"`
	}
	if err := xml.Unmarshal(pkgPart(xf, "xl/workbook.xml"), &wb); err != nil {
		return workbookInfo{}, fmt.Errorf("parse: xlsx workbook: %w", err)
	}
	var rels struct {
		Rel []struct {
			ID     string `xml:"Id,attr"`
			Target string `xml:"Target,attr"`
		} `xml:"Relationship"`
	}
	if err := xml.Unmarshal(pkgPart(xf, "xl/_rels/workbook.xml.rels"), &rels); err != nil {
		return workbookInfo{}, fmt.Errorf("parse: xlsx relationships: %w", err)
	}
	targets := make(map[string]string, len(rels.Rel))
	for _, r := range rels.Rel {
		t := strings.ReplaceAll(r.Target, "\\", "/")
		if strings.HasPrefix(t, "/") {
			t = strings.TrimPrefix(path.Clean(t), "/")
		} else {
			t = path.Clean("xl/" + t)
		}
		targets[r.ID] = t
	}

	info := workbookInfo{date1904: wb.Pr.Date1904 == "1" || wb.Pr.Date1904 == "true"}
	for _, s := range wb.Sheets {
		var rid string
		for _, a := range s.Attrs {
			// r:id, in whichever relationships namespace the writer used
			// (transitional or strict).
			if a.Name.Local == "id" && a.Name.Space != "" {
				rid = a.Value
			}
		}
		info.sheets = append(info.sheets, workbookSheet{
			name:   s.Name,
			part:   targets[rid],
			hidden: s.State == "hidden" || s.State == "veryHidden",
		})
	}
	return info, nil
}

// pkgPart is one part's bytes as excelize holds them, or nil.
func pkgPart(xf *excelize.File, name string) []byte {
	if v, ok := xf.Pkg.Load(name); ok {
		if b, ok := v.([]byte); ok {
			return b
		}
	}
	return nil
}

type cellAt struct{ row, col int }

// sheetOverrides streams one sheet's XML and returns the display text of the
// cells the raw read gets wrong: date-styled numbers, which raw are serial day
// counts, and booleans, which raw are 1 and 0. Every cell is charged to the
// remaining budget here as well (without spending it — the row pass does), so
// a sheet of millions of cells is refused before the slower pass starts.
//
// Row and column numbering mirror excelize's iterator: an `r` attribute when
// present, otherwise one after the previous.
func sheetOverrides(xf *excelize.File, part string, dates *dateFormatter, budget *int) (map[cellAt]string, error) {
	raw := pkgPart(xf, part)
	out := map[cellAt]string{}
	if raw == nil {
		return out, nil
	}
	dec := xml.NewDecoder(bytes.NewReader(raw))
	var (
		row, col int
		cell     struct {
			at    cellAt
			typ   string
			style int
			inV   bool
			v     strings.Builder
		}
		inCell bool
		cells  = *budget
	)
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("parse: xlsx sheet: %w", err)
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "row":
				next := row + 1
				if v := attr(t, "r"); v != "" {
					if n, err := strconv.Atoi(v); err == nil && n > 0 {
						next = n
					}
				}
				row, col = next, 0
			case "c":
				cells--
				if cells < 0 {
					return nil, fmt.Errorf("%w: too many cells", ErrTooLarge)
				}
				col++
				if ref := attr(t, "r"); ref != "" {
					if c, _, err := excelize.CellNameToCoordinates(ref); err == nil {
						col = c
					}
				}
				inCell = true
				cell.at = cellAt{row, col}
				cell.typ = attr(t, "t")
				cell.style, _ = strconv.Atoi(attr(t, "s"))
				cell.v.Reset()
			case "v":
				cell.inV = inCell
			}
		case xml.CharData:
			if cell.inV {
				cell.v.Write(t)
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "v":
				cell.inV = false
			case "c":
				inCell = false
				v := strings.TrimSpace(cell.v.String())
				switch {
				case cell.typ == "b" && v == "1":
					out[cell.at] = "TRUE"
				case cell.typ == "b" && v == "0":
					out[cell.at] = "FALSE"
				case (cell.typ == "" || cell.typ == "n") && v != "":
					if text, ok := dates.format(cell.style, v); ok {
						out[cell.at] = text
					}
				}
			}
		}
	}
	return out, nil
}

func attr(t xml.StartElement, local string) string {
	for _, a := range t.Attr {
		if a.Name.Local == local && a.Name.Space == "" {
			return a.Value
		}
	}
	return ""
}

// ──────────────────────────────────────────────────────────────────── dates

// dateFormatter shows a date-styled number as the text the sheet displays.
//
// excelize applies a number format only to a cell it holds, so the value is
// written to one cell of a scratch workbook carrying the same format code and
// the same date system, and read back formatted. The library's own formatter
// does the work; nothing here reimplements Excel's date codes.
type dateFormatter struct {
	scratch *excelize.File
	// codes holds, per cell style of the uploaded workbook, the scratch style
	// to format with; a style that is not a date is absent.
	codes map[int]int
	cache map[[2]string]string
}

func newDateFormatter(xf *excelize.File, date1904 bool) (*dateFormatter, error) {
	d := &dateFormatter{scratch: excelize.NewFile(), codes: map[int]int{}, cache: map[[2]string]string{}}
	if date1904 {
		if err := d.scratch.SetWorkbookProps(&excelize.WorkbookPropsOptions{Date1904: &date1904}); err != nil {
			return nil, fmt.Errorf("parse: xlsx dates: %w", err)
		}
	}
	if xf.Styles == nil || xf.Styles.CellXfs == nil {
		return d, nil
	}
	custom := map[int]string{}
	if xf.Styles.NumFmts != nil {
		for _, nf := range xf.Styles.NumFmts.NumFmt {
			code := nf.FormatCode
			if nf.FormatCode16 != "" {
				code = nf.FormatCode16
			}
			custom[nf.NumFmtID] = code
		}
	}
	scratchByFmt := map[string]int{}
	for i, x := range xf.Styles.CellXfs.Xf {
		if x.NumFmtID == nil {
			continue
		}
		id := *x.NumFmtID
		style := &excelize.Style{NumFmt: id}
		key := "id:" + strconv.Itoa(id)
		// A custom code for an id wins over the built-in one, as it does when
		// excelize formats a cell.
		if code, ok := custom[id]; ok {
			if !isDateFormatCode(code) {
				continue
			}
			style = &excelize.Style{CustomNumFmt: &code}
			key = "code:" + code
		} else if !builtInDateFormat(id) {
			continue
		}
		sid, ok := scratchByFmt[key]
		if !ok {
			var err error
			if sid, err = d.scratch.NewStyle(style); err != nil {
				// A format excelize cannot take is shown raw, not refused.
				continue
			}
			scratchByFmt[key] = sid
		}
		d.codes[i] = sid
	}
	return d, nil
}

func (d *dateFormatter) close() { _ = d.scratch.Close() }

// format returns the displayed text of value under the cell style, or false
// when the style is not a date format.
func (d *dateFormatter) format(style int, value string) (string, bool) {
	sid, ok := d.codes[style]
	if !ok {
		return "", false
	}
	if _, err := strconv.ParseFloat(value, 64); err != nil {
		return "", false
	}
	key := [2]string{strconv.Itoa(sid), value}
	if text, ok := d.cache[key]; ok {
		return text, true
	}
	const sheet, cell = "Sheet1", "A1"
	if err := d.scratch.SetCellDefault(sheet, cell, value); err != nil {
		return "", false
	}
	if err := d.scratch.SetCellStyle(sheet, cell, cell, sid); err != nil {
		return "", false
	}
	text, err := d.scratch.GetCellValue(sheet, cell)
	if err != nil || text == "" {
		return "", false
	}
	d.cache[key] = text
	return text, true
}

// builtInDateFormat reports the built-in number formats that show a date or a
// time (ECMA-376 §18.8.30), including the locale-dependent date ids.
func builtInDateFormat(id int) bool {
	switch {
	case 14 <= id && id <= 22, 45 <= id && id <= 47:
		return true
	case 27 <= id && id <= 36, 50 <= id && id <= 58, 71 <= id && id <= 81:
		return true
	}
	return false
}

// isDateFormatCode reports whether a custom format code shows a date or time:
// it has a y, m, d, h or s outside quoted text, escapes, fill and padding
// characters and bracketed colours or locales. An elapsed-time bracket ([h],
// [mm], [ss]) counts.
func isDateFormatCode(code string) bool {
	lower := strings.ToLower(code)
	for i := 0; i < len(lower); i++ {
		switch c := lower[i]; c {
		case '"':
			j := strings.IndexByte(lower[i+1:], '"')
			if j < 0 {
				return false
			}
			i += j + 1
		case '\\', '_', '*':
			i++
		case '[':
			j := strings.IndexByte(lower[i+1:], ']')
			if j < 0 {
				return false
			}
			inner := strings.Trim(lower[i+1:i+1+j], "hms")
			if inner == "" && j > 0 {
				return true
			}
			i += j + 1
		case 'y', 'm', 'd', 'h', 's':
			return true
		}
	}
	return false
}

// LocalXLSXText is localXLSXText behind the parser panic guard (guard.go).
func LocalXLSXText(data []byte) (string, int, error) {
	return guarded("xlsx", func() (string, int, error) { return localXLSXText(data) })
}

// LocalCSVText is localCSVText behind the parser panic guard (guard.go).
// comma is ',' for .csv and '\t' for .tsv.
func LocalCSVText(data []byte, comma rune) (string, int, error) {
	return guarded("csv", func() (string, int, error) { return localCSVText(data, comma) })
}
