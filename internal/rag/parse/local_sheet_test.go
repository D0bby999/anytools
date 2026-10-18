package parse

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

var updateSheets = flag.Bool("update-sheets", false, "rewrite testdata/*.xlsx from the XML in this file")

// The workbook fixture is written by hand, part by part, rather than by a
// spreadsheet library, because the cases under test are exactly the ones a
// writer library normalises away: a formula with a cached value, an ID longer
// than a float holds, a date stored as a styled serial number, a hidden sheet.
// testdata/sheets.xlsx is this map zipped (`go test -run TestSheetFixtures
// -update-sheets` rewrites it) and the tests read the committed file.
var sheetsWorkbook = map[string]string{
	"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`,
	"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
	"xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="Budget" sheetId="1" r:id="rId1"/>
<sheet name="Secrets" sheetId="2" state="hidden" r:id="rId2"/>
<sheet name="Orders" sheetId="3" r:id="rId3"/>
</sheets>
</workbook>`,
	"xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet3.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`,
	// cellXfs: 0 General, 1 built-in date (14), 2 a custom date code, 3 "0.00",
	// a number format that is not a date and must not reshape the raw value.
	"xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\-mm\-dd"/></numFmts>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`,
	"xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="10" uniqueCount="10">
<si><t>Item</t></si><si><t>Amount</t></si><si><t>Due</t></si><si><t>Rent</t></si><si><t>Food</t></si>
<si><t>Total</t></si><si><t>OrderID</t></si><si><t>Paid</t></si><si><t>HIDDEN-SHEET-MARKER</t></si><si><t>a | b</t></si>
</sst>`,
	// Budget: a built-in date, a custom date, a "0.00" number, a formula with
	// its cached value, and a styled but empty cell far to the right and below
	// that must not widen or lengthen the table.
	"xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>1200</v></c><c r="C2" s="1"><v>45000</v></c></row>
<row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" s="3"><v>300.5</v></c><c r="C3" s="2"><v>45001</v></c></row>
<row r="4"><c r="A4" t="s"><v>5</v></c><c r="B4"><f>SUM(B2:B3)</f><v>1500.5</v></c><c r="C4" t="s"><v>9</v></c></row>
<row r="9"><c r="G9" s="1"/></row>
</sheetData>
</worksheet>`,
	"xl/worksheets/sheet2.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="s"><v>8</v></c></row></sheetData>
</worksheet>`,
	// Orders: a 19-digit ID, past what a float64 holds, and a boolean.
	"xl/worksheets/sheet3.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1"><c r="A1" t="s"><v>6</v></c><c r="B1" t="s"><v>7</v></c></row>
<row r="2"><c r="A2"><v>1234567890123456789</v></c><c r="B2" t="b"><v>1</v></c></row>
</sheetData>
</worksheet>`,
}

// zipParts zips named parts in a stable order.
func zipParts(t *testing.T, parts map[string]string) []byte {
	t.Helper()
	names := make([]string, 0, len(parts))
	for name := range parts {
		names = append(names, name)
	}
	// [Content_Types].xml first, as Office writes it; the rest sorted.
	sortStrings(names)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range names {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(parts[name])); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func sortStrings(s []string) {
	for i := range s {
		for j := i + 1; j < len(s); j++ {
			if s[j] < s[i] {
				s[i], s[j] = s[j], s[i]
			}
		}
	}
}

// withParts is the fixture workbook with some parts replaced.
func withParts(over map[string]string) map[string]string {
	out := make(map[string]string, len(sheetsWorkbook))
	for k, v := range sheetsWorkbook {
		out[k] = v
	}
	for k, v := range over {
		out[k] = v
	}
	return out
}

func TestSheetFixtures(t *testing.T) {
	path := filepath.Join("testdata", "sheets.xlsx")
	want := zipParts(t, sheetsWorkbook)
	if *updateSheets {
		if err := os.WriteFile(path, want, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (run with -update-sheets to write it)", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("testdata/sheets.xlsx is stale; rerun with -update-sheets")
	}
}

// readFixture parses the committed workbook through the same door an upload
// takes: Detect, then ParseLocal.
func readFixture(t *testing.T) LocalResult {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "sheets.xlsx"))
	if err != nil {
		t.Fatal(err)
	}
	kind, mime, err := Detect("Budget 2023.xlsx", data)
	if err != nil {
		t.Fatalf("Detect: %v", err)
	}
	if kind != KindXLSX || mime != MimeXLSX {
		t.Fatalf("Detect = %q %q", kind, mime)
	}
	res, err := ParseLocal(kind, data)
	if err != nil {
		t.Fatalf("ParseLocal: %v", err)
	}
	return res
}

func TestXLSX_EachVisibleSheetIsOnePage(t *testing.T) {
	res := readFixture(t)
	if res.Pages != 2 || res.Parser != "local:excelize" {
		t.Fatalf("pages = %d, parser = %q; want 2 visible sheets read locally", res.Pages, res.Parser)
	}
	md := res.Markdown
	budget := strings.Index(md, Marker(1)+"\n## Sheet: Budget\n")
	orders := strings.Index(md, Marker(2)+"\n## Sheet: Orders\n")
	if budget != 0 || orders <= budget {
		t.Fatalf("each sheet must open its own page under its name, in workbook order:\n%s", md)
	}
}

// A long ID is the reason numbers are read raw. Excel's General display and a
// formatted read both shorten it, and a shortened ID matches nothing.
func TestXLSX_LongIDKeepsEveryDigit(t *testing.T) {
	md := readFixture(t).Markdown
	if !strings.Contains(md, "| 1234567890123456789 | TRUE |") {
		t.Fatalf("the 19-digit ID must survive digit for digit:\n%s", md)
	}
	// A number format that is not a date leaves the stored value alone too.
	if !strings.Contains(md, "| Food | 300.5 |") {
		t.Fatalf("a 0.00-formatted number must be its raw value:\n%s", md)
	}
}

func TestXLSX_DateShowsItsDisplayedText(t *testing.T) {
	md := readFixture(t).Markdown
	// 45000 is 15 March 2023: the built-in short date and the custom code
	// each read as the sheet shows them, never as the serial number.
	for _, want := range []string{"| Rent | 1200 | 03-15-23 |", "| Food | 300.5 | 2023-03-16 |"} {
		if !strings.Contains(md, want) {
			t.Errorf("missing %q in:\n%s", want, md)
		}
	}
	if strings.Contains(md, "45000") || strings.Contains(md, "45001") {
		t.Errorf("a date must not appear as its serial number:\n%s", md)
	}
}

func TestXLSX_HiddenSheetIsSkippedAndSaidSo(t *testing.T) {
	md := readFixture(t).Markdown
	if strings.Contains(md, "HIDDEN-SHEET-MARKER") {
		t.Fatalf("a hidden sheet's cells must not be read:\n%s", md)
	}
	if !strings.Contains(md, "_1 hidden sheet was skipped: Secrets._") {
		t.Fatalf("the page must say a hidden sheet was skipped:\n%s", md)
	}
}

func TestXLSX_FormulaShowsItsCachedValue(t *testing.T) {
	md := readFixture(t).Markdown
	if !strings.Contains(md, "| Total | 1500.5 |") || strings.Contains(md, "SUM(") {
		t.Fatalf("a formula must read as its cached value, not its text:\n%s", md)
	}
}

func TestXLSX_TrailingEmptyRowsAndColumnsAreDropped(t *testing.T) {
	md := readFixture(t).Markdown
	budget := md[:strings.Index(md, Marker(2))]
	if !strings.Contains(budget, "| Item | Amount | Due |\n| --- | --- | --- |\n") {
		t.Fatalf("a styled empty cell at G9 must not widen the table:\n%s", budget)
	}
	if got := strings.Count(budget, "\n|"); got != 5 {
		t.Fatalf("Budget has a header, a rule and three rows; got %d table lines:\n%s", got, budget)
	}
	// And a pipe inside a cell stays inside it.
	if !strings.Contains(budget, `a \| b`) {
		t.Fatalf("a pipe in a cell must be escaped:\n%s", budget)
	}
}

// The heading path is what names the sheet in a citation, so it must survive
// the chunker as "Sheet: <name>". Checked against the heading line itself
// here; internal/rag/chunk owns the splitting.
func TestXLSX_SheetNameIsOneBoundedLine(t *testing.T) {
	if got := sheetName("  Q1\nbudget \t "); got != "Q1 budget" {
		t.Fatalf("sheetName = %q", got)
	}
	if got := sheetName(strings.Repeat("é", 300)); len([]rune(got)) != maxSheetNameRunes {
		t.Fatalf("a long name must be capped at %d runes, got %d", maxSheetNameRunes, len([]rune(got)))
	}
}

func TestDetect_XLSXNeedsAWorkbookPart(t *testing.T) {
	// A .docx renamed to .xlsx is a zip without xl/workbook.xml.
	docx := zipParts(t, map[string]string{"word/document.xml": "<w:document/>"})
	if _, _, err := Detect("renamed.xlsx", docx); !errors.Is(err, ErrUnsupportedType) {
		t.Fatalf("a zip with no workbook must be refused, got %v", err)
	}
	if _, _, err := Detect("text.xlsx", []byte("Item,Amount\n")); !errors.Is(err, ErrUnsupportedType) {
		t.Fatalf("a non-zip .xlsx must be refused, got %v", err)
	}
	if _, _, err := Detect("binary.csv", []byte("PK\x03\x04\x00\x00\x00binary")); !errors.Is(err, ErrUnsupportedType) {
		t.Fatalf("a binary .csv must be refused, got %v", err)
	}
}

// ─────────────────────────────────────────────────────────────────── bombs

// A workbook whose parts declare more than 200 MB is refused before anything
// is inflated. The bytes here really do inflate that far: 201 MB of zeros
// deflate to a few hundred kilobytes.
func TestXLSX_RefusesAnInflationBomb(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	// The fastest level: the default spends most of this test compressing.
	zw.RegisterCompressor(zip.Deflate, func(out io.Writer) (io.WriteCloser, error) {
		return flate.NewWriter(out, flate.BestSpeed)
	})
	for name, body := range sheetsWorkbook {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(body))
	}
	w, _ := zw.Create("xl/media/padding.bin")
	zeros := make([]byte, 8<<20)
	for written := 0; written <= MaxSheetUnzipBytes; written += len(zeros) {
		_, _ = w.Write(zeros)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if buf.Len() > 2<<20 {
		t.Fatalf("the bomb should be small on the wire, is %d bytes", buf.Len())
	}
	_, _, err := LocalXLSXText(buf.Bytes())
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("a workbook inflating past %d MB must be refused as too large, got %v", MaxSheetUnzipBytes>>20, err)
	}
}

// A part that declares a small size and inflates past it is a read error, not
// an allocation: archive/zip stops at the declared size.
func TestXLSX_RefusesAPartThatLiesAboutItsSize(t *testing.T) {
	var body bytes.Buffer
	body.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	body.WriteString(strings.Repeat(`<row><c><v>1</v></c></row>`, 40000))
	body.WriteString(`</sheetData></worksheet>`)

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, part := range sheetsWorkbook {
		if name == "xl/worksheets/sheet1.xml" {
			continue
		}
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(part))
	}
	// Stored raw, with a header claiming 100 bytes.
	raw, err := zw.CreateRaw(&zip.FileHeader{
		Name: "xl/worksheets/sheet1.xml", Method: zip.Store,
		CompressedSize64: uint64(body.Len()), UncompressedSize64: 100,
		CRC32: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = raw.Write(body.Bytes())
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LocalXLSXText(buf.Bytes()); err == nil {
		t.Fatal("a part inflating past its declared size must be refused")
	}
}

// Two sheets, each one cell at the far corner of the grid. Neither is large
// on disk, but reading them yields a million empty rows and sixteen thousand
// blank columns each, which is what the cell budget counts.
func TestXLSX_RefusesACellCountBomb(t *testing.T) {
	corner := `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
		`<row r="1048576"><c r="XFD1048576"><v>1</v></c></row></sheetData></worksheet>`
	parts := withParts(map[string]string{
		"xl/worksheets/sheet1.xml": corner,
		"xl/worksheets/sheet3.xml": corner,
	})
	_, _, err := LocalXLSXText(zipParts(t, parts))
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("a workbook over %d cells must be refused as too large, got %v", MaxSheetCells, err)
	}
}

