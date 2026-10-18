package worksheetapi_test

// kinds_test.go — up methods phase 14, requirement 2: GET /v1/worksheet-kinds
// serves exactly the plan's 21 kinds, each in its group and with its privacy,
// and each pinned to an outline generated from up. This test binary links the
// product kinds only: the engine's example kind is registered on a
// development server alone, and worksheettest's fixtures by the tests that
// import it.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/api/worksheetapi"
)

// planKinds is the plan's inventory (plan.md, owner decision 2026-10-01:
// "Worksheet kinds: 21"): kind → group, private.
var planKinds = map[string]struct {
	group   string
	private bool
}{
	// English diagnostic (phase 1).
	"english_diagnostic": {"language", false},
	// The six skill templates (phases 2–7).
	"listening_audit":   {"language", false},
	"reading_evidence":  {"language", false},
	"writing_evidence":  {"language", false},
	"grammar_evidence":  {"language", false},
	"speaking_evidence": {"language", false},
	"vocabulary_audit":  {"language", false},
	// The 14-day experiments (phases 2 and 7).
	"listening_experiment": {"language", false},
	"speaking_experiment":  {"language", false},
	// Grammar error map (phase 6).
	"grammar_error_map": {"language", false},
	// Projects and cases (phase 8). Its kind table places the interview
	// card in Language and the narrative review in Life; the plan's UI table
	// lists all five under Projects, and the phase file is the more specific.
	"artifact_brief":        {"projects", false},
	"interview_evidence":    {"language", false},
	"ai_case_review":        {"projects", false},
	"ai_project_scorecard":  {"projects", false},
	"narrative_case_review": {"life", true},
	// The life toolkit (phase 9).
	"choice_brief":       {"life", true},
	"attention_audit":    {"life", true},
	"relationship_card":  {"life", true},
	"recovery_reset":     {"life", true},
	"life_weekly_review": {"life", true},
	// Cycle close (phase 10).
	"cycle_close": {"projects", false},
	// The care card up added at f13ff2d (plans/261017-1828-up-f13ff2d-upgrade,
	// phase 1).
	"life_care_card": {"life", true},
	// The self-reflection cards of up's part 6
	// (plans/261017-1828-up-f13ff2d-upgrade, phase 3).
	"self_reflection": {"life", true},
	// The four templates new at f13ff2d (plans/261017-1828-up-f13ff2d-upgrade,
	// phase 2).
	"consistency_plan":   {"projects", false},
	"ai_evaluation":      {"projects", false},
	"ai_trend_radar":     {"projects", false},
	"startup_experiment": {"projects", false},
}

// datedKinds are the kinds whose up source has delayed retests (AC4): the
// diagnostic, the six skill templates and the artifact brief.
var datedKinds = map[string]bool{
	"english_diagnostic": true, "listening_audit": true, "reading_evidence": true, "writing_evidence": true,
	"grammar_evidence": true, "speaking_evidence": true, "vocabulary_audit": true, "artifact_brief": true,
}

func TestWorksheetKindsAreThePlansInventory(t *testing.T) {
	// 21 kinds from up-methods, plus the six of plans/261017-1828-up-f13ff2d-upgrade.
	if len(planKinds) != 27 {
		t.Fatalf("the plan's inventory has %d kinds, want 27", len(planKinds))
	}
	mux := http.NewServeMux()
	worksheetapi.NewHandler(nil).RegisterRoutes(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/worksheet-kinds", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/worksheet-kinds: %d %s", rec.Code, rec.Body)
	}
	var body struct {
		Kinds []struct {
			Kind       string `json:"kind"`
			Group      string `json:"group"`
			Private    bool   `json:"private"`
			Source     string `json:"source"`
			Sections   []any  `json:"sections"`
			Reviews    []any  `json:"reviews"`
			RowReviews []any  `json:"row_reviews"`
		} `json:"kinds"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}

	served := map[string]bool{}
	for _, k := range body.Kinds {
		served[k.Kind] = true
		want, ok := planKinds[k.Kind]
		if !ok {
			t.Errorf("%s is served but is not one of the plan's kinds", k.Kind)
			continue
		}
		if k.Group != want.group || k.Private != want.private {
			t.Errorf("%s: group %s, private %v; want %s, %v", k.Kind, k.Group, k.Private, want.group, want.private)
		}
		if !strings.HasPrefix(k.Source, "docs/en/") || len(k.Sections) == 0 {
			t.Errorf("%s: source %q with %d sections; every kind follows an up English file", k.Kind, k.Source, len(k.Sections))
		}
		if datedKinds[k.Kind] && len(k.Reviews)+len(k.RowReviews) == 0 {
			t.Errorf("%s: up's source has delayed retests, but the kind serves no review date", k.Kind)
		}
		// Each kind has an outline generated from up's Markdown (AC1). The
		// engine's TestEveryKindMatchesItsUpOutline compares them.
		outline := filepath.Join("..", "..", "learning", "worksheet", "testdata", "outlines", k.Kind+".txt")
		if _, err := os.Stat(outline); err != nil {
			t.Errorf("%s: no outline: %v", k.Kind, err)
		}
	}
	var missing []string
	for kind := range planKinds {
		if !served[kind] {
			missing = append(missing, kind)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("not served: %v", missing)
	}
	if len(body.Kinds) != len(planKinds) {
		t.Errorf("%d kinds served, want %d", len(body.Kinds), len(planKinds))
	}
}
