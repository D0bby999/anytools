import { type Document, parseAllDocuments, visit } from 'yaml';

export type FormatResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Round-trips through `yaml`'s Document model instead of js-yaml's load/dump, because
 * load/dump keeps only the data: every comment was deleted, anchors and `<<:` merges were
 * resolved away, `2024-01-01` became `2024-01-01T00:00:00.000Z` (YAML 1.1 timestamps), and
 * a stream with `---` separators was refused. For a formatter aimed at config files that
 * is the opposite of formatting. The Document keeps comments, anchors, aliases, document
 * markers and treats dates as strings (YAML 1.2 core schema).
 */
export function formatYaml(input: string, indent: 2 | 4, sortKeys = false): FormatResult<string> {
  const parsed = parseDocuments(input);
  if (!parsed.ok) return parsed;
  const out = parsed.value.map((doc) => {
    if (sortKeys) sortMapKeys(doc);
    return doc.toString({ indent, lineWidth: 100 });
  });
  return { ok: true, value: out.join('') };
}

export function validateYaml(input: string): FormatResult<true> {
  const parsed = parseDocuments(input);
  return parsed.ok ? { ok: true, value: true } : parsed;
}

function parseDocuments(input: string): FormatResult<Document[]> {
  const docs = parseAllDocuments(input);
  for (const doc of docs) {
    const problem = doc.errors[0];
    if (problem) return { ok: false, error: problem.message.trim() };
  }
  return { ok: true, value: docs };
}

/** Sort every mapping by key text. Items carry their own comments, so those move with the key. */
function sortMapKeys(doc: Document): void {
  visit(doc, {
    Map(_key, map) {
      map.items.sort((a, b) => String(a.key).localeCompare(String(b.key)));
    },
  });
}
