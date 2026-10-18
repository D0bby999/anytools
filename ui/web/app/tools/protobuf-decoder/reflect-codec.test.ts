// @vitest-environment node
/**
 * reflect-codec.ts against protobufjs itself. Node allows the eval protobufjs's generated
 * decoders need, so here both can run on the same bytes: the output must be the same object with
 * its keys in the same order (the tool shows it as JSON), and a payload one refuses the other must
 * refuse with the same message. Payloads are encoded by protobufjs from varied values, then
 * truncated, bit-flipped and extended, plus a few thousand random byte strings. Seeded, so a
 * failure reproduces.
 */
import protobuf from 'protobufjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeWithSchema } from './logic';
import { decodeMessage, messageToObject } from './reflect-codec';

const OPTS = { longs: String, enums: String, bytes: String, defaults: true };

const PROTO3 = `
syntax = "proto3";
package t3;
enum Colour { RED = 0; GREEN = 1; BLUE = 2; }
message Inner { string label = 1; sint64 delta = 2; repeated Colour tints = 3; Inner child = 4; }
message All {
  double d = 1; float f = 2; int32 i32 = 3; int64 i64 = 4; uint32 u32 = 5; uint64 u64 = 6;
  sint32 s32 = 7; sint64 s64 = 8; fixed32 fx32 = 9; fixed64 fx64 = 10; sfixed32 sfx32 = 11;
  sfixed64 sfx64 = 12; bool b = 13; string s = 14; bytes by = 15; Colour colour = 16;
  Inner inner = 17;
  repeated int32 ri32 = 18; repeated string rs = 19; repeated Inner rinner = 20;
  repeated double rd = 21; repeated uint64 ru64 = 22; repeated bool rb = 23; repeated bytes rby = 24;
  map<string, int32> m_si = 25; map<int32, string> m_is = 26; map<int64, string> m_ls = 27;
  map<bool, Inner> m_bi = 28; map<string, Colour> m_sc = 29; map<uint64, bytes> m_ub = 30;
  map<sint32, double> m_sd = 31;
  oneof pick { string p_s = 32; int32 p_i = 33; Inner p_inner = 34; }
  optional int32 opt = 35;
  repeated int32 unpacked = 36 [packed = false];
}
message Empty {}
`;

const PROTO2 = `
syntax = "proto2";
package t2;
enum Level { LOW = 5; MID = 6; HIGH = 7; }
message Req {
  required int32 id = 1;
  optional string name = 2 [default = "anon"];
  optional int32 count = 3 [default = 42];
  optional Level level = 4 [default = MID];
  optional Level plain_level = 5;
  repeated Level levels = 6;
  repeated Level packed_levels = 7 [packed = true];
  optional bytes blob = 8 [default = "ab"];
  optional float ratio = 9 [default = inf];
  optional double neg = 10 [default = -0.0];
  optional int64 big = 11 [default = -9007199254740993];
  optional group Result = 12 { optional string url = 13; optional int32 rank = 14; }
  repeated group Hit = 15 { optional string q = 16; }
  map<string, Level> named = 17;
  optional Req next = 18;
  optional bool flag = 19 [default = true];
}
`;

/** mulberry32: small, seeded, good enough to scatter bytes. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A string that keeps what toEqual ignores: key order, -0, NaN and the infinities. */
function canon(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === 'number'
      ? Object.is(v, -0)
        ? '§-0'
        : Number.isNaN(v)
          ? '§NaN'
          : v === Infinity
            ? '§Inf'
            : v === -Infinity
              ? '§-Inf'
              : v
      : v,
  );
}

type Outcome = { ok: true; value: string } | { ok: false; error: string };

function attempt(fn: () => unknown): Outcome {
  try {
    return { ok: true, value: canon(fn()) };
  } catch (e) {
    return { ok: false, error: `${(e as Error).name}: ${(e as Error).message}` };
  }
}

/** Each side parses the schema on its own, once. */
const parsed = new Map<string, { refType: protobuf.Type; ourType: protobuf.Type }>();

