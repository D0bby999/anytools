package visualize

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"
)

// validate.go is the server's half of the diagram rules. The browser's half is
// ui/web/app/lib/chart-spec.ts and components/diagram/mermaid-block.tsx; a
// shared fixture file (testdata/charts.json) runs through both, so the two
// cannot drift apart. Mermaid is only checked here for shape (a known diagram
// keyword, the size caps, no directives or click handlers): the full parse
// needs Mermaid itself and runs in the browser, which reports a failure back
// through the repair route.

// Limits, the same numbers as the browser's.
const (
	MaxMermaidChars = 6000
	MaxMermaidLines = 300
	maxChartSource  = 20000
	maxChartLabels  = 100
	maxDatasets     = 8
	maxPoints       = 500
	maxChartText    = 200
	maxCaption      = 300
)

// Kinds of diagram.
const (
	KindMermaid = "mermaid"
	KindChart   = "chart"
)

// ErrInvalid is what a diagram that breaks a rule wraps.
var ErrInvalid = errors.New("diagram is not drawable")

// mermaidKeywords are the diagram types a model is asked to use. A first line
// outside this list is a diagram type the prompt did not offer, often one of
// the types behind Mermaid's denial-of-service advisories (radar, xychart).
var mermaidKeywords = []string{
	"flowchart", "graph", "sequenceDiagram", "mindmap", "timeline",
	"stateDiagram", "stateDiagram-v2", "erDiagram", "classDiagram", "journey", "pie",
}

// forbiddenMermaid are constructs the prompt rules out and the browser would
// either refuse or render inert. Refusing them here keeps them out of the
// stored conversation altogether.
var forbiddenMermaid = regexp.MustCompile(`(?im)(%%\{|^\s*click\s|^\s*classDef\s|^\s*style\s|<\s*/?\s*[a-z]+[^>]*>|javascript:)`)

// Diagram is a validated diagram, in the form it is stored and rendered.
type Diagram struct {
	Kind    string `json:"kind"`
	Source  string `json:"source"`
	Caption string `json:"caption"`
}

// Validate checks a model's diagram and returns it normalised: a chart's spec
// is REBUILT from its allowed fields, so nothing else it carried is kept.
func Validate(d Diagram) (Diagram, error) {
	d.Kind = strings.TrimSpace(strings.ToLower(d.Kind))
	d.Source = strings.TrimSpace(d.Source)
	d.Caption = truncate(strings.TrimSpace(d.Caption), maxCaption)
	switch d.Kind {
	case KindMermaid:
		if err := validMermaid(d.Source); err != nil {
			return Diagram{}, err
		}
		return d, nil
	case KindChart:
		spec, err := ParseChartSpec(d.Source)
		if err != nil {
			return Diagram{}, err
		}
		raw, err := json.Marshal(spec)
		if err != nil {
			return Diagram{}, fmt.Errorf("%w: %s", ErrInvalid, err)
		}
		d.Source = string(raw)
		return d, nil
	default:
		return Diagram{}, fmt.Errorf("%w: kind must be mermaid or chart, not %q", ErrInvalid, d.Kind)
	}
}

func validMermaid(src string) error {
	if src == "" {
		return fmt.Errorf("%w: the diagram is empty", ErrInvalid)
	}
	if utf8.RuneCountInString(src) > MaxMermaidChars || strings.Count(src, "\n")+1 > MaxMermaidLines {
		return fmt.Errorf("%w: at most %d characters and %d lines", ErrInvalid, MaxMermaidChars, MaxMermaidLines)
	}
	if m := forbiddenMermaid.FindString(src); m != "" {
		return fmt.Errorf("%w: %q is not allowed (no HTML, directives, click handlers or styles)", ErrInvalid, strings.TrimSpace(m))
	}
	first := ""
	for _, line := range strings.Split(src, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "%%") {
			first = line
			break
		}
	}
	word := strings.Fields(first + " ")[0]
	for _, k := range mermaidKeywords {
		if word == k {
			return nil
		}
	}
	return fmt.Errorf("%w: the first line must name a diagram type (%s), not %q", ErrInvalid, strings.Join(mermaidKeywords, ", "), word)
}

// ChartSpec is the allow-listed chart, the same shape chart-spec.ts builds.
type ChartSpec struct {
	Type     string         `json:"type"`
	Labels   []string       `json:"labels"`
	Datasets []ChartDataset `json:"datasets"`
	Title    string         `json:"title,omitempty"`
	XTitle   string         `json:"xTitle,omitempty"`
	YTitle   string         `json:"yTitle,omitempty"`
	Stacked  bool           `json:"stacked"`
}

