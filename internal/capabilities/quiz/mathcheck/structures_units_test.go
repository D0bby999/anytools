package mathcheck

import "testing"

// structures_units_test.go: intervals, inequalities, sets, tuples, vectors,
// matrices and quantities, marked by value (structures.go, units.go).

func TestJudgeBracketsAndUnits(t *testing.T) {
	cases := []struct {
		prompt, recorded, answer string
		want                     Verdict
	}{
		// Intervals: the brackets count, except at an infinite end.
		{"", "[2, 5)", "[2, 5)", Right},
		{"", "(2, 5]", "(2,5]", Right},
		{"", "(2, 5]", "(2, 5)", Wrong},
		{"", "(2, 5]", "[2, 5]", Wrong},
		{"", "(2, 5]", "(2, 6]", Wrong},
		{"", "(2, 5]", "]2; 5]", Right},
		{"", "[2, 5)", "[2;5[", Right},
		{"", "(1,5; 3]", "(1.5, 3]", Right},
		{"", "[0, oo)", `[0, \infty)`, Right},
		{"", "[0, oo)", "[0, ∞]", Right},
		{"", "(-oo, 1) ∪ (2, oo)", `(2,+\infty)\cup(-\infty,1)`, Right},
		{"", "(-oo, 1) ∪ (2, oo)", "(-oo,1) U (2,oo)", Right},
		{"", "(-oo, 1) ∪ (2, oo)", "(-oo, 1)", Wrong},
		{"", "(1/2, sqrt(2))", "(0.5, √2)", Right},
		{"", "ℝ", "(-oo, oo)", Right},
		{"", `\mathbb{R}`, "RR", Right},
		// Inequalities in one variable are intervals.
		{"", "x > 2", "x > 2", Right},
		{"", "x > 2", "(2, oo)", Right},
		{"", "x >= 2", "x > 2", Wrong},
		{"", "2 < x <= 5", "(2, 5]", Right},
		{"", "(2, 5]", `2<x\le5`, Right},
		{"", "5 >= x > 2", "2 < x ≤ 5", Right},
		{"", "x in [1, 3)", `x\in\lbrack1,3)`, Right},
		{"", "S = (2, 5]", "(2;5]", Right},
		// Sets: any order, repeats aside.
		{"", "{1, 2, 3}", "{3, 2, 1}", Right},
		{"", "{1, 2, 3}", "{1, 2}", Wrong},
		{"", "{-2, 3}", `\{3; -2\}`, Right},
		{"", "∅", `\emptyset`, Right},
		{"", "∅", "O/", Right},
		{"", "{1, 2}", "(1, 2)", Wrong},
		// Tuples, vectors, matrices: in order, ( and [ alike.
		{"", "(1, 2, 3)", "[1, 2, 3]", Right},
		{"", "(1, 2, 3)", "(3, 2, 1)", Wrong},
		{"", "[[1, 2], [3, 4]]", "((1,2),(3,4))", Right},
		{"", "[[1, 2], [3, 4]]", `\begin{pmatrix}1&2\\3&4\end{pmatrix}`, Right},
		{"", "[[1, 2], [3, 4]]", "[[1, 2], [4, 3]]", Wrong},
		{"", "[[1, 2], [3, 4]]", "[1, 2, 3, 4]", Wrong},
		{"", "[[2x, 1], [0, x^2]]", "[[x+x, 1], [0, x*x]]", Right},
		{"", "((1.5, 2))", `\begin{bmatrix}1,5&2\end{bmatrix}`, Right},
		// Not brackets: an answer the learner did not write as one is asked again.
		{"", "(2, 5]", "between two and five", Skip},
		{"", "(2, 5]", "2.5", Unreadable},
		{"", "(1, 2)", "1,2", Unreadable},

		// Quantities, compared in SI units.
		{"", "5 cm", "5 cm", Right},
		{"", "5 m", "500 cm", Right},
		{"", "5 m", "5m", Right},
		{"", "5 m", "0,005 km", Right},
		{"", "60 km/h", "60 k m/h", Right},
		{"", "60 km/h", "16.67 m/s", Right},
		{"", "60 km/h", "16.6 m/s", Wrong},
		{"", "60 km/h", "60 km h^-1", Right},
		{"", "9.8 m/s^2", "9.8 (m)/(s^2)", Right},
		{"", "12 cm^2", `12\text{ cm}^2`, Right},
		{"", "12 cm^2", "12 cm²", Right},
		{"", "12 cm^2", "0.0012 m^2", Right},
		{"", "12 cm^2", "12 cm", Wrong},
		{"", "3 × 10^8 m/s", "300000 km/s", Right},
		{"", "3 × 10^8 m/s", "3e8 m/s", Right},
		{"", "2 kWh", "7.2 MJ", Right},
		{"", "1 L", "1000 mL", Right},
		{"", "1 L", "1 dm^3", Right},
		{"", "3 µm", "3 mu m", Right},
		{"", "2 Ω", "2 Omega", Right},
		{"", "1,000 km", "1000 km", Right},
		{"", "v = 20 m/s", "20 m/s", Right},
		{"", "30°", "30^@", Right},
		{"", "30°", "pi/6", Right},
		{"", "5 kg", "5 m", Wrong},
		{"", "5 kg", "6 kg", Wrong},
		// The right number, no unit; another unit when the question names one.
		{"", "5 m", "5", MissingUnit},
		{"", "5 m", "6", Wrong},
		{"Convert 5 m to cm.", "500 cm", "5 m", AlmostUnit},
		{"Đổi 5 m ra cm.", "500 cm", "500cm", Right},
		{"How fast, in km/h?", "60 km/h", "16.67 m/s", AlmostUnit},
		// Words, or a unit not in the table: the model.
		{"", "5 m", "five metres", Skip},
		{"", "5 m", "5 furlongs", Skip},
		{"", "25 °C", "25 °C", Skip},
		// Still products: a lone letter against a number.
		{"", "5m", "5 * m", Right},
	}
	for _, c := range cases {
		if got := Judge(c.prompt, c.recorded, c.answer); got != c.want {
			t.Errorf("Judge(%q, %q, %q) = %v, want %v", c.prompt, c.recorded, c.answer, got, c.want)
		}
	}
}

