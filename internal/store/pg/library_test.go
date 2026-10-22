package pg_test

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/library"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// The Library in Postgres (the private design notes): the
// embedded catalogue loads once per version, and the page's filters, sorts
// and first screen are answered from the tables.
func TestTheLibraryCatalogueLoadsAndAnswersThePage(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	store := pg.NewLibraryStore(pool)
	svc := library.NewService(store)
	cat, err := library.Embedded()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Sync(ctx, true); err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded, err := svc.Sync(ctx, false); err != nil || loaded {
		t.Fatalf("a second load of the same version: loaded %v, %v", loaded, err)
	}
	// Under the lock, an earlier export does not replace a later one.
	older := *cat
	older.Version, older.Sequence, older.Items = strings.Repeat("0", 64), cat.Sequence-1, nil
	if loaded, err := store.ReplaceCatalogue(ctx, &older, false); err != nil || loaded {
		t.Fatalf("an older export: loaded %v, %v", loaded, err)
	}
	if v, seq, _ := store.LoadedCatalogue(ctx); v != cat.Version || seq != cat.Sequence {
		t.Fatalf("loaded %s %d after an older export", v, seq)
	}
	var items, sources, scores int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM library_items`).Scan(&items)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM library_sources`).Scan(&sources)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM library_item_scores`).Scan(&scores)
	if items != len(cat.Items) || sources != len(cat.Sources) || scores < 1000 {
		t.Fatalf("loaded %d items, %d sources, %d scores; the export has %d and %d", items, sources, scores, len(cat.Items), len(cat.Sources))
	}

	find := func(f library.Filter) (int, []library.Item) {
		t.Helper()
		total, got, err := svc.Find(ctx, f)
		if err != nil {
			t.Fatal(err)
		}
		return total, got
	}

	// the private design notes, phase 6: a shelf per language learned,
	// whatever the material is written in and whatever the interface's.
	t.Run("a shelf for learning a language", func(t *testing.T) {
		total, got := find(library.Filter{Teaches: "en", UI: "vi"})
		ids := map[string]bool{}
		for _, it := range got {
			ids[it.ID] = true
			if it.Teaches != "en" {
				t.Errorf("%s teaches %q on the English shelf", it.ID, it.Teaches)
			}
		}
		if total < 10 || !ids["words:ngsl"] || !ids["voa-learning-english"] {
			t.Fatalf("English shelf: %d items, %v", total, ids)
		}
		// Japanese material is written in English or Japanese: both are on
		// the shelf of a Vietnamese learner.
		if _, ja := find(library.Filter{Teaches: "ja", UI: "vi"}); !slices.ContainsFunc(ja, func(it library.Item) bool { return it.ID == "words:jlpt" }) {
			t.Fatal("JLPT is not on the Japanese shelf")
		}
		if _, _, err := svc.Find(ctx, library.Filter{Teaches: "English"}); !errors.Is(err, library.ErrBadFilter) {
			t.Fatalf("a language name as a shelf: %v", err)
		}
	})

	t.Run("English first, the sources taking turns", func(t *testing.T) {
		_, got := find(library.Filter{Subject: "programming", UI: "vi"})
		if len(got) != library.PageSize {
			t.Fatalf("%d items", len(got))
		}
		seen := map[string]bool{}
		for _, it := range got[:10] {
			seen[it.Source.Name] = true
		}
		if len(seen) < 5 {
			t.Errorf("the first ten come from %d sources", len(seen))
		}
		total, _ := find(library.Filter{Lang: "all"})
		en, _ := find(library.Filter{Lang: "en"})
		_, last := find(library.Filter{Lang: "all", Offset: total - 1})
		_, first := find(library.Filter{Lang: "all", Offset: en - 40})
		if last[0].LanguageRank() != 2 || first[0].LanguageRank() != 0 {
			t.Errorf("not English first: rank %d at %d, rank %d last", first[0].LanguageRank(), en-40, last[0].LanguageRank())
		}
	})

	t.Run("certificates, levels, video, reusable, accents", func(t *testing.T) {
		paidTotal, paid := find(library.Filter{Certificate: "paid"})
		if paidTotal < 100 {
			t.Errorf("%d items with a paid certificate", paidTotal)
		}
		for _, it := range paid {
			// MITx Online gives one course's fee as nothing: shown as not given.
			if it.Certificate == nil || it.Certificate.Kind != "paid" || it.Source.Name != "MITx Online" {
				t.Errorf("paid: %+v", it)
			}
		}
		_, free := find(library.Filter{Certificate: "free"})
		for _, it := range free {
			if it.Certificate == nil || (it.Certificate.Kind != "free" && it.Certificate.Kind != "badge") {
				t.Errorf("free: %+v", it.Certificate)
			}
		}
		_, got := find(library.Filter{Level: "advanced", Video: true, Lang: "all"})
		for _, it := range got {
			if it.Level != "advanced" || !it.Video {
				t.Errorf("advanced with video: %s %s %v", it.ID, it.Level, it.Video)
			}
		}
		_, got = find(library.Filter{Reusable: true, Kind: "textbook"})
		for _, it := range got {
			if !slices.Contains([]string{"public-domain", "cc0", "cc-by", "cc-by-sa", "gfdl"}, it.Licence) {
				t.Errorf("reusable: %s is %s", it.ID, it.Licence)
			}
		}
		if _, got := find(library.Filter{Lang: "all", Q: "  Đề thi TỐT nghiệp "}); len(got) != 1 || got[0].ID != "thpt-papers" {
			t.Errorf("an accented search found %v", got)
		}
	})

	t.Run("sorts", func(t *testing.T) {
		_, got := find(library.Filter{Kind: "textbook", Sort: "rating"})
		if _, cheap := find(library.Filter{Sort: "shortest", Certificate: "free"}); cheap[0].Hours == nil || *cheap[0].Hours >= 1 {
			t.Errorf("hours keep two decimals: %v", cheap[0].Hours)
		}
		if got[0].Rating == nil || got[0].Rating.Count < 3 || got[0].Rating.Value < 4.5 {
			t.Errorf("best rated first: %+v", got[0].Rating)
		}
		if len(got[0].Rating.Scores) != 10 {
			t.Errorf("criteria: %v", got[0].Rating.Scores)
		}
		_, got = find(library.Filter{Sort: "popular"})
		for i := 1; i < len(got); i++ {
			if got[i].Popularity == nil || got[i-1].Popularity.Count < got[i].Popularity.Count {
				t.Fatalf("most used: %d then %+v", got[i-1].Popularity.Count, got[i].Popularity)
			}
		}
		_, got = find(library.Filter{Sort: "shortest", Certificate: "any"})
		for i := 1; i < len(got); i++ {
			if got[i].Hours == nil || *got[i-1].Hours > *got[i].Hours {
				t.Fatalf("shortest: %v then %v", *got[i-1].Hours, got[i].Hours)
			}
		}
		_, got = find(library.Filter{Sort: "newest", Kind: "course"})
		if got[0].Year < 2020 {
			t.Errorf("newest course: %d", got[0].Year)
		}
	})

	t.Run("the first screen by field", func(t *testing.T) {
		total, groups, err := svc.Fields(ctx, library.Filter{UI: "en", Q: "ignored", Subject: "law"})
		if err != nil {
			t.Fatal(err)
		}
		if len(groups) != len(library.Subjects) {
			t.Fatalf("%d fields", len(groups))
		}
		sum := 0
		for i, g := range groups {
			sum += g.Total
			if g.Subject != library.Subjects[i] || len(g.Items) != min(library.FieldSample, g.Total) {
				t.Errorf("field %d: %s with %d of %d", i, g.Subject, len(g.Items), g.Total)
			}
			for _, it := range g.Items {
				if it.Subject != g.Subject || it.Language != "en" {
					t.Errorf("%s shows %s (%s, %s)", g.Subject, it.ID, it.Subject, it.Language)
				}
			}
		}
		if sum != total {
			t.Errorf("fields add up to %d of %d", sum, total)
		}
		_, groups, _ = svc.Fields(ctx, library.Filter{UI: "en", Certificate: "paid", Sort: "popular"})
		for _, g := range groups {
			if g.Items[0].Certificate == nil || g.Items[0].Popularity == nil {
				t.Errorf("%s's first paid-certificate course: %+v", g.Subject, g.Items[0])
			}
		}
	})

	t.Run("one item, and what is not there", func(t *testing.T) {
		it, err := svc.Item(ctx, "deck:ultimate-geography-en")
		if err != nil {
			t.Fatal(err)
		}
		var action map[string]any
		if json.Unmarshal(it.Action, &action) != nil || action["type"] != "deck" || it.Count == 0 {
			t.Errorf("deck: %+v %s", it, it.Action)
		}
		if _, err := svc.Item(ctx, "nope"); !errors.Is(err, library.ErrNotFound) {
			t.Errorf("an unknown id: %v", err)
		}
		if _, _, err := svc.Find(ctx, library.Filter{Sort: "random"}); !errors.Is(err, library.ErrBadFilter) {
			t.Errorf("an unknown sort: %v", err)
		}
		langs, err := svc.Languages(ctx)
		if err != nil || langs[0] != "en" || !slices.Contains(langs, "vi") {
			t.Errorf("languages: %v %v", langs, err)
		}
	})
}