// ChartDataset is one series: numbers, or {x,y} points for a scatter chart.
type ChartDataset struct {
	Label string `json:"label"`
	Data  []any  `json:"data"`
}

var chartTypes = map[string]bool{"bar": true, "line": true, "pie": true, "doughnut": true, "scatter": true, "radar": true}

// ParseChartSpec validates a chart fence's JSON and rebuilds it from the
// allowed fields. The rules are chart-spec.ts's, one for one.
func ParseChartSpec(source string) (*ChartSpec, error) {
	bad := func(why string) (*ChartSpec, error) { return nil, fmt.Errorf("%w: %s", ErrInvalid, why) }
	if len(source) > maxChartSource {
		return bad("the chart spec is too long")
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(source), &raw); err != nil {
		return bad("the chart spec is not a JSON object")
	}
	typ, _ := raw["type"].(string)
	if !chartTypes[typ] {
		return bad("type must be bar, line, pie, doughnut, scatter or radar")
	}
	data, _ := raw["data"].(map[string]any)
	datasets, ok := data["datasets"].([]any)
	if data == nil || !ok || len(datasets) == 0 || len(datasets) > maxDatasets {
		return bad(fmt.Sprintf("data.datasets must hold 1 to %d series", maxDatasets))
	}

	spec := &ChartSpec{Type: typ, Labels: []string{}}
	if l, present := data["labels"]; present && l != nil {
		labels, ok := l.([]any)
		if !ok || len(labels) > maxChartLabels {
			return bad(fmt.Sprintf("data.labels must be at most %d strings", maxChartLabels))
		}
		for _, v := range labels {
			switch x := v.(type) {
			case string:
				spec.Labels = append(spec.Labels, truncate(x, maxChartText))
			case float64:
				spec.Labels = append(spec.Labels, truncate(formatNumber(x), maxChartText))
			default:
				return bad("labels must be strings or numbers")
			}
		}
	}

	for i, d := range datasets {
		ds, _ := d.(map[string]any)
		points, ok := ds["data"].([]any)
		if ds == nil || !ok || len(points) > maxPoints {
			return bad(fmt.Sprintf("each series needs data: at most %d values", maxPoints))
		}
		out := ChartDataset{Label: fmt.Sprintf("Series %d", i+1), Data: []any{}}
		if label, _ := ds["label"].(string); strings.TrimSpace(label) != "" {
			out.Label = truncate(label, maxChartText)
		}
		for _, p := range points {
			if typ == "scatter" {
				pt, _ := p.(map[string]any)
				x, okx := finite(pt["x"])
				y, oky := finite(pt["y"])
				if !okx || !oky {
					return bad("scatter points must be {x, y} numbers")
				}
				out.Data = append(out.Data, map[string]float64{"x": x, "y": y})
			} else {
				v, ok := finite(p)
				if !ok {
					return bad("values must be numbers")
				}
				out.Data = append(out.Data, v)
			}
		}
		spec.Datasets = append(spec.Datasets, out)
	}

	opts, _ := raw["options"].(map[string]any)
	plugins, _ := opts["plugins"].(map[string]any)
	if title, _ := plugins["title"].(map[string]any); title != nil {
		spec.Title = text(title["text"])
	} else {
		spec.Title = text(opts["title"])
	}
	scales, _ := opts["scales"].(map[string]any)
	axisTitle := func(axis any) string {
		a, _ := axis.(map[string]any)
		t, _ := a["title"].(map[string]any)
		return text(t["text"])
	}
	spec.XTitle, spec.YTitle = axisTitle(scales["x"]), axisTitle(scales["y"])
	for _, axis := range []any{scales["x"], scales["y"]} {
		if a, _ := axis.(map[string]any); a != nil && a["stacked"] == true {
			spec.Stacked = true
		}
	}
	if opts["stacked"] == true {
		spec.Stacked = true
	}
	return spec, nil
}

func finite(v any) (float64, bool) {
	f, ok := v.(float64)
	return f, ok && !math.IsNaN(f) && !math.IsInf(f, 0)
}

func text(v any) string {
	s, _ := v.(string)
	if strings.TrimSpace(s) == "" {
		return ""
	}
	return truncate(s, maxChartText)
}

func formatNumber(f float64) string {
	b, _ := json.Marshal(f)
	return string(b)
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
