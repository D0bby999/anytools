package api

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/api/httpx"
)

// A pattern in httpx.RouteClasses that no handler registers is a limit that
// protects nothing — the route was renamed and its budget did not follow.
func TestEveryLimitedRouteIsRegistered(t *testing.T) {
	registered := RegisteredPatterns()
	rl := httpx.NewRouteLimiter(httpx.RouteClasses)
	defer rl.Close()
	for _, p := range rl.LimitedPatterns() {
		if !slices.Contains(registered, p) {
			t.Errorf("httpx.RouteClasses names %q, which is not a registered route", p)
		}
	}
}

var budgetMarker = regexp.MustCompile(`mux\.(?:HandleFunc|Handle)\(\s*"([^"]+)".*//\s*budget:\s*([a-z]+)`)

// budgetMarkers reads each registration line's `// budget: <class>` comment.
func budgetMarkers(t *testing.T) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.WalkDir(".", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, line := range strings.Split(string(src), "\n") {
			if m := budgetMarker.FindStringSubmatch(line); m != nil {
				out[m[1]] = m[2]
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// Learning-depth red team SF-6: model-calling routes shipped with no budget
// (the quiz judge, Mastery's question generation). Nothing looked at a route
// when it was added. Now the decision is made where the route is registered:
// every write route says which budget it spends, or `none`, and the comment
// and httpx.RouteClasses must agree in both directions.
func TestEveryWriteRouteDeclaresItsBudget(t *testing.T) {
	markers := budgetMarkers(t)
	classOf := map[string]string{}
	for _, c := range httpx.RouteClasses {
		for _, p := range c.Patterns {
			classOf[p] = c.Name
		}
	}
	for _, p := range RegisteredPatterns() {
		method, _, _ := strings.Cut(p, " ")
		marker, marked := markers[p]
		class := classOf[p]
		switch {
		case !marked && method != "GET":
			t.Errorf("%s: add `// budget: <class>` to its registration — `none` if it never calls a model, a TTS voice, a search or a parse", p)
		case !marked && class != "":
			t.Errorf("%s is in the %q class but its registration has no `// budget: %s` comment", p, class, class)
		case marked && marker == "none" && class != "":
			t.Errorf("%s says `budget: none` but httpx.RouteClasses puts it in %q", p, class)
		case marked && marker != "none" && marker != class:
			t.Errorf("%s says `budget: %s` but httpx.RouteClasses has it in %q", p, marker, class)
		}
	}
	names := map[string]bool{"none": true}
	for _, c := range httpx.RouteClasses {
		names[c.Name] = true
	}
	for p, m := range markers {
		if !names[m] {
			t.Errorf("%s: unknown budget class %q", p, m)
		}
	}
}
