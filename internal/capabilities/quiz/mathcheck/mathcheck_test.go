package mathcheck

import (
	"testing"
)

func TestJudgeComparesByValue(t *testing.T) {
	cases := []struct {
		prompt, recorded, answer string
		want                     Verdict
	}{
		// One answer, many forms.
		{"", "2(x+1)", "2x+2", Right},
		{"", "2(x+1)", "2 * x + 2", Right},
		{"", "2(x+1)", `\frac{4x+4}{2}`, Right},
		{"", "2(x+1)", "x + x + 2", Right},
		{"", "$2(x+1)$", "2x + 2", Right},
		{"", "(a+b)^2", "a^2 + 2ab + b^2", Right},
		{"", "(a+b)^2", "a² + 2ab + b²", Right},
		{"", "x^2 - 1", "(x-1)(x+1)", Right},
		{"", `\sqrt{3}/2`, "sqrt(3)/2", Right},
		{"", `\frac{\sqrt{3}}{2}`, "√3/2", Right},
		{"", "1/2", "0.5", Right},
		{"", "1/2", "0,5", Right},
		{"", "1.5", "1,5", Right},
		{"", "50%", "0.5", Right},
		{"", "2 pi r", "2πr", Right},
		{"", `2\pi r`, "2*pi*r", Right},
		{"", "x^{-1}", "1/x", Right},
		{"", `\sqrt[3]{8}`, "2", Right},
		{"", "|x|", "abs(x)", Right},
		{"", `\sin^2 x + \cos^2 x`, "1", Right},
		{"", `\log_2 8`, "3", Right},
		{"", "ln(e^2)", "2 ln(e)", Right},
		{"", "x_1 + x_2", "x_2 + x_1", Right},
		{"", "3 × 4", "12", Right},
		{"", "a/b", "a÷b", Right},
		{"", "1,000", "1000", Right},
		{"", "0.005", "0,005", Right},
		// Different values.
		{"", "2(x+1)", "2x+1", Wrong},
		{"", "x^2", "2x", Wrong},
		{"", "(a+b)^2", "a^2 + b^2", Wrong},
		{"", "sqrt(x^2)", "x", Wrong},
		{"", "1/2", "0.49", Wrong},
		{"", "42", "41", Wrong},
		// Equations: the same line, any arrangement; x = 3 is 3.
		{"", "y = 2x + 1", "2x - y + 1 = 0", Right},
		{"", "y = 2x + 1", "y - 1 = 2x", Right},
		{"", "y = 2x + 1", "y = 2x - 1", Wrong},
		{"", "x = 3", "3", Right},
		{"", "x = 3", "x = 3.0", Right},
		{"", "3", "x = 3", Right},
		{"", "y = 2x + 1", "2x + 1", Right},
		{"", "y = 2x + 1", "2x", Wrong},
		{"", "x + y", "x + y = 1", Wrong},
		// The form asked for.
		{"Factorise x^2 - 1.", "(x-1)(x+1)", "x^2 - 1", Almost},
		{"Factorise x^2 - 1.", "(x-1)(x+1)", "(x+1)(x-1)", Right},
		{"Phân tích thành nhân tử: x^2 - 1", "(x-1)(x+1)", "x^2-1", Almost},
		{"Expand (a+b)^2.", "a^2 + 2ab + b^2", "(a+b)^2", Almost},
		{"Expand (a+b)^2.", "a^2 + 2ab + b^2", "a^2 + b^2 + 2ab", Right},
		{"Simplify 2x + 3x.", "5x", "2x + 3x", Almost},
		{"Rút gọn 6/8.", "3/4", "6/8", Almost},
		{"Rút gọn 6/8.", "3/4", "3/4", Right},
		{"Simplify 4/2.", "2", "4/2", Almost},
		// Unreadable is never wrong.
		{"", "2(x+1)", "2(x+1", Unreadable},
		{"", "2(x+1)", "2x++", Unreadable},
		{"", "2(x+1)", `\foo{x}`, Unreadable},
		// Words go to the model.
		{"", "2(x+1)", "two times x plus one", Skip},
		{"", "42", "about 42", Skip},
		{"", "42", "forty-two", Skip},
		{"", "photosynthesis", "photosynthesis", Skip},
		{"", "DNA", "DNA", Skip},
		{"", "on/off", "on/off", Skip},
		{"", "x = 2 or x = -3", "x = 2 or x = -3", Skip},
		{"", "Paris", "Paris", Skip},
		{"", "1945", "in 1945", Skip},
	}
	for _, c := range cases {
		if got := Judge(c.prompt, c.recorded, c.answer); got != c.want {
			t.Errorf("Judge(%q, %q, %q) = %v, want %v", c.prompt, c.recorded, c.answer, got, c.want)
		}
	}
}

func TestKindOf(t *testing.T) {
	for in, want := range map[string]Kind{
		"2x":               Expression,
		"x^2":              Expression,
		"y = 2x + 1":       Expression,
		"a+b":              Expression,
		`\frac{1}{2}`:      Expression,
		"3/4":              Expression,
		"42":               Number,
		"-1.5":             Number,
		"1945":             Number,
		"x":                NotMaths,
		"xy":               NotMaths,
		"DNA":              NotMaths,
		"the mitochondria": NotMaths,
		"":                 NotMaths,
	} {
		if got := KindOf(in); got != want {
			t.Errorf("KindOf(%q) = %v, want %v", in, got, want)
		}
	}
}

// The parser never panics, whatever it is given.
func FuzzParse(f *testing.F) {
	for _, s := range []string{"2(x+1)", `\frac{a}{b}`, "|x|", "x^-1", `\sqrt[3]{8}`, "sin^2 x", "log_{2} 8", "((", "|", `\log_`} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		p, err := Parse(s)
		if err == nil {
			_ = eval(p.Root, map[string]float64{})
			_ = Judge("simplify", s, s)
		}
	})
}
