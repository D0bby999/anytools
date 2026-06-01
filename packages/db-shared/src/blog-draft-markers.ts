/**
 * Shared draft-marker detection for blog MDX content.
 *
 * Used by the publish-check gate, the DB sync, and the direct-publish script
 * to ensure ONE implementation of blocker logic across all paths.
 *
 * A blog row MUST NOT be published while any of these markers remain in its MDX.
 * They indicate unverified hands-on claims, unconfirmed ASINs, or placeholder copy
 * that would expose readers to inaccurate affiliate content.
 */

export type DraftMarker = {
  id: string;
  label: string;
  line: number;
  text: string;
};

export type DraftCheckResult = {
  draft: boolean;
  markers: DraftMarker[];
  counts: Record<string, number>;
};

type Blocker = {
  id: string;
  label: string;
  test: (line: string) => boolean;
};

// Each rule is matched per line. One match per line is enough to block.
const BLOCKERS: Blocker[] = [
  {
    id: 'hands-on',
    label: 'TODO (hands-on) — unverified hands-on claim',
    test: (line) => line.includes('TODO (hands-on)'),
  },
  {
    id: 'verify-asin',
    label: 'unverified ASIN marker (# ... verify)',
    // ASIN frontmatter comments still to confirm, e.g.:
    //   - B083T58PKM  # Learning Resources Botley 2.0 — verify
    test: (line) => /#[^#]*\bverify\b/i.test(line),
  },
  {
    id: 'todo-hero',
    label: 'TODO: hero/image placeholder (heroImage not filled)',
    test: (line) => /#\s*TODO:/i.test(line) || /:\s*#\s*TODO\b/i.test(line),
  },
  {
    id: 'todo-generic',
    label: 'TODO: draft placeholder',
    // Generic `TODO:` not already caught above (e.g. inline "TODO: fill the table").
    test: (line) =>
      /\bTODO:/.test(line) && !/#\s*TODO:/i.test(line) && !/:\s*#\s*TODO\b/i.test(line),
  },
];

/**
 * Check a raw MDX string for draft markers.
 *
 * Returns `draft: true` if any blocker is found, along with the list of
 * matched markers (id, label, 1-based line number, trimmed line text).
 */
export function isDraftMdx(raw: string): DraftCheckResult {
  const lines = raw.split('\n');
  const markers: DraftMarker[] = [];
  const counts: Record<string, number> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    for (const b of BLOCKERS) {
      if (b.test(line)) {
        markers.push({ id: b.id, label: b.label, line: i + 1, text: line.trim() });
        counts[b.id] = (counts[b.id] ?? 0) + 1;
        break; // one marker per line is enough
      }
    }
  }

  return { draft: markers.length > 0, markers, counts };
}