// The XML stream refuses a sheet with more cells than the budget before the
// slower row pass starts.
func TestXLSX_CellStreamCountsAgainstTheBudget(t *testing.T) {
	var body strings.Builder
	body.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	for r := 0; r < 11; r++ {
		body.WriteString("<row>")
		body.WriteString(strings.Repeat("<c/>", 10))
		body.WriteString("</row>")
	}
	body.WriteString(`</sheetData></worksheet>`)
	parts := withParts(map[string]string{"xl/worksheets/sheet1.xml": body.String()})
	data := zipParts(t, parts)

	// Through the internals with a small budget, so the test stays small.
	_, _, err := readXLSX(data, 100)
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("110 cells against a budget of 100 must be refused, got %v", err)
	}
}

// ─────────────────────────────────────────────────────────────────── CSV/TSV

func TestCSVUpload_IsOneTablePage(t *testing.T) {
	data := []byte("\xef\xbb\xbfOrderID,Note\n1234567890123456789,\"pipe | inside\"\n")
	kind, mime, err := Detect("orders.csv", data)
	if err != nil || kind != KindCSV || mime != "text/csv" {
		t.Fatalf("Detect = %q %q %v", kind, mime, err)
	}
	res, err := ParseLocal(kind, data)
	if err != nil {
		t.Fatal(err)
	}
	want := Marker(1) + "\n| OrderID | Note |\n| --- | --- |\n| 1234567890123456789 | pipe \\| inside |\n"
	if res.Markdown != want || res.Pages != 1 {
		t.Fatalf("got %d pages:\n%q\nwant\n%q", res.Pages, res.Markdown, want)
	}
}

