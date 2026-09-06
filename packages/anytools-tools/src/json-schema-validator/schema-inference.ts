/**
 * Guess a JSON Schema from one example value — the direction people actually search for more
 * than "validate my JSON" (see phase spec). One sample cannot know which fields are truly
 * optional or what a number's real range is; this answers "does this look like my data?", not
 * "what is allowed here?". The FAQ says so.
 *
 * Draft-07-shaped output (plain `type`/`properties`/`required`/`items`/`anyOf`), which also
 * validates fine under 2020-12 — nothing here uses a 2020-12-only keyword.
 */

export type InferredSchema = Record<string, unknown>;

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'string' | 'number' | 'boolean' | 'object'
}

export function inferSchema(value: unknown): InferredSchema {
  const t = jsonType(value);
  if (t === 'object') return inferObject(value as Record<string, unknown>);
  if (t === 'array') return inferArray(value as unknown[]);
  if (t === 'null') return { type: 'null' };
  if (t === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  return { type: t }; // 'string' | 'boolean'
}

function inferObject(obj: Record<string, unknown>): InferredSchema {
  const properties: Record<string, InferredSchema> = {};
  const required: string[] = [];
  for (const key of Object.keys(obj)) {
    properties[key] = inferSchema(obj[key]);
    required.push(key);
  }
  return { type: 'object', properties, required };
}

function inferArray(arr: unknown[]): InferredSchema {
  if (arr.length === 0) return { type: 'array', items: {} };
  return { type: 'array', items: mergeAll(arr.map(inferSchema)) };
}

/** Combine every element's inferred schema into one shape the whole array satisfies. */
function mergeAll(schemas: InferredSchema[]): InferredSchema {
  return schemas.reduce((acc, s) => mergeTwo(acc, s));
}

function mergeTwo(a: InferredSchema, b: InferredSchema): InferredSchema {
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  if (a.type === 'object' && b.type === 'object') return mergeObjects(a, b);
  const types = new Set(
    [...toTypeArray(a.type), ...toTypeArray(b.type)].filter((t) => t !== undefined),
  );
  return { type: types.size === 1 ? [...types][0] : [...types] };
}

function toTypeArray(t: unknown): string[] {
  return Array.isArray(t) ? (t as string[]) : t === undefined ? [] : [t as string];
}

/**
 * Union of properties from both shapes; a key is only `required` if every sampled object
 * that reached here actually had it, so an occasionally-missing field is correctly optional.
 */
function mergeObjects(a: InferredSchema, b: InferredSchema): InferredSchema {
  const aProps = (a.properties ?? {}) as Record<string, InferredSchema>;
  const bProps = (b.properties ?? {}) as Record<string, InferredSchema>;
  const properties: Record<string, InferredSchema> = { ...aProps };
  for (const [key, schema] of Object.entries(bProps)) {
    const existing = aProps[key];
    properties[key] = existing === undefined ? schema : mergeTwo(existing, schema);
  }
  const aRequired = new Set((a.required as string[] | undefined) ?? []);
  const bRequired = new Set((b.required as string[] | undefined) ?? []);
  const required = [...aRequired].filter((k) => bRequired.has(k));
  return { type: 'object', properties, required };
}
