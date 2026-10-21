package body

import "testing"

// wger's names in the library (the private design notes,
// phase 3): each with its licence, and found by a search.
func TestWgerNamesCarryTheirLicence(t *testing.T) {
	var es string
	for _, e := range Library() {
		w := e.Wger
		if w == nil {
			continue
		}
		for lang, name := range w.Names {
			if name == "" || w.Licences[lang] == "" {
				t.Fatalf("%s: wger's %s name %q without a licence", e.ID, lang, name)
			}
		}
		if es == "" {
			es = w.Names["es"]
		}
	}
	if es == "" {
		t.Fatal("no Spanish name in the library")
	}
	if got, n := Search(LibraryFilter{Q: es}); n == 0 || got[0].Wger == nil {
		t.Fatalf("searching %q: %d found", es, n)
	}
}
