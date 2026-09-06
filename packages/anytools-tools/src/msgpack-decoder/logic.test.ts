// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ToolError } from '../shared/tool-error';
import { decodeMsgpack, encodeMsgpack } from './logic';

describe('encodeMsgpack / decodeMsgpack — round trip', () => {
  it('round-trips a nested object through MessagePack and back to the same JSON shape', async () => {
    const input = JSON.stringify({
      name: 'Ada',
      tags: ['engineer', 'mathematician'],
      active: true,
      score: 3.5,
      meta: { nested: { deep: [1, 2, 3] } },
      nothing: null,
    });
    const encoded = await encodeMsgpack(input);
    const decoded = await decodeMsgpack(encoded.bytes);
    expect(JSON.parse(decoded.json)).toEqual(JSON.parse(input));
  });

  it('MessagePack encoding is smaller than the JSON text for typical data', async () => {
    const input = JSON.stringify({ id: 1, name: 'Ada Lovelace', active: true });
    const encoded = await encodeMsgpack(input);
    expect(encoded.outputBytes).toBeLessThan(encoded.inputBytes);
  });

  it('reports matching byte counts on both sides of the round trip', async () => {
    const input = JSON.stringify({ a: 1 });
    const encoded = await encodeMsgpack(input);
    expect(encoded.outputBytes).toBe(encoded.bytes.length);
    const decoded = await decodeMsgpack(encoded.bytes);
    expect(decoded.inputBytes).toBe(encoded.bytes.length);
  });
});

describe('decodeMsgpack — timestamp extension', () => {
  it('decodes a timestamp ext (type -1) to a human-readable date in the JSON output', async () => {
    // @msgpack/msgpack maps JS Date <-> the timestamp extension automatically; there is no
    // JSON equivalent to encode from, so this constructs the Date on the encode side directly.
    const { encode } = await import('@msgpack/msgpack');
    const bytes = encode({ createdAt: new Date('2026-01-15T10:30:00.000Z') });
    const decoded = await decodeMsgpack(bytes);
    expect(decoded.json).toContain('2026-01-15T10:30:00.000Z');
  });
});

describe('decodeMsgpack — malformed input', () => {
  it('throws a ToolError for an empty payload', async () => {
    await expect(decodeMsgpack(new Uint8Array())).rejects.toMatchObject({ code: 'emptyPayload' });
  });

  it('throws a ToolError, not a raw crash, for a truncated payload', async () => {
    // 0x91 = fixarray of length 1, with no element bytes following.
    await expect(decodeMsgpack(new Uint8Array([0x91]))).rejects.toMatchObject({
      code: 'decodeFailed',
    });
  });

  it('throws a ToolError for a payload with trailing garbage type bytes', async () => {
    // 0xc1 is a reserved/never-used type byte in the MessagePack spec.
    await expect(decodeMsgpack(new Uint8Array([0xc1]))).rejects.toThrow(ToolError);
  });
});

describe('encodeMsgpack — malformed input', () => {
  it('throws a ToolError for invalid JSON', async () => {
    await expect(encodeMsgpack('{not json')).rejects.toMatchObject({ code: 'invalidJson' });
  });
});
