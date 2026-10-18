package knowledge

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestDocumentTitleIsSafeToStoreAndShow(t *testing.T) {
	cases := map[string]string{
		"../../etc/passwd":                 "passwd",
		`C:\Users\a\notes.pdf`:             "notes.pdf",
		"  ":                               "Untitled",
		"line\nbreak\t.pdf":                "line break .pdf",
		"invoice\u202efdp.exe":             "invoicefdp.exe", // right-to-left override removed
		"zero\u200bwidth\u2066isolate.pdf": "zerowidthisolate.pdf",
		"nul\x00byte.pdf":                  "nulbyte.pdf",
		"Giáo trình Kinh tế vĩ mô.pdf":     "Giáo trình Kinh tế vĩ mô.pdf",
	}
	for in, want := range cases {
		if got := documentTitle(in); got != want {
			t.Errorf("documentTitle(%q) = %q, want %q", in, got, want)
		}
	}

	// 200 characters, never 200 bytes: a long Vietnamese name cut mid-rune is
	// invalid UTF-8, which Postgres refuses.
	long := strings.Repeat("ệ", 300) + ".pdf"
	got := documentTitle(long)
	if !utf8.ValidString(got) || utf8.RuneCountInString(got) != 200 {
		t.Fatalf("long title: valid=%v runes=%d", utf8.ValidString(got), utf8.RuneCountInString(got))
	}
}
