package worksheet

import (
	"embed"
	"encoding/json"
	"maps"
	"slices"
	"sort"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// A kind is written in English, and what it stores (field keys, row keys,
// option values) stays English in every language. What the learner reads is
// translated on the way out: Localized copies a kind with its display text
// from i18n/<language>.json, keyed by the English text, and names each
// option's translation in OptionLabels so the stored value does not change.
// A text the catalog lacks stays English; TestEveryKindIsTranslated keeps
// the catalogs whole.

//go:embed i18n/*.json
var catalogFiles embed.FS

// Languages are the interface languages a kind is translated into, besides
// English.
var Languages = []string{"vi", "es", "pt"}

var catalogs = func() map[string]map[string]string {
	out := map[string]map[string]string{}
	for _, lang := range Languages {
		raw, err := catalogFiles.ReadFile("i18n/" + lang + ".json")
		if err != nil {
			panic(err)
		}
		m := map[string]string{}
		if err := json.Unmarshal(raw, &m); err != nil {
			panic("worksheet: i18n/" + lang + ".json: " + err.Error())
		}
		out[lang] = m
	}
	return out
}()

// translator returns the text in lang, or the English text.
func translator(lang string) func(string) string {
	c := catalogs[lang]
	return func(s string) string {
		if t, ok := c[s]; ok && t != "" {
			return t
		}
		return s
	}
}

// Localized is a copy of k for display in lang; k itself is untouched, and
// English answers k unchanged. The copy keeps Check and CheckWritten, but
// validate against the registered kind: the copy is for showing.
func Localized(k *Kind, lang string) *Kind {
	if _, ok := catalogs[lang]; !ok || k == nil {
		return k
	}
	c := *k
	c.Reviews = slices.Clone(k.Reviews)
	c.Sections = slices.Clone(k.Sections)
	for i := range c.Sections {
		c.Sections[i].Fields = cloneFields(c.Sections[i].Fields)
	}
	eachText(&c, translator(lang))
	return &c
}

// LocalizedKinds is Kinds for display in lang, sorted by group, then by the
// translated name in that language's order.
func LocalizedKinds(lang string) []*Kind {
	out := Kinds()
	if _, ok := catalogs[lang]; !ok {
		return out
	}
	for i, k := range out {
		out[i] = Localized(k, lang)
	}
	c := collate.New(language.Make(lang))
	sort.SliceStable(out, func(i, j int) bool {
		if gi, gj := groupOrder(out[i].Group), groupOrder(out[j].Group); gi != gj {
			return gi < gj
		}
		return c.CompareString(out[i].Name, out[j].Name) < 0
	})
	return out
}

// NameIn is Name in lang.
func NameIn(kind, lang string) string {
	return translator(lang)(Name(kind))
}

// exportWords are the export's own words (export.go), translated beside the
// kinds' texts.
var exportWords = []string{"yes", "no", "recording", "recording (missing)", "From an earlier version"}

// optionText is a stored option as the learner reads it.
func (f *Field) optionText(v string) string {
	if t, ok := f.OptionLabels[v]; ok {
		return t
	}
	return v
}

// TextIn is one of a kind's texts, or PrivateTitle, in lang.
func TextIn(text, lang string) string {
	return translator(lang)(text)
}

func cloneFields(fs []Field) []Field {
	fs = slices.Clone(fs)
	for i := range fs {
		f := &fs[i]
		f.ScoreLabels = slices.Clone(f.ScoreLabels)
		f.OptionHints = maps.Clone(f.OptionHints)
		f.Text = maps.Clone(f.Text)
		f.Rows = slices.Clone(f.Rows)
		f.Columns = cloneFields(f.Columns)
	}
	return fs
}

// eachText rewrites every text a learner reads in k through tr, and fills
// OptionLabels. It is the one list of what is display text: Localized uses
// it to translate and the catalog test to collect.
func eachText(k *Kind, tr func(string) string) {
	k.Name = tr(k.Name)
	k.Summary = tr(k.Summary)
	for i := range k.Reviews {
		k.Reviews[i].Label = tr(k.Reviews[i].Label)
	}
	for i := range k.Sections {
		s := &k.Sections[i]
		s.Title = tr(s.Title)
		s.Hint = tr(s.Hint)
		fieldTexts(s.Fields, tr)
	}
}

func fieldTexts(fs []Field, tr func(string) string) {
	for i := range fs {
		f := &fs[i]
		f.Label = tr(f.Label)
		f.Hint = tr(f.Hint)
		f.RowHeader = tr(f.RowHeader)
		for j := range f.ScoreLabels {
			f.ScoreLabels[j] = tr(f.ScoreLabels[j])
		}
		for o, h := range f.OptionHints {
			f.OptionHints[o] = tr(h)
		}
		for r, t := range f.Text {
			f.Text[r] = tr(t)
		}
		for j := range f.Rows {
			f.Rows[j].Label = tr(f.Rows[j].Label)
		}
		var labels map[string]string
		label := func(o string) {
			if t := tr(o); t != o {
				if labels == nil {
					labels = map[string]string{}
				}
				labels[o] = t
			}
		}
		for _, o := range f.Options {
			label(o)
		}
		for _, opts := range f.RowOptions {
			for _, o := range opts {
				label(o)
			}
		}
		f.OptionLabels = labels
		fieldTexts(f.Columns, tr)
	}
}
