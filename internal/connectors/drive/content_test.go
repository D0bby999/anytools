package drive

import (
	"errors"
	"strings"
	"testing"
)

// A spreadsheet handed to the chunker as raw CSV becomes one wall of text in
// which no column header is attached to the values under it. As a Markdown
// table the header travels with every row, which is what makes a retrieved
// passage answerable.
func TestCSVToMarkdown_KeepsTheHeaderWithEveryRow(t *testing.T) {
	md, err := csvToMarkdown([]byte("Week,Topic,Reading\n1,Retrieval,Chapter 2\n2,Ranking,Chapter 3\n"))
	if err != nil {
		t.Fatalf("csvToMarkdown: %v", err)
	}
	got := string(md)
	for _, want := range []string{
		"| Week | Topic | Reading |",
		"| --- | --- | --- |",
		"| 1 | Retrieval | Chapter 2 |",
		"| 2 | Ranking | Chapter 3 |",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
}

// A pipe inside a cell would end the column early and a newline would end the
// row, so one cell would silently reshape every row after it.
func TestCSVToMarkdown_EscapesCellsThatWouldBreakTheTable(t *testing.T) {
	md, err := csvToMarkdown([]byte("Name,Note\nA,\"pipe | inside\"\nB,\"two\nlines\"\n"))
	if err != nil {
		t.Fatalf("csvToMarkdown: %v", err)
	}
	got := string(md)
	if !strings.Contains(got, `pipe \| inside`) {
		t.Errorf("a pipe in a cell must be escaped:\n%s", got)
	}
	if strings.Count(got, "\n") != 4 {
		t.Errorf("a newline inside a cell must not create a row, got %d lines:\n%s",
			strings.Count(got, "\n"), got)
	}
}

// Spreadsheet exports are genuinely ragged — trailing empty columns are
// trimmed — so a short row must widen to the table rather than fail the import.
func TestCSVToMarkdown_HandlesRaggedRows(t *testing.T) {
	md, err := csvToMarkdown([]byte("A,B,C\n1\n2,3\n"))
	if err != nil {
		t.Fatalf("a ragged export must still import: %v", err)
	}
	for _, want := range []string{"| 1 |  |  |", "| 2 | 3 |  |"} {
		if !strings.Contains(string(md), want) {
			t.Errorf("missing %q in:\n%s", want, md)
		}
	}
}

func TestCSVToMarkdown_RefusesAnEmptySheet(t *testing.T) {
	if _, err := csvToMarkdown(nil); err == nil {
		t.Fatal("an empty spreadsheet must be refused, not imported as an empty document")
	}
}

// A Google-native type with no export lane cannot be downloaded at all
// (files.get answers fileNotDownloadable), so it is refused with a sentence
// naming the type rather than with a Drive API detail.
func TestFetchContent_RefusesGoogleTypesWithNoLane(t *testing.T) {
	rec := newRecorder(t)
	defer rec.done() // no HTTP call may be made

	_, _, err := fetchContent(t.Context(), testClient(rec),
		File{ID: "1Slides", Name: "Deck", MimeType: "application/vnd.google-apps.presentation"}, 1<<20)
	if !errors.Is(err, ErrUnsupportedDriveType) {
		t.Fatalf("error = %v, want ErrUnsupportedDriveType", err)
	}
	if !strings.Contains(err.Error(), "Google Slides") {
		t.Errorf("the message must name the type the user would recognise, got %q", err)
	}
	// And the message the UI shows is the sentence, not the package prefix.
	if msg := userFacingImportError(err); strings.HasPrefix(msg, "drive:") {
		t.Errorf("user-facing message still carries the package prefix: %q", msg)
	}
}

func TestWithExtension(t *testing.T) {
	cases := map[string]string{
		"Week One Notes": "Week One Notes.md",
		"Notes.md":       "Notes.md",
		// Case-insensitive, or "Notes.MD" becomes "Notes.MD.md" and the KB list
		// shows the doubled name.
		"Notes.MD": "Notes.MD",
		"":         "Untitled.md",
		// A Drive name is free text and becomes a filename; a separator in it
		// must not turn into one.
		"a/b\\c": "a-b-c.md",
	}
	for in, want := range cases {
		if got := withExtension(in, ".md"); got != want {
			t.Errorf("withExtension(%q) = %q, want %q", in, got, want)
		}
	}
}

// fileChanged decides whether the user's parse and embed quota gets spent.
func TestFileChanged(t *testing.T) {
	cases := []struct {
		name  string
		grant Grant
		file  File
		want  bool
	}{
		{"binary with the same checksum is unchanged",
			Grant{MD5: "abc", ModifiedTime: "t1"}, File{MD5Checksum: "abc", ModifiedTime: "t2"}, false},
		{"binary with a new checksum changed",
			Grant{MD5: "abc"}, File{MD5Checksum: "def"}, true},
		// A Doc has no md5 at all. Comparing md5 alone would see "" == "" and a
		// Doc would never re-import, however often it was edited.
		{"a Doc falls back to modifiedTime",
			Grant{ModifiedTime: "t1"}, File{ModifiedTime: "t2"}, true},
		{"an unedited Doc is unchanged",
			Grant{ModifiedTime: "t1"}, File{ModifiedTime: "t1"}, false},
		// A grant with neither recorded never imported successfully, so the
		// next sync must retry it rather than leave the document missing.
		{"a grant that never imported is treated as changed",
			Grant{}, File{}, true},
	}
	for _, c := range cases {
		if got := fileChanged(c.grant, c.file); got != c.want {
			t.Errorf("%s: fileChanged = %t, want %t", c.name, got, c.want)
		}
	}
}