function compare(proto: string, typeName: string, bytes: Uint8Array) {
  const key = `${proto}\u0000${typeName}`;
  let types = parsed.get(key);
  if (!types) {
    types = {
      refType: protobuf.parse(proto).root.lookupType(typeName),
      ourType: protobuf.parse(proto).root.lookupType(typeName),
    };
    parsed.set(key, types);
  }
  const { refType, ourType } = types;
  const ref = attempt(() => refType.toObject(refType.decode(bytes), OPTS));
  const ours = attempt(() => messageToObject(protobuf, ourType, decodeMessage(protobuf, ourType, bytes)));
  return { ref, ours };
}

function encode(proto: string, typeName: string, value: Record<string, unknown>): Uint8Array {
  const type = protobuf.parse(proto).root.lookupType(typeName);
  return type.encode(type.fromObject(value)).finish();
}

const inner = (n: number) => ({ label: `in-${n}`, delta: String(-n * 1e12), tints: [n % 3, (n + 1) % 3], child: n > 0 ? { label: 'deep' } : undefined });

const PROTO3_VALUES: Record<string, unknown>[] = [
  {},
  {
    d: 1.5, f: -2.25, i32: -7, i64: '-9223372036854775808', u32: 4294967295, u64: '18446744073709551615',
    s32: -2147483648, s64: '9223372036854775807', fx32: 4000000000, fx64: '1234567890123456789', sfx32: -5,
    sfx64: '-1', b: true, s: 'Xin chào 🌏', by: 'AAEC/w==', colour: 'BLUE', inner: inner(1),
    ri32: [1, -1, 300, 0], rs: ['a', '', 'ç'], rinner: [inner(0), inner(2)], rd: [0, -0, 1e308],
    ru64: ['0', '18446744073709551615'], rb: [true, false], rby: ['', 'AQ=='],
    m_si: { a: 1, '': 0, __proto__x: 2 }, m_is: { '-3': 'neg', 7: 'seven' }, m_ls: { '-9007199254740993': 'big', 5: 'five' },
    m_bi: { true: inner(3), false: {} }, m_sc: { x: 'GREEN', y: 'RED' }, m_ub: { '18446744073709551615': 'AP8=' },
    m_sd: { '-1': 0.5 }, p_s: 'chosen', opt: 0, unpacked: [5, 6, -7],
  },
  { p_i: 0, opt: 9, d: Number.NaN, f: Number.POSITIVE_INFINITY, colour: 'RED', s: '' },
  { p_inner: inner(4), colour: 1, i64: '0', b: false, by: '' },
  { rinner: [{}, {}, inner(5)], ri32: [], m_si: {} },
];

const PROTO2_VALUES: Record<string, unknown>[] = [
  { id: 1 },
  {
    id: -1, name: 'n', count: 0, level: 'HIGH', plainLevel: 'LOW', levels: ['LOW', 'HIGH'], packedLevels: ['MID', 'MID'],
    blob: 'AQI=', ratio: 0.5, neg: 3, big: '1', result: { url: 'u', rank: 2 }, hit: [{ q: 'a' }, { q: 'b' }],
    named: { k: 'LOW' }, next: { id: 2, next: { id: 3 } }, flag: false,
  },
  { id: 0, level: 'MID', next: { id: 9, result: {} } },
];

