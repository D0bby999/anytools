package pg

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/D0bby999/anytools/internal/library"
)

// library.go — the Library's catalogue (the private design notes).
// The same for every learner: no user id anywhere.

// LibraryStore implements library.Store.
type LibraryStore struct{ pool *Pool }

// NewLibraryStore returns a LibraryStore.
func NewLibraryStore(pool *Pool) *LibraryStore { return &LibraryStore{pool: pool} }

var _ library.Store = (*LibraryStore)(nil)

// loadedCatalogue reads the loaded version and sequence through q.
func loadedCatalogue(ctx context.Context, q pgx.Row) (string, int, error) {
	var v string
	var seq int
	err := q.Scan(&v, &seq)
	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return "", 0, nil
	case errors.As(err, &pgErr) && pgErr.Code == "42P01":
		// The tables are not there yet: `serve` ran before `migrate up`.
		return "", 0, nil
	}
	return v, seq, err
}

// LoadedCatalogue is the loaded version and sequence, "" and 0 before the first load.
func (s *LibraryStore) LoadedCatalogue(ctx context.Context) (string, int, error) {
	return loadedCatalogue(ctx, s.pool.QueryRow(ctx, `SELECT version, sequence FROM library_catalogue`))
}

// ReplaceCatalogue swaps the whole catalogue in one transaction, so a reader
// sees the old one or the new one. Under the advisory lock it looks again at
// what is loaded: two servers starting together load it once, and without
// force an older export never replaces a later one.
func (s *LibraryStore) ReplaceCatalogue(ctx context.Context, c *library.Catalogue, force bool) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('library-catalogue', 0))`); err != nil {
		return false, err
	}
	if !force {
		have, seq, err := loadedCatalogue(ctx, tx.QueryRow(ctx, `SELECT version, sequence FROM library_catalogue`))
		if err != nil {
			return false, err
		}
		if have == c.Version || seq > c.Sequence {
			return false, nil
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM library_item_scores; DELETE FROM library_items; DELETE FROM library_sources`); err != nil {
		return false, err
	}

	counts := map[string]int{}
	for _, it := range c.Items {
		counts[it.Source.Name]++
	}
	sources := make([][]any, 0, len(c.Sources))
	for _, src := range c.Sources {
		sources = append(sources, []any{src.Name, src.URL, src.Licence, src.Pin, src.Read, counts[src.Name]})
	}
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{"library_sources"},
		[]string{"name", "url", "licence", "pin", "read", "items"}, pgx.CopyFromRows(sources)); err != nil {
		return false, fmt.Errorf("library sources: %w", err)
	}

	items := make([][]any, 0, len(c.Items))
	var scores [][]any
	for _, it := range c.Items {
		var size *int
		if it.Count > 0 {
			size = &it.Count
		}
		var year *int16
		if it.Year > 0 {
			y := int16(it.Year)
			year = &y
		}
		cert, certName, certCurrency := "", "", ""
		var certMin, certMax *float64
		if it.Certificate != nil {
			cert, certName, certCurrency = it.Certificate.Kind, it.Certificate.Name, it.Certificate.Currency
			certMin, certMax = it.Certificate.PriceMin, it.Certificate.PriceMax
		}
		var rating *float64
		ratingCount := 0
		if it.Rating != nil {
			rating, ratingCount = &it.Rating.Value, it.Rating.Count
			for criterion, score := range it.Rating.Scores {
				scores = append(scores, []any{it.ID, criterion, score})
			}
		}
		var popularity *int64
		popularityKind := ""
		if it.Popularity != nil {
			popularity, popularityKind = &it.Popularity.Count, it.Popularity.Kind
		}
		accessibility := it.Accessibility
		if accessibility == nil {
			accessibility = []string{}
		}
		items = append(items, []any{
			it.ID, it.Position, it.Source.Name, it.Kind, it.Subject, it.Language, it.Teaches, int16(it.LanguageRank()),
			it.Name, it.NameKey, it.About, it.AboutKey, it.Section, it.Author, it.URL, it.Licence, it.Reusable,
			it.Credit, it.CreditText, size, it.Unit, it.Video, it.Level, it.Hours, year,
			cert, certName, certMin, certMax, certCurrency, rating, ratingCount, popularity, popularityKind,
			accessibility, string(it.Action), it.Search,
		})
	}
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{"library_items"}, []string{
		"id", "position", "source", "kind", "subject", "language", "teaches", "language_rank",
		"name", "name_key", "about", "about_key", "section", "author", "url", "licence", "reusable",
		"credit", "credit_text", "size", "unit", "video", "level", "hours", "year",
		"certificate", "certificate_name", "certificate_min", "certificate_max", "certificate_currency", "rating", "rating_count", "popularity", "popularity_kind",
		"accessibility", "action", "search",
	}, pgx.CopyFromRows(items)); err != nil {
		return false, fmt.Errorf("library items: %w", err)
	}
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{"library_item_scores"},
		[]string{"item", "criterion", "score"}, pgx.CopyFromRows(scores)); err != nil {
		return false, fmt.Errorf("library scores: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO library_catalogue (id, version, sequence, items) VALUES (TRUE, $1, $2, $3)
		ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, sequence = EXCLUDED.sequence,
			items = EXCLUDED.items, imported_at = now()`,
		c.Version, c.Sequence, len(c.Items)); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}

// libraryWhere is a filter as SQL over library_items aliased "i".
func libraryWhere(f library.Filter) (string, []any) {
	var conds []string
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if f.Kind != "" {
		conds = append(conds, "i.kind = "+arg(f.Kind))
	}
	if f.Subject != "" {
		conds = append(conds, "i.subject = "+arg(f.Subject))
	}
	if f.Teaches != "" {
		conds = append(conds, "i.teaches = "+arg(f.Teaches))
	}
	if langs := f.Languages(); langs != nil {
		conds = append(conds, "(i.language = 'mul' OR split_part(i.language, '-', 1) = ANY("+arg(langs)+"))")
	}
	for _, w := range f.Words() {
		conds = append(conds, "strpos(i.search, "+arg(w)+") > 0")
	}
	if f.Level != "" {
		conds = append(conds, "i.level = "+arg(f.Level))
	}
	switch f.Certificate {
	case "any":
		conds = append(conds, "i.certificate <> ''")
	case "free":
		conds = append(conds, "i.certificate IN ('free', 'badge')")
	case "paid":
		conds = append(conds, "i.certificate = 'paid'")
	}
	if f.Video {
		conds = append(conds, "i.video")
	}
	if f.Reusable {
		conds = append(conds, "i.reusable")
	}
	if len(conds) == 0 {
		return "TRUE", args
	}
	return strings.Join(conds, " AND "), args
}

// libraryOrder is a sort over a row set aliased "k" that has library_items'
// columns and "turn", after English-first. Featured lets the sources take
// turns (one of each, then the second of each), each in its catalogue
// order, so one source's thousands of links do not fill a page. Best rated
// weighs a rating by its reviews: (rating × n + 4 × 3) / (n + 3), so one
// five-star review does not outrank twenty at 4.8.
func libraryOrder(sort string) string {
	switch sort {
	case "rating":
		return "(k.rating * k.rating_count + 12) / (k.rating_count + 3) DESC NULLS LAST, k.rating_count DESC, k.position"
	case "popular":
		return "k.popularity DESC NULLS LAST, k.position"
	case "shortest":
		return "k.hours ASC NULLS LAST, k.position"
	case "newest":
		return "k.year DESC NULLS LAST, k.position"
	}
	return "k.turn, k.position"
}

const libraryColumns = `i.id, i.kind, i.subject, i.language, i.teaches, i.name, i.name_key, i.about, i.about_key, i.section, i.author,
	i.size, i.unit, i.video, i.level, i.hours, i.year, i.certificate, i.certificate_name, i.certificate_min,
	i.certificate_max, i.certificate_currency, i.rating, i.rating_count, i.popularity, i.popularity_kind,
	i.accessibility, i.licence, i.source, src.url, i.credit, i.credit_text, i.url, i.action`

func scanLibraryItem(row pgx.Row, extra ...any) (*library.Item, error) {
	var it library.Item
	var size *int
	var year *int16
	var cert, certName, certCurrency, popularityKind string
	var certMin, certMax, rating *float64
	var ratingCount int
	var popularity *int64
	var action []byte
	dest := append(extra, &it.ID, &it.Kind, &it.Subject, &it.Language, &it.Teaches, &it.Name, &it.NameKey, &it.About, &it.AboutKey,
		&it.Section, &it.Author, &size, &it.Unit, &it.Video, &it.Level, &it.Hours, &year, &cert, &certName, &certMin,
		&certMax, &certCurrency, &rating, &ratingCount, &popularity, &popularityKind, &it.Accessibility, &it.Licence,
		&it.Source.Name, &it.Source.URL, &it.Credit, &it.CreditText, &it.URL, &action)
	if err := row.Scan(dest...); err != nil {
		return nil, err
	}
	if size != nil {
		it.Count = *size
	}
	if year != nil {
		it.Year = int(*year)
	}
	if cert != "" {
		it.Certificate = &library.Certificate{Kind: cert, Name: certName, PriceMin: certMin, PriceMax: certMax, Currency: certCurrency}
	}
	if rating != nil {
		it.Rating = &library.Rating{Value: *rating, Count: ratingCount}
	}
	if popularity != nil {
		it.Popularity = &library.Popularity{Count: *popularity, Kind: popularityKind}
	}
	if len(it.Accessibility) == 0 {
		it.Accessibility = nil
	}
	it.Action = action
	return &it, nil
}

// libraryQuerier is the pool or a transaction.
type libraryQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// snapshot runs fn in one read-only transaction, so a page, its total and
// its scores come from the same catalogue even while a new one is loaded.
func (s *LibraryStore) snapshot(ctx context.Context, fn func(q libraryQuerier) error) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// withScores fills each rated item's criteria.
func withScores(ctx context.Context, q libraryQuerier, items []*library.Item) error {
	var ids []string
	byID := map[string]*library.Item{}
	for _, it := range items {
		if it.Rating != nil {
			ids = append(ids, it.ID)
			byID[it.ID] = it
		}
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := q.Query(ctx, `SELECT item, criterion, score FROM library_item_scores WHERE item = ANY($1)`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, criterion string
		var score float64
		if err := rows.Scan(&id, &criterion, &score); err != nil {
			return err
		}
		r := byID[id].Rating
		if r.Scores == nil {
			r.Scores = map[string]float64{}
		}
		r.Scores[criterion] = score
	}
	return rows.Err()
}

func deref(items []*library.Item) []library.Item {
	out := make([]library.Item, len(items))
	for i, it := range items {
		out[i] = *it
	}
	return out
}

// FindItems is one page of the items a filter keeps and how many there are.
func (s *LibraryStore) FindItems(ctx context.Context, f library.Filter, limit int) (int, []library.Item, error) {
	var total int
	var items []*library.Item
	err := s.snapshot(ctx, func(q libraryQuerier) (err error) {
		total, items, err = findItems(ctx, q, f, limit)
		return err
	})
	if err != nil {
		return 0, nil, err
	}
	return total, deref(items), nil
}

func findItems(ctx context.Context, q libraryQuerier, f library.Filter, limit int) (int, []*library.Item, error) {
	where, args := libraryWhere(f)
	var total int
	if err := q.QueryRow(ctx, `SELECT count(*) FROM library_items i WHERE `+where, args...).Scan(&total); err != nil {
		return 0, nil, err
	}
	n := len(args)
	rows, err := q.Query(ctx, fmt.Sprintf(`
		WITH k AS (
			SELECT i.*, row_number() OVER (PARTITION BY i.language_rank, i.source ORDER BY i.position) AS turn
			FROM library_items i WHERE %s
		)
		SELECT %s FROM k i JOIN library_sources src ON src.name = i.source
		ORDER BY i.language_rank, %s LIMIT $%d OFFSET $%d`,
		where, libraryColumns, strings.ReplaceAll(libraryOrder(f.Sort), "k.", "i."), n+1, n+2),
		append(args, limit, f.Offset)...)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	var items []*library.Item
	for rows.Next() {
		it, err := scanLibraryItem(rows)
		if err != nil {
			return 0, nil, err
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return 0, nil, err
	}
	return total, items, withScores(ctx, q, items)
}

// FieldSamples is the first screen: each field that has something, in
// library.Subjects' order, with its first items in the filter's sort and
// how many it has.
func (s *LibraryStore) FieldSamples(ctx context.Context, f library.Filter, per int) (int, []library.FieldGroup, error) {
	var total int
	var groups []library.FieldGroup
	err := s.snapshot(ctx, func(q libraryQuerier) (err error) {
		total, groups, err = fieldSamples(ctx, q, f, per)
		return err
	})
	return total, groups, err
}

func fieldSamples(ctx context.Context, q libraryQuerier, f library.Filter, per int) (int, []library.FieldGroup, error) {
	where, args := libraryWhere(f)
	n := len(args)
	rows, err := q.Query(ctx, fmt.Sprintf(`
		WITH k AS (
			SELECT i.*, row_number() OVER (PARTITION BY i.subject, i.language_rank, i.source ORDER BY i.position) AS turn
			FROM library_items i WHERE %s
		), ranked AS (
			SELECT k.id, k.subject,
				row_number() OVER (PARTITION BY k.subject ORDER BY k.language_rank, %s) AS n,
				count(*) OVER (PARTITION BY k.subject) AS total
			FROM k
		)
		SELECT r.total, %s FROM ranked r
		JOIN library_items i ON i.id = r.id JOIN library_sources src ON src.name = i.source
		WHERE r.n <= $%d ORDER BY array_position($%d::text[], r.subject), r.n`,
		where, libraryOrder(f.Sort), libraryColumns, n+1, n+2),
		append(args, per, library.Subjects)...)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	var groups []library.FieldGroup
	var all []*library.Item
	var groupOf []int
	total := 0
	for rows.Next() {
		var fieldTotal int
		it, err := scanLibraryItem(rows, &fieldTotal)
		if err != nil {
			return 0, nil, err
		}
		if len(groups) == 0 || groups[len(groups)-1].Subject != it.Subject {
			groups = append(groups, library.FieldGroup{Subject: it.Subject, Total: fieldTotal})
			total += fieldTotal
		}
		all = append(all, it)
		groupOf = append(groupOf, len(groups)-1)
	}
	if err := rows.Err(); err != nil {
		return 0, nil, err
	}
	if err := withScores(ctx, q, all); err != nil {
		return 0, nil, err
	}
	for i, it := range all {
		groups[groupOf[i]].Items = append(groups[groupOf[i]].Items, *it)
	}
	return total, groups, nil
}

// LibraryItem is one item by id.
func (s *LibraryStore) LibraryItem(ctx context.Context, id string) (*library.Item, error) {
	it, err := scanLibraryItem(s.pool.QueryRow(ctx, `SELECT `+libraryColumns+`
		FROM library_items i JOIN library_sources src ON src.name = i.source WHERE i.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, library.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := withScores(ctx, s.pool, []*library.Item{it}); err != nil {
		return nil, err
	}
	return it, nil
}

// CatalogueLanguages are the languages items are in, "mul" left out.
func (s *LibraryStore) CatalogueLanguages(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT DISTINCT split_part(language, '-', 1) FROM library_items WHERE language <> 'mul'`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}
