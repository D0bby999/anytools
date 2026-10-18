import { describe, expect, it } from 'vitest';
import { inferSchema } from './schema-inference';

describe('inferSchema — primitives', () => {
  it('infers string, integer, number, boolean, null', () => {
    expect(inferSchema('hi')).toEqual({ type: 'string' });
    expect(inferSchema(42)).toEqual({ type: 'integer' });
    expect(inferSchema(3.14)).toEqual({ type: 'number' });
    expect(inferSchema(true)).toEqual({ type: 'boolean' });
    expect(inferSchema(null)).toEqual({ type: 'null' });
  });
});

describe('inferSchema — objects', () => {
  it('infers properties and marks every present key required', () => {
    expect(inferSchema({ name: 'Ada', age: 30 })).toEqual({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'integer' } },
      required: ['name', 'age'],
    });
  });

  it('infers nested objects', () => {
    const schema = inferSchema({ user: { address: { zip: '12345' } } });
    expect(schema).toEqual({
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            address: {
              type: 'object',
              properties: { zip: { type: 'string' } },
              required: ['zip'],
            },
          },
          required: ['address'],
        },
      },
      required: ['user'],
    });
  });
});

describe('inferSchema — arrays', () => {
  it('infers items from a homogeneous array', () => {
    expect(inferSchema([1, 2, 3])).toEqual({ type: 'array', items: { type: 'integer' } });
  });

  it('gives an empty items schema for an empty array', () => {
    expect(inferSchema([])).toEqual({ type: 'array', items: {} });
  });

  it('merges an array of similar objects: union of properties, intersection of required', () => {
    const schema = inferSchema([
      { id: 1, name: 'a' },
      { id: 2, name: 'b', extra: true },
    ]);
    expect(schema).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          extra: { type: 'boolean' },
        },
        required: ['id', 'name'],
      },
    });
  });

  it('collapses mismatched primitive types into a type array', () => {
    const schema = inferSchema([1, 'two', 3]);
    expect(schema).toEqual({ type: 'array', items: { type: ['integer', 'string'] } });
  });
});
