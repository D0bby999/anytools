// Package kbindex names a knowledge base's partial vector index and sweeps the
// ones whose knowledge base is gone.
//
// It has no dependencies so that the store (which makes the indexes), the
// account deletion (which removes knowledge bases by cascade) and the test
// database (which deletes users after every test) share one definition.
package kbindex

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Prefix starts every per-KB index name; the rest is the KB id in hex.
const Prefix = "chunks_emb_hnsw_kb_"

// Name is a knowledge base's partial HNSW index. A uuid's canonical rendering
// is hex and hyphens, so the name cannot carry anything but hex.
func Name(kbID uuid.UUID) string {
	return Prefix + strings.ReplaceAll(kbID.String(), "-", "")
}

// dropOrphans drops every per-KB index on chunks whose knowledge base no
// longer exists. A KB row is committed before its index is built
// (pg.KnowledgeStore.CreateKB), so a visible index without a visible row is
// one whose KB was deleted, never one being made.
const dropOrphans = `
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_index x
      JOIN pg_class c ON c.oid = x.indexrelid
     WHERE x.indrelid = 'chunks'::regclass
       AND c.relname ~ '^` + Prefix + `[0-9a-f]{32}$'
       AND NOT EXISTS (SELECT 1 FROM knowledge_bases k
                        WHERE k.id = substr(c.relname, length('` + Prefix + `') + 1)::uuid)
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', r.relname);
  END LOOP;
END $$`

// DropOrphans removes the indexes a cascade left behind. A knowledge base
// deleted on its own drops its index (pg.KnowledgeStore.DeleteKB); one deleted
// with its account goes by ON DELETE CASCADE, which cannot drop an index, and
// every orphan is one more index each delete reaching chunks must lock, until
// Postgres runs out of lock slots.
func DropOrphans(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, dropOrphans)
	return err
}
