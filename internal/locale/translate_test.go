package locale

import (
	"encoding/json"
	"testing"
)

func raw(t *testing.T, lang string) map[string]string {
	t.Helper()
	b, err := files.ReadFile("catalog/" + lang + ".json")
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestTranslate(t *testing.T) {
	saved := catalogs["vi"]
	t.Cleanup(func() { catalogs["vi"] = saved })
	catalogs["vi"] = compile(map[string]string{
		"not found":                         "không tìm thấy",
		"the file must be %d MB or smaller": "tệp phải từ %d MB trở xuống",
		"%s is due":                         "%s đến hạn",
		"this review is due on %s":          "bài xem lại này đến hạn vào %s",
		"%d of %d left":                     "còn %[2]d, đã dùng %[1]d",
		"the model failed: %s":              "mô hình gặp lỗi: %s",
		"Key rejected.":                     "Khóa bị từ chối.",
		"100%% sure":                        "chắc chắn 100%",
	})
	cases := []struct{ lang, in, want string }{
		{"vi", "not found", "không tìm thấy"},
		{"vi", "the file must be 25 MB or smaller", "tệp phải từ 25 MB trở xuống"},
		{"vi", "this review is due on 2026-10-20", "bài xem lại này đến hạn vào 2026-10-20"},
		{"vi", "the quiz is due", "the quiz đến hạn"},
		{"vi", "3 of 5 left", "còn 5, đã dùng 3"},
		{"vi", "the model failed: Key rejected.", "mô hình gặp lỗi: Khóa bị từ chối."},
		{"vi", "parse: not found", "parse: không tìm thấy"},
		{"vi", "100% sure", "chắc chắn 100%"},
		{"vi", "something nobody wrote down", "something nobody wrote down"},
		{"vi", "drive_full", "drive_full"},
		{"en", "not found", "not found"},
		{"fr", "not found", "not found"},
		{"", "not found", "not found"},
	}
	for _, c := range cases {
		if got := Translate(c.lang, c.in); got != c.want {
			t.Errorf("Translate(%q, %q) = %q, want %q", c.lang, c.in, got, c.want)
		}
	}
}
