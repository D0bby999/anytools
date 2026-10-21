package mathcheck

import (
	"math"
	"math/rand/v2"
	"regexp"
	"sort"
	"strings"
)

// Verdict is what Judge decided.
type Verdict int

const (
	// Skip: the recorded answer is not maths, or the comparison could not
	// decide; the caller marks it as before (the model).
	Skip Verdict = iota
	// Right: equal by value.
	Right
	// Almost: equal by value, but not in the form the question asks for
	// (simplify, factorise, expand).
	Almost
	// Wrong: a different value.
	Wrong
	// Unreadable: the recorded answer is an expression and the learner's is
	// not readable as one. Never marked wrong.
	Unreadable
	// AlmostUnit: an equal quantity, in another unit than the one the
	// question names (units.go).
	AlmostUnit
	// MissingUnit: the recorded quantity's number, with no unit.
	MissingUnit
)

// Kind is what a recorded answer is.
type Kind int

const (
	// NotMaths: words, or a form the parser does not read.
	NotMaths Kind = iota
	// Number: a value with no variable and no operation ("42", "-1.5").
	Number
	// Expression: an expression or an equation.
	Expression
	// Quantity: a number and a unit (units.go).
	Quantity
	// Structure: an interval, an inequality, a set, a tuple, a vector or a
	// matrix (structures.go).
	Structure
)

// KindOf classifies a recorded answer. A string of letters alone ("DNA") is
// not maths even though it parses as a product: maths has a digit with an
// operation, or an operation or an equals sign.
func KindOf(answer string) Kind {
	if _, err := parseStructure(answer); err == nil {
		return Structure
	}
	if _, ok := parseQuantity(answer, true); ok {
		return Quantity
	}
	p, err := Parse(answer)
	if err != nil {
		return NotMaths
	}
	switch {
	case p.Operators:
		return Expression
	case p.Digits && p.Root.kind == nNum, p.Digits && p.Root.kind == nNeg && p.Root.a.kind == nNum:
		return Number
	case p.Digits:
		// 2x, 3ab: a coefficient and a variable.
		return Expression
	}
	return NotMaths
}

// Judge compares a learner's answer to the recorded one. prompt is the
// question, read only for the form it asks for.
func Judge(prompt, recorded, answer string) Verdict {
	if want, err := parseStructure(recorded); err == nil {
		got, err := parseStructure(answer)
		if err != nil {
			if looksLikeMaths(answer) {
				return Unreadable
			}
			return Skip
		}
		switch eq, decided := sameStructure(want, got); {
		case !decided:
			return Skip
		case eq:
			return Right
		}
		return Wrong
	}
	if want, ok := parseQuantity(recorded, true); ok {
		return judgeQuantity(prompt, want, answer)
	}
	kind := KindOf(recorded)
	if kind == NotMaths {
		return Skip
	}
	// f(x) = 2x + 3 names the function; its value is the answer.
	recorded, answer = functionName.ReplaceAllString(recorded, ""), functionName.ReplaceAllString(answer, "")
	want, err := Parse(recorded)
	if err != nil {
		return Skip
	}
	got, err := Parse(answer)
	if err != nil {
		if kind == Expression && looksLikeMaths(answer) {
			return Unreadable
		}
		// "about 42", "x equals three": words, for the model.
		return Skip
	}
	// A letter the recorded answer has not ("1945 AD", "3 m", "co2" for
	// "CO2") is not a value to compare: the model reads it.
	if extraVariables(want.Root, got.Root) {
		return Skip
	}
	// 3.14 recorded and pi written: the exact value of a rounded answer is
	// right when it rounds to it. A decimal written is compared as written.
	if kind == Number && !plainNumber(got.Root) {
		if d := recordedDecimals(recorded); d > 0 {
			v, w := eval(got.Root, nil), eval(want.Root, nil)
			if finite(v) && math.Abs(v-w) <= 0.5*math.Pow(10, -float64(d))+1e-12 {
				return Right
			}
		}
	}
	eq, decided := equivalent(want.Root, got.Root)
	switch {
	case !decided:
		return Skip
	case !eq:
		return Wrong
	case !inForm(formAsked(prompt), want.Root, got.Root):
		return Almost
	}
	return Right
}

// extraVariables: the answer has a variable the recorded one has not. The
// variable an answer's equation names against a recorded expression (x in
// x = 3 for 3) does not count.
func extraVariables(want, got *Node) bool {
	have := map[string]bool{}
	collect(want, have)
	if got.kind == nEq && got.a.kind == nVar && want.kind != nEq {
		got = got.b
	}
	vars := map[string]bool{}
	collect(got, vars)
	for v := range vars {
		if !have[v] {
			return true
		}
	}
	return false
}

