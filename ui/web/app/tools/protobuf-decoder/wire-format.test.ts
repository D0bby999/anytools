import { describe, expect, it } from 'vitest';
import { ToolError } from '../shared/tool-error';
import { MAX_DEPTH, decodeWireFormat } from './wire-format';

function label(guesses: { label: string; value: string }[], label_: string): string | undefined {
  return guesses.find((g) => g.label === label_)?.value;
}

describe('decodeWireFormat — the three known wire types', () => {
  it('decodes a varint field (protobuf.dev worked example: field 1 = 150)', () => {
    const fields = decodeWireFormat(new Uint8Array([0x08, 0x96, 0x01]));
    expect(fields).toHaveLength(1);
    expect(fields[0]!.fieldNumber).toBe(1);
    expect(fields[0]!.wireType).toBe(0);
    expect(label(fields[0]!.guesses, 'uint64')).toBe('150');
  });

  it('decodes a length-delimited string field (protobuf.dev worked example: field 2 = "testing")', () => {
    const bytes = new TextEncoder().encode('testing');
    const payload = new Uint8Array([0x12, bytes.length, ...bytes]);
    const fields = decodeWireFormat(payload);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.fieldNumber).toBe(2);
    expect(fields[0]!.wireType).toBe(2);
    expect(label(fields[0]!.guesses, 'string (UTF-8)')).toBe('testing');
  });

  it('decodes a fixed64 field (double)', () => {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, 1.5, true);
    const payload = new Uint8Array([(3 << 3) | 1, ...new Uint8Array(buf)]);
    const fields = decodeWireFormat(payload);
    expect(fields[0]!.fieldNumber).toBe(3);
    expect(fields[0]!.wireType).toBe(1);
    expect(label(fields[0]!.guesses, 'double')).toBe('1.5');
  });

  it('decodes a fixed32 field (float)', () => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, 2.5, true);
    const payload = new Uint8Array([(4 << 3) | 5, ...new Uint8Array(buf)]);
    const fields = decodeWireFormat(payload);
    expect(fields[0]!.fieldNumber).toBe(4);
    expect(fields[0]!.wireType).toBe(5);
    expect(label(fields[0]!.guesses, 'float')).toBe('2.5');
  });

  it('offers a zigzag and a bool guess alongside the raw uint64 for a varint', () => {
    const fields = decodeWireFormat(new Uint8Array([0x08, 0x01])); // field 1 = 1
    expect(label(fields[0]!.guesses, 'bool')).toBe('true');
    expect(label(fields[0]!.guesses, 'sint64 (zigzag)')).toBeDefined();
  });
});

describe('decodeWireFormat — the schema-less ambiguity', () => {
  it('offers both a nested-message guess and a raw-bytes/string guess for the same field', () => {
    // field 5, length-delimited, containing the bytes of "field 1 = 10" (0x08 0x0a) — those two
    // bytes are simultaneously a valid nested varint message AND two valid UTF-8 control chars.
    const payload = new Uint8Array([(5 << 3) | 2, 2, 0x08, 0x0a]);
    const field = decodeWireFormat(payload)[0]!;
    expect(field.nested).toBeDefined();
    expect(field.nested?.[0]).toMatchObject({ fieldNumber: 1 });
    expect(label(field.guesses, 'bytes (hex)')).toBe('08 0a');
    // Both control characters are valid single-byte UTF-8, so a string guess is also offered.
    expect(field.guesses.some((g) => g.label === 'string (UTF-8)')).toBe(true);
  });

  it('stops recursing into nested guesses past MAX_DEPTH without crashing', () => {
    // Build a chain of MAX_DEPTH + 3 messages, each wrapping the next as field 1.
    let inner = new Uint8Array([0x08, 0x2a]); // field 1 = 42
    for (let i = 0; i < MAX_DEPTH + 3; i++) {
      inner = new Uint8Array([0x0a, inner.length, ...inner]); // field 1, wire type 2
    }
    const fields = decodeWireFormat(inner);
    expect(fields).toHaveLength(1);
    let depth = 0;
    let cursor = fields[0]!;
    while (cursor.nested?.[0]) {
      cursor = cursor.nested[0];
      depth++;
    }
    expect(depth).toBeLessThanOrEqual(MAX_DEPTH);
    // The un-recursed tail is still readable as raw bytes — nothing is silently dropped.
    expect(cursor.bytesHex.length).toBeGreaterThan(0);
  });
});

describe('decodeWireFormat — malformed input never hangs, always a clear ToolError', () => {
  it('rejects an empty payload', () => {
    expect(() => decodeWireFormat(new Uint8Array())).toThrow(ToolError);
  });

  it('rejects a truncated varint (continuation bit set with nothing after it)', () => {
    expect(() => decodeWireFormat(new Uint8Array([0x08, 0xff]))).toThrow(/does not decode/);
  });

  it('rejects field number 0 (invalid on the wire)', () => {
    expect(() => decodeWireFormat(new Uint8Array([0x00]))).toThrow(/does not decode/);
  });

  it('rejects the deprecated group wire type (3/4)', () => {
    const groupStart = (1 << 3) | 3;
    expect(() => decodeWireFormat(new Uint8Array([groupStart]))).toThrow(/group/);
  });

  it('rejects a length-delimited value whose declared length runs past the payload', () => {
    // field 1, wire type 2, declared length 100, but nothing follows.
    expect(() => decodeWireFormat(new Uint8Array([0x0a, 100]))).toThrow(/does not decode/);
  });

  it('refuses a payload with more fields than the safety budget allows, instead of hanging', () => {
    const oneField = [0x08, 0x01]; // field 1 = 1, two bytes
    const huge = new Uint8Array(100_001 * 2);
    for (let i = 0; i < 100_001; i++) huge.set(oneField, i * 2);
    expect(() => decodeWireFormat(huge)).toThrow(/too many fields/);
  });
});
