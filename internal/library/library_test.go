package library

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestTheEmbeddedCatalogueIsWhole(t *testing.T) {
	c, err := Embedded()
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Items) < 10_000 || len(c.Sources) < 20 {
		t.Fatalf("%d items from %d sources", len(c.Items), len(c.Sources))
	}
	subjects := map[string]bool{}
	certificates := map[string]int{}
	for i, it := range c.Items {
		if it.Position != i {
			t.Fatalf("item %s at %d has position %d", it.ID, i, it.Position)
		}
		subjects[it.Subject] = true
		if it.Certificate != nil {
			certificates[it.Certificate.Kind]++
		}
	}
	if len(subjects) != len(Subjects) {
		t.Errorf("%d of %d fields have items", len(subjects), len(Subjects))
	}
	for _, kind := range []string{"free", "badge", "paid"} {
		if certificates[kind] < 50 {
			t.Errorf("%d items with a %s certificate", certificates[kind], kind)
		}
	}
}

// A bad export fails by name, before the database's constraints would.
func TestABadCatalogueIsRefused(t *testing.T) {
	good := Exported{Item: Item{ID: "a", Kind: "book", Subject: "law", Language: "en", Source: ItemSource{Name: "S"}, Action: json.RawMessage(`{}`)}}
	hours, rating := 0.75, 4.5
	good.Hours, good.Year = &hours, 2019
	good.Rating = &Rating{Value: rating, Count: 2, Scores: map[string]float64{"clarity": 4.5}}
	good.Popularity = &Popularity{Count: 9, Kind: "views"}
	cases := map[string]func(*Catalogue){
		"nothing wrong":  func(*Catalogue) {},
		"no version":     func(c *Catalogue) { c.Version = "x" },
		"no sequence":    func(c *Catalogue) { c.Sequence = 0 },
		"hours":          func(c *Catalogue) { h := 0.001; c.Items[0].Hours = &h },
		"year":           func(c *Catalogue) { c.Items[0].Year = 20190 },
		"rating":         func(c *Catalogue) { c.Items[0].Rating = &Rating{Value: 6} },
		"score":          func(c *Catalogue) { c.Items[0].Rating = &Rating{Value: 4, Scores: map[string]float64{"clarity": 0}} },
		"popularity":     func(c *Catalogue) { c.Items[0].Popularity = &Popularity{Kind: "likes"} },
		"twice":          func(c *Catalogue) { c.Items = append(c.Items, c.Items[0]) },
		"kind":           func(c *Catalogue) { c.Items[0].Kind = "film" },
		"field":          func(c *Catalogue) { c.Items[0].Subject = "geography" },
		"level":          func(c *Catalogue) { c.Items[0].Level = "expert" },
		"unknown source": func(c *Catalogue) { c.Items[0].Source.Name = "T" },
		"certificate":    func(c *Catalogue) { c.Items[0].Certificate = &Certificate{Kind: "gold"} },
		"no action":      func(c *Catalogue) { c.Items[0].Action = nil },
	}
	for name, spoil := range cases {
		c := &Catalogue{Version: strings.Repeat("a", 64), Sequence: 1, Sources: []Source{{Name: "S"}}, Items: []Exported{good}}
		spoil(c)
		data, _ := json.Marshal(c)
		var gz bytes.Buffer
		w := gzip.NewWriter(&gz)
		_, _ = w.Write(data)
		_ = w.Close()
		if _, err := parse(gz.Bytes()); (err == nil) != (name == "nothing wrong") {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestAFilterIsCheckedAndItsLanguagesAndWordsRead(t *testing.T) {
	for _, f := range []Filter{{Sort: "random"}, {Kind: "film"}, {Certificate: "gold"}, {Offset: -1}, {Lang: strings.Repeat("x", 13)}} {
		if err := f.Normalize(); !errors.Is(err, ErrBadFilter) {
			t.Errorf("%+v: %v", f, err)
		}
	}
	f := Filter{Q: "  " + strings.Repeat("é", 100)}
	if err := f.Normalize(); err != nil || f.Sort != "featured" || len([]rune(f.Q)) != MaxQuery {
		t.Errorf("defaults: %+v %v", f, err)
	}
	for lang, want := range map[[2]string][]string{
		{"", "vi"}:    {"vi", "en"},
		{"", "en"}:    {"en"},
		{"", "pt-BR"}: {"pt", "en"},
		{"all", "vi"}: nil,
		{"fr", "vi"}:  {"fr"},
	} {
		if got := (Filter{Lang: lang[0], UI: lang[1]}).Languages(); !reflect.DeepEqual(got, want) {
			t.Errorf("%v: %v, want %v", lang, got, want)
		}
	}
	if got := (Filter{Q: "Đề thi, TỐT-nghiệp C++"}).Words(); !reflect.DeepEqual(got, []string{"de", "thi", "tot", "nghiep", "c"}) {
		t.Errorf("words: %q", got)
	}
}

// fakeStore is a loaded or empty catalogue for the service's own rules.
type fakeStore struct {
	version   string
	sequence  int
	replaced  int
	langCalls int
}

func (f *fakeStore) LoadedCatalogue(context.Context) (string, int, error) {
	return f.version, f.sequence, nil
}
func (f *fakeStore) ReplaceCatalogue(_ context.Context, c *Catalogue, _ bool) (bool, error) {
	f.version, f.sequence = c.Version, c.Sequence
	f.replaced++
	return true, nil
}
func (f *fakeStore) FindItems(context.Context, Filter, int) (int, []Item, error) { return 0, nil, nil }
func (f *fakeStore) FieldSamples(context.Context, Filter, int) (int, []FieldGroup, error) {
	return 0, nil, nil
}
func (f *fakeStore) LibraryItem(context.Context, string) (*Item, error) { return nil, ErrNotFound }
func (f *fakeStore) CatalogueLanguages(context.Context) ([]string, error) {
	f.langCalls++
	return []string{"vi", "en", "de"}, nil
}

func TestTheServiceLoadsOnlyANewerCatalogueAndSaysWhenNoneIs(t *testing.T) {
	ctx := context.Background()
	c, _ := Embedded()
	store := &fakeStore{}
	svc := NewService(store)
	if _, _, err := svc.Find(ctx, Filter{}); !errors.Is(err, ErrNotLoaded) {
		t.Fatalf("before a load: %v", err)
	}
	if _, err := svc.Languages(ctx); !errors.Is(err, ErrNotLoaded) {
		t.Fatalf("languages before a load: %v", err)
	}
	if loaded, err := svc.Sync(ctx, false); !loaded || err != nil {
		t.Fatalf("first load: %v %v", loaded, err)
	}
	if loaded, _ := svc.Sync(ctx, false); loaded {
		t.Error("the same version was loaded again")
	}
	// A later export is in the database: an older binary leaves it.
	store.version, store.sequence = strings.Repeat("b", 64), c.Sequence+1
	if loaded, _ := svc.Sync(ctx, false); loaded || store.replaced != 1 {
		t.Error("an older catalogue replaced a later one")
	}
	if loaded, _ := svc.Sync(ctx, true); !loaded {
		t.Error("--force did not load")
	}
	// Languages are kept for a version, read again for another.
	for range 3 {
		if langs, err := svc.Languages(ctx); err != nil || !reflect.DeepEqual(langs, []string{"en", "de", "vi"}) {
			t.Fatalf("languages: %v %v", langs, err)
		}
	}
	store.version = strings.Repeat("c", 64)
	_, _ = svc.Languages(ctx)
	if store.langCalls != 2 {
		t.Errorf("languages were read %d times for two versions", store.langCalls)
	}
}