func plainNumber(n *Node) bool {
	if n.kind == nNeg {
		n = n.a
	}
	return n.kind == nNum
}

var (
	trailingDecimals = regexp.MustCompile(`\.(\d+)$`)
	functionName     = regexp.MustCompile(`^\s*\$?\s*[a-zA-Z]\s*\(\s*[a-zA-Z]\s*\)\s*=\s*`)
)

// recordedDecimals: the digits after a recorded number's decimal point.
func recordedDecimals(recorded string) int {
	if m := trailingDecimals.FindStringSubmatch(normalize(recorded)); m != nil {
		return len(m[1])
	}
	return 0
}

// looksLikeMaths: an attempt at an expression, not a sentence. A reply with
// a long word in it goes to the model.
func looksLikeMaths(s string) bool {
	letters := 0
	for _, w := range strings.FieldsFunc(s, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r > 0x7f)
	}) {
		if len([]rune(w)) >= 4 && !functions[strings.ToLower(w)] && !strings.HasPrefix(w, "frac") && !strings.HasPrefix(w, "sqrt") {
			return false
		}
		letters += len(w)
	}
	return strings.ContainsAny(s, "0123456789+-*/^=()\\") || letters <= 3
}

// equivalent compares two trees. An equation equals another whose sides
// differ by a constant factor (2x - y + 1 = 0 is y = 2x + 1); "x = 3" and
// "3" are one answer, as are "3" and "x = 3".
func equivalent(a, b *Node) (eq, decided bool) {
	switch {
	case a.kind == nEq && b.kind == nEq:
		return proportional(&Node{kind: nSub, a: a.a, b: a.b}, &Node{kind: nSub, a: b.a, b: b.b})
	case a.kind == nEq && a.a.kind == nVar:
		return sameValue(a.b, b)
	case b.kind == nEq && b.a.kind == nVar:
		return sameValue(a, b.b)
	case a.kind == nEq || b.kind == nEq:
		return false, true
	}
	return sameValue(a, b)
}

const samples = 24

// points are the sample points for the variables of both trees, the same for
// every comparison so a verdict never changes between two runs. Half are
// positive, where roots and logarithms are defined.
func points(a, b *Node) []map[string]float64 {
	seen := map[string]bool{}
	collect(a, seen)
	collect(b, seen)
	names := make([]string, 0, len(seen))
	for n := range seen {
		names = append(names, n)
	}
	sort.Strings(names)
	rng := rand.New(rand.NewPCG(20261020, 2))
	out := make([]map[string]float64, samples)
	for i := range out {
		p := map[string]float64{}
		for _, n := range names {
			if i < samples/2 {
				p[n] = 0.2 + rng.Float64()*2.8
			} else {
				p[n] = -3 + rng.Float64()*6
			}
		}
		out[i] = p
	}
	return out
}

func collect(n *Node, into map[string]bool) {
	if n == nil {
		return
	}
	if n.kind == nVar && n.name != "pi" && n.name != "e" {
		into[n.name] = true
	}
	collect(n.a, into)
	collect(n.b, into)
}

func near(x, y float64) bool {
	if !finite(x) || !finite(y) {
		return false
	}
	return math.Abs(x-y) <= 1e-9+1e-7*math.Max(math.Abs(x), math.Abs(y))
}

func finite(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }

// sameValue: equal wherever both are defined, at enough points to tell.
func sameValue(a, b *Node) (eq, decided bool) {
	valid := 0
	for _, p := range points(a, b) {
		x, y := eval(a, p), eval(b, p)
		if !finite(x) || !finite(y) {
			continue
		}
		valid++
		if !near(x, y) {
			return false, true
		}
	}
	return true, valid >= 6
}

// proportional: f = k·g for one constant k ≠ 0.
func proportional(f, g *Node) (eq, decided bool) {
	valid := 0
	k := math.NaN()
	for _, p := range points(f, g) {
		x, y := eval(f, p), eval(g, p)
		if !finite(x) || !finite(y) {
			continue
		}
		valid++
		switch {
		case math.Abs(y) < 1e-12 && math.Abs(x) < 1e-12:
			continue
		case math.Abs(y) < 1e-12 || math.Abs(x) < 1e-12:
			return false, true
		case math.IsNaN(k):
			k = x / y
		case !near(x/y, k):
			return false, true
		}
	}
	if math.IsNaN(k) {
		// Both sides are zero everywhere: two identities, or nothing to tell.
		return false, false
	}
	return true, valid >= 6
}