describe('reflect-codec matches protobufjs', () => {
  it.each(PROTO3_VALUES.map((v, i) => [i, v] as const))('proto3 message %i', (_i, value) => {
    const { ref, ours } = compare(PROTO3, 't3.All', encode(PROTO3, 't3.All', value));
    expect(ref.ok).toBe(true);
    expect(ours).toEqual(ref);
  });

  it.each(PROTO2_VALUES.map((v, i) => [i, v] as const))('proto2 message %i (required, defaults, closed enums, groups)', (_i, value) => {
    const { ref, ours } = compare(PROTO2, 't2.Req', encode(PROTO2, 't2.Req', value));
    expect(ref.ok).toBe(true);
    expect(ours).toEqual(ref);
  });

  it('refuses a missing required field the same way', () => {
    // Only field 2 (name = "x"); protobufjs's encoder would always write the required id.
    const { ref, ours } = compare(PROTO2, 't2.Req', new Uint8Array([0x12, 0x01, 0x78]));
    expect(ref).toEqual({ ok: false, error: "ProtocolError: missing required 'id'" });
    expect(ours).toEqual(ref);
  });

  it('drops unknown values of a closed enum, and keeps unknown values of an open one, as protobufjs does', () => {
    // t2.Req field 4 (closed Level) = 99, field 1 = 1; t3.All field 16 (open Colour) = 99.
    for (const [proto, type, bytes] of [
      [PROTO2, 't2.Req', [0x08, 0x01, 0x20, 0x63]],
      [PROTO3, 't3.All', [0x80, 0x01, 0x63]],
    ] as const) {
      const { ref, ours } = compare(proto, type, new Uint8Array(bytes));
      expect(ref.ok).toBe(true);
      expect(ours).toEqual(ref);
    }
  });

  it('decodes a message type with no fields', () => {
    const { ref, ours } = compare(PROTO3, 't3.Empty', new Uint8Array([0x08, 0x01, 0x12, 0x00]));
    expect(ours).toEqual(ref);
  });

  it('agrees on damaged and random payloads, value or error', () => {
    const next = rng(20261018);
    const corpus: [string, string, Uint8Array][] = [];
    const seeds = [
      ...PROTO3_VALUES.map((v) => [PROTO3, 't3.All', encode(PROTO3, 't3.All', v)] as const),
      ...PROTO2_VALUES.map((v) => [PROTO2, 't2.Req', encode(PROTO2, 't2.Req', v)] as const),
    ];
    for (const [proto, type, bytes] of seeds) {
      for (let cut = 0; cut <= bytes.length; cut++) corpus.push([proto, type, bytes.slice(0, cut)]);
      for (let n = 0; n < 150; n++) {
        const copy = Uint8Array.from(bytes);
        const flips = 1 + Math.floor(next() * 3);
        for (let f = 0; f < flips && copy.length; f++) copy[Math.floor(next() * copy.length)] = Math.floor(next() * 256);
        corpus.push([proto, type, copy]);
      }
    }
    for (let n = 0; n < 2000; n++) {
      const bytes = Uint8Array.from({ length: Math.floor(next() * 48) }, () => Math.floor(next() * 256));
      corpus.push(n % 2 ? [PROTO3, 't3.All', bytes] : [PROTO2, 't2.Req', bytes]);
    }
    let decoded = 0;
    for (const [proto, type, bytes] of corpus) {
      const { ref, ours } = compare(proto, type, bytes);
      if (ref.ok) decoded++;
      expect(ours, `${type} ${Buffer.from(bytes).toString('hex')}`).toEqual(ref);
    }
    // The corpus is worth something only if a fair share of it decodes.
    expect(decoded).toBeGreaterThan(corpus.length / 10);
  }, 60_000);
});

describe('decodeWithSchema never needs eval', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('decodes with protobufjs code generation blocked, as this site’s CSP blocks it', async () => {
    const bytes = encode(PROTO3, 't3.All', PROTO3_VALUES[1] as Record<string, unknown>);
    const expected = compare(PROTO3, 't3.All', bytes).ref;
    vi.spyOn(protobuf.util, 'codegen').mockImplementation(() => {
      throw new EvalError("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not allowed");
    });
    // protobufjs's own path is what the CSP stopped on the live site…
    const blocked = protobuf.parse(PROTO3).root.lookupType('t3.All');
    expect(() => blocked.decode(bytes)).toThrow(EvalError);
    // …and the tool no longer takes it.
    const result = await decodeWithSchema(PROTO3, bytes, 't3.All');
    expect({ ok: true, value: canon(result) }).toEqual(expected);
  });
});
