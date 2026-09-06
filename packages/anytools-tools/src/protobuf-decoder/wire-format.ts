/**
 * Blind decoder for the Protocol Buffers wire format — no `.proto` needed. Implemented from
 * the public wire-format spec (https://protobuf.dev/programming-guides/encoding/), not copied
 * from any library, so every candidate interpretation is a *guess*: the wire format alone
 * cannot tell a `string` from `bytes` from an embedded message (all three are wire type 2),
 * nor `int32` from `sint32` from `bool` (all three are wire type 0). The FAQ says so.
 *
 * Untrusted input means two failure modes must never happen: an unbounded loop, and a stack
 * that grows with attacker-chosen nesting. `MAX_DEPTH` stops recursion into length-delimited
 * "maybe a submessage" guesses; `MAX_FIELDS` (shared across the whole call, nested guesses
 * included) stops a payload from producing more work than the tab can do in reasonable time;
 * every read checks it has enough bytes left before consuming them.
 */
import { ToolError } from '../shared/tool-error';

export type WireType = 0 | 1 | 2 | 5;

export type Guess = { label: string; value: string };

export type DecodedField = {
  fieldNumber: number;
  wireType: WireType;
  wireTypeName: 'varint' | 'fixed64' | 'length-delimited' | 'fixed32';
  bytesHex: string;
  byteLength: number;
  guesses: Guess[];
  /** Only present when a wireType-2 value's bytes fully parsed as a nested message. */
  nested?: DecodedField[];
};

const MAX_VARINT_BYTES = 10; // enough for a full 64-bit value; a longer run is malformed
export const MAX_DEPTH = 8;
export const MAX_FIELDS = 100_000;
const MAX_FIELD_NUMBER = 536_870_911; // 2^29 - 1, the largest field number the spec allows

class WireParseError extends Error {}

type Cursor = { bytes: Uint8Array; pos: number };

function readVarint(c: Cursor): bigint {
  let result = 0n;
  let shift = 0n;
  for (let i = 0; i < MAX_VARINT_BYTES; i++) {
    if (c.pos >= c.bytes.length) throw new WireParseError('truncated varint');
    // The bounds check just above guarantees this index is in range.
    const byte = c.bytes[c.pos++] as number;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result;
    shift += 7n;
  }
  throw new WireParseError('varint longer than 10 bytes');
}

function readFixed(c: Cursor, n: number): Uint8Array {
  if (c.pos + n > c.bytes.length) throw new WireParseError('truncated fixed-width value');
  const out = c.bytes.subarray(c.pos, c.pos + n);
  c.pos += n;
  return out;
}

const toSigned64 = (u: bigint): bigint => (u >= 1n << 63n ? u - (1n << 64n) : u);
const zigzagDecode = (u: bigint): bigint => (u >> 1n) ^ -(u & 1n);

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');

function tryUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function varintGuesses(value: bigint): Guess[] {
  const guesses: Guess[] = [
    { label: 'uint64', value: value.toString() },
    { label: "int64 (two's complement)", value: toSigned64(value).toString() },
    { label: 'sint64 (zigzag)', value: zigzagDecode(value).toString() },
  ];
  if (value === 0n || value === 1n) {
    guesses.push({ label: 'bool', value: value === 1n ? 'true' : 'false' });
  }
  return guesses;
}

function fixed64Guesses(bytes: Uint8Array): Guess[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [
    { label: 'double', value: String(view.getFloat64(0, true)) },
    { label: 'uint64', value: view.getBigUint64(0, true).toString() },
    { label: 'int64 (sfixed64)', value: view.getBigInt64(0, true).toString() },
  ];
}

function fixed32Guesses(bytes: Uint8Array): Guess[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [
    { label: 'float', value: String(view.getFloat32(0, true)) },
    { label: 'uint32', value: String(view.getUint32(0, true)) },
    { label: 'int32 (sfixed32)', value: String(view.getInt32(0, true)) },
  ];
}

function parseFields(
  bytes: Uint8Array,
  depth: number,
  budget: { remaining: number },
): DecodedField[] {
  const c: Cursor = { bytes, pos: 0 };
  const fields: DecodedField[] = [];
  while (c.pos < c.bytes.length) {
    if (--budget.remaining < 0) throw new WireParseError('too many fields to decode safely');
    const tagStart = c.pos;
    const tag = readVarint(c);
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);
    if (fieldNumber < 1 || fieldNumber > MAX_FIELD_NUMBER) {
      throw new WireParseError(`field number ${fieldNumber} at byte ${tagStart} is out of range`);
    }
    if (wireType === 3 || wireType === 4) {
      throw new WireParseError('the deprecated "group" wire type (3/4) is not supported');
    }
    if (wireType !== 0 && wireType !== 1 && wireType !== 2 && wireType !== 5) {
      throw new WireParseError(`unknown wire type ${wireType} at byte ${tagStart}`);
    }

    if (wireType === 0) {
      const start = c.pos;
      const value = readVarint(c);
      const raw = c.bytes.subarray(start, c.pos);
      fields.push({
        fieldNumber,
        wireType,
        wireTypeName: 'varint',
        bytesHex: hex(raw),
        byteLength: raw.length,
        guesses: varintGuesses(value),
      });
    } else if (wireType === 1 || wireType === 5) {
      const raw = readFixed(c, wireType === 1 ? 8 : 4);
      fields.push({
        fieldNumber,
        wireType,
        wireTypeName: wireType === 1 ? 'fixed64' : 'fixed32',
        bytesHex: hex(raw),
        byteLength: raw.length,
        guesses: wireType === 1 ? fixed64Guesses(raw) : fixed32Guesses(raw),
      });
    } else {
      const len = readVarint(c);
      if (len > BigInt(c.bytes.length - c.pos)) {
        throw new WireParseError('length-delimited value runs past the end of the payload');
      }
      const raw = readFixed(c, Number(len));
      const guesses: Guess[] = [{ label: 'bytes (hex)', value: hex(raw) }];
      const utf8 = tryUtf8(raw);
      if (utf8 !== null) guesses.push({ label: 'string (UTF-8)', value: utf8 });
      let nested: DecodedField[] | undefined;
      if (depth < MAX_DEPTH && raw.length > 0) {
        try {
          const attempt = parseFields(raw, depth + 1, budget);
          if (attempt.length > 0) nested = attempt;
        } catch {
          nested = undefined; // doesn't parse as a message — that's fine, it's a guess
        }
      }
      fields.push({
        fieldNumber,
        wireType,
        wireTypeName: 'length-delimited',
        bytesHex: hex(raw),
        byteLength: raw.length,
        guesses,
        nested,
      });
    }
  }
  return fields;
}

/** Decode a raw payload as bare protobuf wire format, with no schema to name fields or types. */
export function decodeWireFormat(bytes: Uint8Array): DecodedField[] {
  if (bytes.length === 0) {
    throw new ToolError('emptyPayload', 'Paste or upload a payload first.');
  }
  try {
    return parseFields(bytes, 0, { remaining: MAX_FIELDS });
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'malformed payload';
    throw new ToolError(
      'wireFormatDecodeFailed',
      `This does not decode as protobuf wire format: ${detail}.`,
      { detail },
    );
  }
}