func eval(n *Node, vars map[string]float64) float64 {
	switch n.kind {
	case nNum:
		return n.num
	case nVar:
		switch n.name {
		case "pi":
			return math.Pi
		case "e":
			return math.E
		}
		return vars[n.name]
	case nNeg:
		return -eval(n.a, vars)
	case nAdd:
		return eval(n.a, vars) + eval(n.b, vars)
	case nSub:
		return eval(n.a, vars) - eval(n.b, vars)
	case nMul:
		return eval(n.a, vars) * eval(n.b, vars)
	case nDiv:
		return eval(n.a, vars) / eval(n.b, vars)
	case nPow:
		return math.Pow(eval(n.a, vars), eval(n.b, vars))
	case nFunc:
		x := eval(n.a, vars)
		switch n.name {
		case "sin":
			return math.Sin(x)
		case "cos":
			return math.Cos(x)
		case "tan":
			return math.Tan(x)
		case "cot":
			return 1 / math.Tan(x)
		case "sec":
			return 1 / math.Cos(x)
		case "csc":
			return 1 / math.Sin(x)
		case "arcsin", "asin":
			return math.Asin(x)
		case "arccos", "acos":
			return math.Acos(x)
		case "arctan", "atan":
			return math.Atan(x)
		case "sinh":
			return math.Sinh(x)
		case "cosh":
			return math.Cosh(x)
		case "tanh":
			return math.Tanh(x)
		case "ln":
			return math.Log(x)
		case "log":
			// log is base 10, as in school; ln is natural.
			return math.Log10(x)
		case "exp":
			return math.Exp(x)
		case "sqrt":
			return math.Sqrt(x)
		case "abs":
			return math.Abs(x)
		}
	}
	return math.NaN()
}

type form int

const (
	anyForm form = iota
	simplified
	factorised
	expanded
)

// formAsked reads the form a question asks for, in the four interface
// languages.
func formAsked(prompt string) form {
	p := strings.ToLower(prompt)
	has := func(words ...string) bool {
		for _, w := range words {
			if strings.Contains(p, w) {
				return true
			}
		}
		return false
	}
	switch {
	case has("factor", "phân tích", "nhân tử", "factoriz", "fatora"):
		return factorised
	case has("expand", "khai triển", "desarroll", "expande", "expanda"):
		return expanded
	case has("simplif", "simplest form", "lowest terms", "rút gọn", "tối giản", "đơn giản"):
		return simplified
	}
	return anyForm
}

// inForm: the learner's equal answer is in the form asked. Factorised is a
// product or a power at the top; expanded has no product or power of a sum;
// simplified is no longer than the recorded answer by more than two parts
// and has no whole number over a whole number left to divide.
func inForm(f form, want, got *Node) bool {
	switch f {
	case factorised:
		return isProduct(got) || !isProduct(want)
	case expanded:
		return !hasProductOfSum(got)
	case simplified:
		return size(got) <= size(want)+2 && !hasNumberFraction(got)
	}
	return true
}

func isProduct(n *Node) bool {
	for n.kind == nNeg {
		n = n.a
	}
	if n.kind == nEq {
		return isProduct(n.b)
	}
	return n.kind == nMul || n.kind == nPow
}

func isSum(n *Node) bool {
	for n.kind == nNeg {
		n = n.a
	}
	return n.kind == nAdd || n.kind == nSub
}

func hasProductOfSum(n *Node) bool {
	if n == nil {
		return false
	}
	switch n.kind {
	case nMul:
		if isSum(n.a) || isSum(n.b) {
			return true
		}
	case nPow:
		if isSum(n.a) {
			return true
		}
	}
	return hasProductOfSum(n.a) || hasProductOfSum(n.b)
}

// hasNumberFraction: a whole number over a whole number that still divides
// (4/2, 6/8), which a simplified answer would not leave.
func hasNumberFraction(n *Node) bool {
	if n == nil {
		return false
	}
	if n.kind == nDiv && n.a.kind == nNum && n.b.kind == nNum && whole(n.a.num) && whole(n.b.num) {
		if gcd(int64(math.Abs(n.a.num)), int64(math.Abs(n.b.num))) > 1 || math.Abs(n.b.num) == 1 {
			return true
		}
	}
	return hasNumberFraction(n.a) || hasNumberFraction(n.b)
}

func whole(x float64) bool { return x == math.Trunc(x) && math.Abs(x) < 1e15 }

func gcd(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func size(n *Node) int {
	if n == nil {
		return 0
	}
	return 1 + size(n.a) + size(n.b)
}