func TestTSVUpload_SplitsOnTabsAndKeepsStrayQuotes(t *testing.T) {
	data := []byte("Word\tGloss\nsay \"hi\"\tgreeting\n")
	kind, mime, err := Detect("words.tsv", data)
	if err != nil || kind != KindTSV || mime != "text/tab-separated-values" {
		t.Fatalf("Detect = %q %q %v", kind, mime, err)
	}
	res, err := ParseLocal(kind, data)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.Markdown, `| say "hi" | greeting |`) {
		t.Fatalf("a TSV splits on tabs and a quote mid-field is text:\n%s", res.Markdown)
	}
}

func TestCSVUpload_RefusesEmptyAndOversized(t *testing.T) {
	if _, _, err := LocalCSVText([]byte("\xef\xbb\xbf"), ','); !errors.Is(err, ErrSheetEmpty) {
		t.Fatalf("an empty CSV must be refused as empty, got %v", err)
	}
	if _, err := CSVToMarkdown([]byte("a,b\nc,d\ne,f\n"), ',', 5); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("six cells against a budget of five must be refused, got %v", err)
	}
}

// A workbook from a real writer library, not hand-built XML: the same rules
// hold for the parts excelize itself produces.
func TestXLSX_ReadsAWorkbookExcelizeWrote(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(f.SetSheetName("Sheet1", "Plan"))
	must(f.SetSheetRow("Plan", "A1", &[]any{"Week", "Starts", "Ref"}))
	must(f.SetSheetRow("Plan", "A2", &[]any{1, time.Date(2024, 2, 29, 0, 0, 0, 0, time.UTC), int64(9007199254740993)}))
	_, err := f.NewSheet("Scratch")
	must(err)
	must(f.SetCellValue("Scratch", "A1", "HIDDEN-SHEET-MARKER"))
	must(f.SetSheetVisible("Scratch", false))
	var buf bytes.Buffer
	must(f.Write(&buf))

	md, pages, err := LocalXLSXText(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if pages != 1 || strings.Contains(md, "HIDDEN-SHEET-MARKER") {
		t.Fatalf("one visible page and no hidden cells, got %d pages:\n%s", pages, md)
	}
	// excelize writes a date with the built-in short-date style (14).
	if !strings.Contains(md, "| 1 | 02-29-24 | 9007199254740993 |") {
		t.Fatalf("a date must read as a date and a long ID raw:\n%s", md)
	}
}

// A sheet is a page, and a workbook over the page cap is refused as a PDF or
// a deck over it is, before any sheet is read.
func TestXLSX_RefusesMoreSheetsThanThePageCap(t *testing.T) {
	var sheets, rels strings.Builder
	for i := 1; i <= DefaultMaxPages+1; i++ {
		fmt.Fprintf(&sheets, `<sheet name="S%d" sheetId="%d" r:id="rId%d"/>`, i, i, i)
		fmt.Fprintf(&rels, `<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`, i)
	}
	parts := withParts(map[string]string{
		"xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
			`xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
			sheets.String() + `</sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
			rels.String() + `</Relationships>`,
	})
	_, _, err := LocalXLSXText(zipParts(t, parts))
	if !errors.Is(err, ErrPageCapExceeded) {
		t.Fatalf("%d sheets must be refused at the page cap, got %v", DefaultMaxPages+1, err)
	}
}
