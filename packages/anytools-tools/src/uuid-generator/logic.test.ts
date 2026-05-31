import { describe, expect, it } from 'vitest';
import { formatUuid, generateUuid, inspectUuid } from './logic';

const V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const V1_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('generateUuid', () => {
  it('generates v4 by version flag', () => {
    const [id] = generateUuid('v4', 1);
    expect(id).toMatch(V4_RE);
  });
  it('generates v7 (default)', () => {
    const [id] = generateUuid('v7', 1);
    expect(id).toMatch(V7_RE);
  });
  it('generates v1', () => {
    const [id] = generateUuid('v1', 1);
    expect(id).toMatch(V1_RE);
  });
  it('generates bulk', () => {
    const ids = generateUuid('v4', 10);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10); // all unique
  });
  it('v7 values are sortable by time', () => {
    const a = generateUuid('v7', 1)[0]!;
    const b = generateUuid('v7', 1)[0]!;
    // v7 has time prefix, so b should sort >= a lexicographically when generated later
    expect(b >= a).toBe(true);
  });
});

describe('formatUuid', () => {
  it('uppercases', () => {
    expect(formatUuid('abc-DEF', { uppercase: true })).toBe('ABC-DEF');
  });
  it('strips dashes', () => {
    expect(formatUuid('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { dashes: false })).toBe(
      'aaaaaaaabbbbccccddddeeeeeeeeeeee',
    );
  });
});

describe('inspectUuid', () => {
  it('detects v4', () => {
    const id = generateUuid('v4', 1)[0]!;
    const out = inspectUuid(id);
    expect(out.valid).toBe(true);
    expect(out.version).toBe(4);
  });
  it('detects v7', () => {
    const id = generateUuid('v7', 1)[0]!;
    expect(inspectUuid(id).version).toBe(7);
  });
  it('rejects garbage', () => {
    expect(inspectUuid('not-a-uuid').valid).toBe(false);
  });
});
