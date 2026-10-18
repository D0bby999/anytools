package byok_test

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/store"
)

// functions_migration_test.go — the test that makes "one Go constant list" true.
//
// A CHECK constraint cannot import Go, so the nine function names necessarily
// appear twice: once in byok.AllFunctions and once in the migration. Red-team
// RT-13 found the plan's earlier enum missing `mastery` and `reading` for
// exactly that reason — the list was written twice and the copies drifted, with
// nothing to notice. This test is what notices.

func TestMigrationCheckMatchesFunctionEnum(t *testing.T) {
	// The CHECK is the authority on what the database will accept, so the
	// pattern is anchored on the constraint rather than on any list of strings
	// that happens to appear in a file. A later migration may widen it (tts,
	// learning depth phase 10), so the definition read is the last one.
	re := regexp.MustCompile(`(?s)CONSTRAINT function_routes_function_known CHECK \(\s*"function" IN \((.*?)\)`)
	m := latestMatch(t, re)
	if m == nil {
		t.Fatal("could not find the function_routes CHECK constraint in the byok migration — " +
			"if it was renamed, this test must be updated to follow it, not deleted")
	}

	inMigration := parseQuotedList(m[1])
	inGo := make([]string, 0, len(byok.AllFunctions()))
	for _, f := range byok.AllFunctions() {
		inGo = append(inGo, string(f))
	}

	sort.Strings(inMigration)
	sorted := append([]string(nil), inGo...)
	sort.Strings(sorted)

	if strings.Join(inMigration, ",") != strings.Join(sorted, ",") {
		t.Fatalf("the function enum and the migration CHECK disagree\n  Go:        %v\n  migration: %v\n"+
			"byok.AllFunctions() is the single definition; update the migration to match it",
			sorted, inMigration)
	}
}

// The chain length is the other number written in two places.
func TestMigrationPositionRangeMatchesMaxChainEntries(t *testing.T) {
	sql := readMigration(t, "byok")
	want := "position >= 0 AND position < " + itoa(byok.MaxChainEntries)
	if !strings.Contains(sql, want) {
		t.Fatalf("migration does not constrain route position to byok.MaxChainEntries (%d); expected to find %q",
			byok.MaxChainEntries, want)
	}
}

// The provider list is a third. A provider Go can build a client for but the
// database refuses is a 500 at write time; the reverse is a row nothing can serve.
func TestMigrationProviderCheckCoversEveryAPIKeyProvider(t *testing.T) {
	re := regexp.MustCompile(`(?s)CONSTRAINT provider_connections_provider_known CHECK \(\s*provider IN \((.*?)\)\)`)
	// The constraint is redefined when providers are added; the one in force is
	// the last up-migration that defines it.
	m := latestMatch(t, re)
	allowed := map[string]bool{}
	for _, p := range parseQuotedList(m[1]) {
		allowed[p] = true
	}
	for _, p := range byok.APIKeyProviders() {
		if !allowed[p] {
			t.Errorf("provider %q is offered by the API but rejected by the migration CHECK", p)
		}
	}
}

func readMigration(t *testing.T, slug string) string {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join("..", "..", "migrations", "*_"+slug+".up.sql"))
	if err != nil || len(matches) != 1 {
		t.Fatalf("expected exactly one *_%s.up.sql migration, found %v (err %v)", slug, matches, err)
	}
	data, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	return string(data)
}

// latestMatch applies re to every up-migration in order and returns the last
// match, i.e. the definition in force after migrating up.
func latestMatch(t *testing.T, re *regexp.Regexp) []string {
	t.Helper()
	files, err := filepath.Glob(filepath.Join("..", "..", "migrations", "*.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(files)
	var last []string
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if m := re.FindStringSubmatch(string(data)); m != nil {
			last = m
		}
	}
	if last == nil {
		t.Fatalf("no migration matches %s", re)
	}
	return last
}

func parseQuotedList(s string) []string {
	out := []string{}
	for _, m := range regexp.MustCompile(`'([^']+)'`).FindAllStringSubmatch(s, -1) {
		out = append(out, m[1])
	}
	return out
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

// Every connection kind and subscription provider the Go side writes must be
// one the constraint in force accepts.
func TestMigrationChecksCoverEverySubscriptionLane(t *testing.T) {
	kinds := latestMatch(t, regexp.MustCompile(`(?s)CONSTRAINT provider_connections_kind_known CHECK \(\s*kind IN \((.*?)\)\)`))
	provs := latestMatch(t, regexp.MustCompile(`(?s)CONSTRAINT provider_connections_provider_known CHECK \(\s*provider IN \((.*?)\)\)`))
	has := func(list, v string) bool {
		for _, p := range parseQuotedList(list) {
			if p == v {
				return true
			}
		}
		return false
	}
	for _, k := range []string{store.KindAPIKey, store.KindOAuthRelay, store.KindOAuthGeminiSub, store.KindOAuthCopilot, store.KindOAuthClaudeSub} {
		if !has(kinds[1], k) {
			t.Errorf("kind %q is written by Go but rejected by the migration CHECK", k)
		}
	}
	for _, p := range []string{providers.ProviderChatGPTRelay, providers.ProviderGeminiSub, providers.ProviderGitHubCopilot, providers.ProviderClaudeSub} {
		if !has(provs[1], p) {
			t.Errorf("provider %q is written by Go but rejected by the migration CHECK", p)
		}
	}
}