func TestKindOfBracketsAndUnits(t *testing.T) {
	for in, want := range map[string]Kind{
		"(2, 5]":           Structure,
		"x > 2":            Structure,
		"{1, 2}":           Structure,
		"[[1, 2], [3, 4]]": Structure,
		"(1, 2)":           Structure,
		"5 m":              Quantity,
		"60 km/h":          Quantity,
		"5m":               Expression,
		"(x+1)(x-1)":       Expression,
		"(a+b)^2":          Expression,
		"{5}":              Number,
		"1,5":              Number,
		"25 °C":            NotMaths,
	} {
		if got := KindOf(in); got != want {
			t.Errorf("KindOf(%q) = %v, want %v", in, got, want)
		}
	}
}

// Neither reader panics, whatever it is given.
func FuzzBracketsAndUnits(f *testing.F) {
	for _, s := range []string{"(2,5]", "]2;5[", "[[1,2],[3,4]]", "x>=3", "2<x<5", "{}", "60 km/h", "3 × 10^8 m/s^(-2)", "(((", "5 /", "^", "∪"} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		_ = KindOf(s)
		_ = Judge("convert to cm", s, s)
		_ = Judge("", "(2, 5]", s)
		_ = Judge("", "60 km/h", s)
	})
}

// The independent review's cases (the private design notes
// beyond-english-independent.md), each as it was reported.
func TestReviewCases(t *testing.T) {
	cases := []struct {
		prompt, recorded, answer string
		want                     Verdict
	}{
		// H2: no infinite quantity: never right; the model reads it.
		{"", "5 m", "1e999 m", Skip},
		{"", "5 m", "1e-999 m", Skip},
		// H3: rounded to the coarser of the two answers.
		{"", "300 m", "0 km", Wrong},
		{"", "80 min", "1 h", Wrong},
		{"", "60 km/h", "2e1 m/s", Wrong},
		{"", "60 km/h", "16.7 m/s", Right},
		{"", "300 m", "0.3 km", Right},
		// H4: a letter the recorded answer has not goes to the model.
		{"", "3", "3 m", Skip},
		{"", "1945", "1945 AD", Skip},
		{"", "CO2", "co2", Skip},
		{"", "3", "x = 3", Right},
		{"", "y = 2x + 1", "2x - y + 1 = 0", Right},
		// M1: f(x) = names the function.
		{"", "f(x) = 2x + 3", "2x + 3", Right},
		{"", "2x + 3", "f(x) = 3 + 2x", Right},
		// M2: sin 2x is sin(2x).
		{"", `\sin(2x)`, "sin 2x", Right},
		{"", `2\sin x\cos x`, "sin 2x", Right},
		// M3: e is Euler's number.
		{"", "e^x", "exp(x)", Right},
		// M4: [1, 2] against (1, 2) is not decided here.
		{"", "[1, 2]", "(1, 2)", Skip},
		{"", "(2, 5]", "(2, 5)", Wrong},
		// M5: a decimal comma read as a separator is not marked wrong.
		{"", "(1.5, 3]", "(1,5, 3]", Skip},
		// M6: a space between unit symbols is a product.
		{"", "5 m/s", "5 m s^-1", Right},
		// M7: the exact value of a rounded answer.
		{"", "3.14", "pi", Right},
		{"", "0.33", "1/3", Right},
		{"", "0.33", "0.3333", Wrong},
		{"", "3", "3.4", Wrong},
		// MathLive's ASCII: division, roots, subscripts, mixed numbers, a spaced infinity.
		{"", "3", "6 -: 2", Right},
		{"", "2", "root(3)(8)", Right},
		{"", "x_{12} + 1", "x_(12)+1", Right},
		{"", "1.5", `1\frac{1}{2}`, Right},
		{"", "1.5", "1(1)/(2)", Right},
		{"", "x^2/2", "x^2(1)/(2)", Right},
		{"", "(-oo, 3)", `(- \infty, 3)`, Right},
	}
	for _, c := range cases {
		if got := Judge(c.prompt, c.recorded, c.answer); got != c.want {
			t.Errorf("Judge(%q, %q, %q) = %v, want %v", c.prompt, c.recorded, c.answer, got, c.want)
		}
	}
}
