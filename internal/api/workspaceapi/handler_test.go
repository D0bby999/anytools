package workspaceapi

import "testing"

func TestParseCSV(t *testing.T) {
	data := []byte("\xef\xbb\xbfword,meaning,example\r\n\"chạy\",run,\"Tôi chạy, mỗi sáng.\"\r\n,,\r\n  apple , quả táo ,\r\nbroken \"quote,x\r\n")
	rows, err := ParseCSV(data, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 4 {
		t.Fatalf("blank rows dropped: %d %q", len(rows), rows)
	}
	if rows[0][0] != "word" || rows[1][2] != "Tôi chạy, mỗi sáng." || rows[2][0] != "apple" || rows[2][1] != "quả táo" {
		t.Fatalf("%q", rows)
	}
	if few, _ := ParseCSV(data, 2); len(few) != 2 {
		t.Fatalf("the row cap: %d", len(few))
	}
}
