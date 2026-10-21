package mathcheck

import (
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Quantities: a number and a unit (an extension of the private design notes, phase 2). They are compared in SI units, so
// 5 m is 500 cm and 60 km/h is 16.67 m/s. An equal value in another unit is
// right, unless the question names the recorded unit ("convert 5 m to cm"):
// then it is almost (AlmostUnit). The right number with no unit is almost
// too (MissingUnit). A unit this table does not know goes to the model.
//
// A recorded answer is read as a quantity when its unit is not a lone letter
// written against the number: "5m" stays the product 5·m, "5 m" and "5cm"
// are lengths. Units are written by their symbols; a run of them is read
// longest first, so "ms" is a millisecond and "kWh" a kilowatt-hour.

// dims are the exponents of length, mass, time, current and angle.
type dims [5]int

type unit struct {
	factor float64 // to SI
	d      dims
}

func (u unit) times(v unit, power int) unit {
	out := unit{factor: u.factor * math.Pow(v.factor, float64(power)), d: u.d}
	for i := range out.d {
		out.d[i] += v.d[i] * power
	}
	return out
}

var (
	units   = map[string]unit{}
	symbols []string // longest first
)

func init() {
	length, mass, time, current, angle := dims{1}, dims{0, 1}, dims{0, 0, 1}, dims{0, 0, 0, 1}, dims{0, 0, 0, 0, 1}
	compose := func(parts ...int) dims { // pairs of (base index, power)
		var d dims
		for i := 0; i < len(parts); i += 2 {
			d[parts[i]] += parts[i+1]
		}
		return d
	}
	prefixes := map[string]float64{
		"G": 1e9, "M": 1e6, "k": 1e3, "h": 1e2, "d": 1e-1, "c": 1e-2, "m": 1e-3, "µ": 1e-6, "u": 1e-6, "n": 1e-9,
	}
	add := func(symbol string, factor float64, d dims, with string) {
		units[symbol] = unit{factor, d}
		for _, p := range strings.Split(with, " ") {
			if p != "" {
				units[p+symbol] = unit{factor * prefixes[p], d}
			}
		}
	}
	add("m", 1, length, "k c m d µ u n")
	add("g", 1e-3, mass, "k m µ u")
	add("t", 1e3, mass, "")
	add("s", 1, time, "m µ u n")
	add("min", 60, time, "")
	add("h", 3600, time, "")
	add("L", 1e-3, compose(0, 3), "m c d")
	add("l", 1e-3, compose(0, 3), "m c d")
	add("ha", 1e4, compose(0, 2), "")
	add("N", 1, compose(1, 1, 0, 1, 2, -2), "k M")
	add("J", 1, compose(1, 1, 0, 2, 2, -2), "k M")
	add("cal", 4.184, compose(1, 1, 0, 2, 2, -2), "k")
	add("W", 1, compose(1, 1, 0, 2, 2, -3), "k M G")
	add("Pa", 1, compose(1, 1, 0, -1, 2, -2), "h k M")
	add("bar", 1e5, compose(1, 1, 0, -1, 2, -2), "m")
	add("atm", 101325, compose(1, 1, 0, -1, 2, -2), "")
	add("mmHg", 133.322387415, compose(1, 1, 0, -1, 2, -2), "")
	add("Hz", 1, compose(2, -1), "k M G")
	add("A", 1, current, "m k")
	add("V", 1, compose(1, 1, 0, 2, 2, -3, 3, -1), "k m")
	add("Ω", 1, compose(1, 1, 0, 2, 2, -3, 3, -2), "k M")
	add("ohm", 1, compose(1, 1, 0, 2, 2, -3, 3, -2), "k M")
	add("rad", 1, angle, "")
	add("°", math.Pi/180, angle, "")
	add("deg", math.Pi/180, angle, "")
	add("in", 0.0254, length, "")
	add("ft", 0.3048, length, "")
	add("yd", 0.9144, length, "")
	add("mi", 1609.344, length, "")
	add("lb", 0.45359237, mass, "")
	add("oz", 0.028349523125, mass, "")
	for s := range units {
		symbols = append(symbols, s)
	}
	sort.Slice(symbols, func(i, j int) bool {
		if len(symbols[i]) != len(symbols[j]) {
			return len(symbols[i]) > len(symbols[j])
		}
		return symbols[i] < symbols[j]
	})
}

type quantity struct {
	value float64 // in the written unit
	unit  unit
	text  string // the unit as written, spaces removed
	// tolerance is half the last digit written, in SI: an answer converted
	// to another unit and rounded is still equal.
	tolerance float64
}

var (
	quantityNumber = regexp.MustCompile(`^([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))(?:\s*(?:\*|x|×|·|⋅)\s*10\s*\^\s*\{?\(?\s*([+-]?\d+)\s*\)?\}?|[eE]([+-]?\d+))?`)
	quantityName   = regexp.MustCompile(`^[A-Za-z](?:_\{?\w+\}?)?\s*=\s*`)
	thousandsLead  = regexp.MustCompile(`^[1-9]\d{0,2}(?:,\d{3})+(?:\s|$)`)
	latexUnit      = regexp.MustCompile(`\\(?:mathrm|text|operatorname|mathit|textrm)\s*`)
	latexFrac      = regexp.MustCompile(`\\frac\(([^()]*)\)\(([^()]*)\)`)
)

// parseQuantity reads "60 km/h", "3 × 10^8 m/s" or "v = 9.8 m/s^2". strict
// is for a recorded answer, where "5m" is the product 5·m.
func parseQuantity(raw string, strict bool) (*quantity, bool) {
	s := strings.TrimSuffix(stripDelimiters(raw), ".")
	s = latexSpaces.ReplaceAllString(s, " ")
	s = strings.NewReplacer(`\times`, "×", `\cdot`, "·", "−", "-").Replace(s)
	s = strings.TrimSpace(quantityName.ReplaceAllString(s, ""))
	// 1,000 km is a thousand, as a lone 1,000 is (normalize).
	if lead := thousandsLead.FindString(s); lead != "" {
		s = strings.ReplaceAll(lead, ",", "") + s[len(lead):]
	}
	m := quantityNumber.FindStringSubmatch(s)
	if m == nil {
		return nil, false
	}
	mantissa := strings.Replace(m[1], ",", ".", 1)
	value, err := strconv.ParseFloat(mantissa, 64)
	if err != nil {
		return nil, false
	}
	exp := 0
	if e := m[2] + m[3]; e != "" {
		exp, _ = strconv.Atoi(e)
	}
	value *= math.Pow(10, float64(exp))
	if !finite(value) || exp > 300 || exp < -300 {
		return nil, false // 1e999 m: no quantity
	}
	decimals := 0
	if i := strings.IndexByte(mantissa, '.'); i >= 0 {
		decimals = len(mantissa) - i - 1
	}
	rest := s[len(m[0]):]
	spaced := strings.HasPrefix(rest, " ")
	u, text, ok := parseUnit(rest)
	if !ok {
		return nil, false
	}
	if strict && !spaced && len([]rune(text)) == 1 && text[0] < 0x80 && (text[0]|0x20) >= 'a' && (text[0]|0x20) <= 'z' {
		return nil, false // 5m: the product 5·m
	}
	return &quantity{
		value: value, unit: u, text: text,
		tolerance: 0.5 * math.Pow(10, float64(exp-decimals)) * u.factor,
	}, true
}

// parseUnit reads a unit: symbols with powers, multiplied (·, *, side by
// side) or divided (/, the next symbol or bracket).
func parseUnit(raw string) (unit, string, bool) {
	// "5 m s^-1": a space between symbols is a product; MathLive's "k m/h"
	// splits one symbol, so without the spaces is tried next.
	spaced := strings.Join(strings.Fields(strings.ReplaceAll(raw, `\,`, " ")), "*")
	if u, text, ok := readUnit(spaced); ok {
		return u, text, true
	}
	return readUnit(raw)
}

func readUnit(raw string) (unit, string, bool) {
	s := latexUnit.ReplaceAllString(raw, "")
	s = strings.NewReplacer(
		"{", "(", "}", ")", `"`, "", " ", "", `\,`, "", `\mu`, "µ", "μ", "µ", "mu", "µ", `\Omega`, "Ω", "Omega", "Ω",
		"^@", "°", `^\circ`, "°", `^(\circ)`, "°", `\degree`, "°", "²", "^2", "³", "^3",
		"·", "*", "⋅", "*", "×", "*", `\cdot`, "*",
	).Replace(s)
	s = latexFrac.ReplaceAllString(s, "($1)/($2)")
	if s == "" {
		return unit{}, "", false
	}
	p := &unitParser{s: s}
	u, ok := p.expr()
	if !ok || p.i != len(p.s) {
		return unit{}, "", false
	}
	return u, s, true
}

type unitParser struct {
	s string
	i int
}

func (p *unitParser) expr() (unit, bool) {
	u, ok := p.factor()
	if !ok {
		return unit{}, false
	}
	for p.i < len(p.s) && p.s[p.i] != ')' {
		power := 1
		switch p.s[p.i] {
		case '*':
			p.i++
		case '/':
			p.i++
			power = -1
		}
		v, ok := p.factor()
		if !ok {
			return unit{}, false
		}
		u = u.times(v, power)
	}
	return u, true
}

func (p *unitParser) factor() (unit, bool) {
	var base unit
	switch {
	case p.i < len(p.s) && p.s[p.i] == '(':
		p.i++
		inner, ok := p.expr()
		if !ok || p.i >= len(p.s) || p.s[p.i] != ')' {
			return unit{}, false
		}
		p.i++
		base = inner
	default:
		found := false
		for _, sym := range symbols {
			if strings.HasPrefix(p.s[p.i:], sym) {
				base, found = units[sym], true
				p.i += len(sym)
				break
			}
		}
		if !found {
			return unit{}, false
		}
	}
	if p.i < len(p.s) && p.s[p.i] == '^' {
		p.i++
		paren := p.i < len(p.s) && p.s[p.i] == '('
		if paren {
			p.i++
		}
		start := p.i
		if p.i < len(p.s) && (p.s[p.i] == '-' || p.s[p.i] == '+') {
			p.i++
		}
		for p.i < len(p.s) && p.s[p.i] >= '0' && p.s[p.i] <= '9' {
			p.i++
		}
		n, err := strconv.Atoi(p.s[start:p.i])
		if err != nil || n == 0 || n > 4 || n < -4 {
			return unit{}, false
		}
		if paren {
			if p.i >= len(p.s) || p.s[p.i] != ')' {
				return unit{}, false
			}
			p.i++
		}
		return unit{d: dims{}, factor: 1}.times(base, n), true
	}
	return base, true
}

var unitEdge = `(?:^|[^A-Za-zµΩ°])`

// judgeQuantity compares an answer to a recorded quantity.
func judgeQuantity(prompt string, want *quantity, answer string) Verdict {
	inSI := want.value * want.unit.factor
	got, ok := parseQuantity(answer, false)
	if !ok {
		// A number alone: the recorded value without its unit, or (for an
		// angle) the value in radians.
		p, err := Parse(answer)
		if err != nil {
			return Skip
		}
		vars := map[string]bool{}
		collect(p.Root, vars)
		if len(vars) > 0 || p.Root.kind == nEq {
			return Skip
		}
		v := eval(p.Root, nil)
		switch {
		case !finite(v):
			return Skip
		case near(v, want.value):
			return MissingUnit
		case want.unit.d == (dims{0, 0, 0, 0, 1}) && near(v, inSI):
			return askedFor(prompt, want)
		}
		return Wrong
	}
	if got.unit.d != want.unit.d {
		return Wrong
	}
	value := got.value * got.unit.factor
	if near(got.unit.factor, want.unit.factor) {
		if near(value, inSI) {
			return Right
		}
		return Wrong
	}
	// Rounded to the coarser of the two answers' last digits: 0 km is not 300 m.
	if near(value, inSI) || math.Abs(value-inSI) <= math.Min(got.tolerance, want.tolerance) {
		return askedFor(prompt, want)
	}
	return Wrong
}

// askedFor: an equal value in another unit is right, unless the question
// names the recorded unit, which it then asks for.
func askedFor(prompt string, want *quantity) Verdict {
	named := regexp.MustCompile(unitEdge + regexp.QuoteMeta(want.text) + `(?:$|[^A-Za-zµΩ°])`)
	if named.MatchString(prompt) {
		return AlmostUnit
	}
	return Right
}
