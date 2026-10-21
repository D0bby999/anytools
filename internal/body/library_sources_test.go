package body

import (
	"regexp"
	"strings"
	"testing"
)

// The library's added sources (the private design notes,
// phase 3): free-exercise-db's exercises and photos, wger's names.
func TestTheLibrarySourcesAreCreditedAndApart(t *testing.T) {
	ids := map[string]bool{}
	photoID := regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	photos, fedb := 0, 0
	for _, e := range Library() {
		if ids[e.ID] {
			t.Fatalf("two exercises are %s", e.ID)
		}
		ids[e.ID] = true
		switch e.Source {
		case SourceFedb:
			fedb++
			if !strings.HasPrefix(e.ID, "fe-") || len(e.Steps) == 0 || e.Target == "" {
				t.Fatalf("free-exercise-db entry %+v", e)
			}
		case SourceOpenGym:
			if strings.HasPrefix(e.ID, "fe-") {
				t.Fatalf("openGym entry with a free-exercise-db id: %s", e.ID)
			}
		default:
			t.Fatalf("%s has source %q", e.ID, e.Source)
		}
		if e.Photo != "" {
			photos++
			if !photoID.MatchString(e.Photo) {
				t.Fatalf("%s: photo id %q", e.ID, e.Photo)
			}
		}
		if w := e.Wger; w != nil {
			for lang, name := range w.Names {
				if name == "" || w.Licences[lang] == "" {
					t.Fatalf("%s: wger's %s name %q without a licence", e.ID, lang, name)
				}
			}
		}
	}
	if fedb < 600 || photos < 850 {
		t.Fatalf("%d free-exercise-db exercises, %d with photos", fedb, photos)
	}
}

func TestTheCoachChoosesFromOpenGymsListOnly(t *testing.T) {
	slice := librarySlice(nil)
	if strings.Contains(slice, "fe-") {
		t.Fatal("the coach's list has free-exercise-db's additions")
	}
	if n := strings.Count(slice, "\n"); n != 1324 {
		t.Fatalf("the coach's list has %d exercises, want 1324", n)
	}
}

func TestASearchFindsAnExerciseByItsSpanishName(t *testing.T) {
	var es string
	for _, e := range Library() {
		if e.Wger != nil && e.Wger.Names["es"] != "" {
			es = e.Wger.Names["es"]
			break
		}
	}
	if es == "" {
		t.Skip("no Spanish name in the library")
	}
	if got, n := Search(LibraryFilter{Q: es}); n == 0 || got[0].Wger == nil {
		t.Fatalf("searching %q: %d found", es, n)
	}
}
