package worksheet

import (
	"slices"
	"strings"
	"testing"
)

// shownTexts is every text a learner reads in the registered kinds, the
// export's words and PrivateTitle: what each catalog must hold.
func shownTexts() map[string]bool {
	out := map[string]bool{PrivateTitle: true}
	for _, w := range exportWords {
		out[w] = true
	}
	for _, k := range Kinds() {
		if k.Kind == example.Kind {
			continue // a development fixture, never registered in production
		}
		eachText(Localized(k, "en"), func(s string) string {
			if s != "" {
				out[s] = true
			}
			return s
		})
	}
	return out
}

func TestEveryKindIsTranslated(t *testing.T) {
	texts := shownTexts()
	for _, lang := range Languages {
		c := catalogs[lang]
		var missing, stale []string
		for s := range texts {
			if c[s] == "" {
				missing = append(missing, s)
			}
		}
		for s := range c {
			if !texts[s] {
				stale = append(stale, s)
			}
		}
		slices.Sort(missing)
		slices.Sort(stale)
		if len(missing) > 0 {
			t.Errorf("i18n/%s.json lacks %d texts, such as %q", lang, len(missing), missing[:min(3, len(missing))])
		}
		if len(stale) > 0 {
			t.Errorf("i18n/%s.json holds %d texts no kind shows, such as %q", lang, len(stale), stale[:min(3, len(stale))])
		}
	}
}

func TestLocalizedTranslatesWhatIsReadAndKeepsWhatIsStored(t *testing.T) {
	k, ok := Lookup("english_diagnostic")
	if !ok {
		t.Fatal("english_diagnostic is not registered")
	}
	before := k.Name
	vi := Localized(k, "vi")
	if k.Name != before {
		t.Fatal("Localized changed the registered kind")
	}
	if vi.Name == k.Name || vi.Kind != k.Kind || vi.Version != k.Version {
		t.Fatalf("vi kind = %q %q v%d", vi.Name, vi.Kind, vi.Version)
	}
	for si, s := range vi.Sections {
		if s.Key != k.Sections[si].Key {
			t.Fatalf("section key %q became %q", k.Sections[si].Key, s.Key)
		}
		for fi, f := range s.Fields {
			orig := k.Sections[si].Fields[fi]
			if f.Key != orig.Key || !slices.Equal(f.Options, orig.Options) {
				t.Fatalf("%s.%s: keys or stored options changed", s.Key, f.Key)
			}
			for _, o := range f.Options {
				if f.optionText(o) == "" {
					t.Fatalf("%s.%s: option %q reads empty", s.Key, f.Key, o)
				}
			}
		}
	}
	if Localized(k, "en") != k || Localized(k, "xx") != k {
		t.Error("English or an unknown language should answer the kind itself")
	}
}

// The export reads in the learner's language; its front matter keeps what is
// stored.
func TestTheExportIsInTheLearnersLanguage(t *testing.T) {
	k, _ := Lookup("english_diagnostic")
	w := &Worksheet{Kind: k.Kind, Title: "T", Status: "open",
		Answers: Answers{"boundary": {"context": "work"}}}
	vi := MarkdownIn(k, w, "vi")
	for _, want := range []string{"Chẩn đoán ngoại ngữ", "Bối cảnh thật: công việc", `kind: "english_diagnostic"`} {
		if !strings.Contains(vi, want) {
			t.Errorf("vi export lacks %q", want)
		}
	}
	if en := Markdown(k, w); !strings.Contains(en, "Real context: work") {
		t.Error("the English export changed")
	}
}

func TestTranslatedKindsAreInTheirLanguagesOrder(t *testing.T) {
	var names []string
	for _, k := range LocalizedKinds("vi") {
		if k.Group == GroupLanguage && k.Kind != example.Kind {
			names = append(names, k.Name)
		}
	}
	if len(names) < 2 || names[0] != "Bản đồ lỗi ngữ pháp" {
		t.Errorf("vi language kinds = %q", names)
	}
}
