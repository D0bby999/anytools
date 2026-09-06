// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ToolError } from '../shared/tool-error';
import { validateAgainstSchema } from './logic';

const PERSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'integer', minimum: 0 },
  },
  required: ['name', 'age'],
});

describe('validateAgainstSchema — draft-07', () => {
  it('reports valid for matching data', async () => {
    const result = await validateAgainstSchema(
      PERSON_SCHEMA,
      JSON.stringify({ name: 'Ada', age: 30 }),
      'draft-07',
    );
    expect(result.valid).toBe(true);
  });

  it('reports the instance path, message and params of each mismatch', async () => {
    const result = await validateAgainstSchema(
      PERSON_SCHEMA,
      JSON.stringify({ name: 'Ada', age: -5 }),
      'draft-07',
    );
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.instancePath).toBe('/age');
    expect(result.errors[0]!.message).toMatch(/>= 0/);
    expect(result.errors[0]!.params).toMatchObject({ limit: 0 });
  });

  it('reports one error per missing required field', async () => {
    const result = await validateAgainstSchema(PERSON_SCHEMA, '{}', 'draft-07');
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e) => e.params.missingProperty)).toEqual(
      expect.arrayContaining(['name', 'age']),
    );
  });

  it('reports nested instance paths', async () => {
    const schema = JSON.stringify({
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: { address: { type: 'object', properties: { zip: { type: 'string' } } } },
        },
      },
    });
    const result = await validateAgainstSchema(
      schema,
      JSON.stringify({ user: { address: { zip: 12345 } } }),
      'draft-07',
    );
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.errors[0]!.instancePath).toBe('/user/address/zip');
  });
});

describe('validateAgainstSchema — 2020-12', () => {
  it('validates using a 2020-12-only keyword (prefixItems)', async () => {
    const schema = JSON.stringify({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
    });
    const ok = await validateAgainstSchema(schema, JSON.stringify(['x', 1]), '2020-12');
    expect(ok.valid).toBe(true);
    const bad = await validateAgainstSchema(schema, JSON.stringify([1, 'x']), '2020-12');
    expect(bad.valid).toBe(false);
  });
});

describe('validateAgainstSchema — malformed input', () => {
  it('throws a ToolError for invalid schema JSON', async () => {
    await expect(validateAgainstSchema('{not json', '{}', 'draft-07')).rejects.toThrow(ToolError);
    await expect(validateAgainstSchema('{not json', '{}', 'draft-07')).rejects.toMatchObject({
      code: 'invalidSchemaJson',
    });
  });

  it('throws a ToolError for invalid data JSON', async () => {
    await expect(validateAgainstSchema('{}', '{not json', 'draft-07')).rejects.toMatchObject({
      code: 'invalidDataJson',
    });
  });

  it('throws a ToolError when the schema itself does not compile', async () => {
    const brokenSchema = JSON.stringify({ $ref: '#/does/not/exist' });
    await expect(validateAgainstSchema(brokenSchema, '{}', 'draft-07')).rejects.toMatchObject({
      code: 'schemaCompileError',
    });
  });
});
