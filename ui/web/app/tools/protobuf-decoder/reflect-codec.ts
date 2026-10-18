/**
 * Schema decoding without generated code.
 *
 * protobufjs writes each message type's decoder and toObject converter as JavaScript source and
 * compiles it with `Function` (src/decoder.js, src/converter.js, src/util/codegen.js). This
 * app's Content-Security-Policy has no 'unsafe-eval', so on the live site `type.decode` threw an
 * EvalError and schema decoding could not work at all. Rather than open eval to every page, this
 * walks the same reflection protobufjs generates that code from, branch for branch (protobufjs
 * 8.8.0), for the one set of toObject options this tool uses:
 *   { longs: String, enums: String, bytes: String, defaults: true }.
 *
 * protobufjs still parses the .proto, resolves types and reads the wire (Reader, Long, base64):
 * none of that generates code. Unknown fields are skipped rather than kept, since toObject never
 * shows them. reflect-codec.test.ts holds the output equal to protobufjs's own, key order
 * included, across every field kind and a few thousand random payloads.
 */
import type * as Protobuf from 'protobufjs';

/** The protobufjs module, as far as this walk uses it. */
type Pb = { Reader: typeof Protobuf.Reader; Enum: typeof Protobuf.Enum; types: unknown; util: unknown };
type Msg = Record<string, unknown>;
type Long = { low: number; high: number; unsigned: boolean };

/** The parts of a reflected field this walks; several are protobufjs internals, not in its types. */
type RField = {
  name: string;
  id: number;
  type: string;
  keyType?: string;
  map: boolean;
  repeated: boolean;
  required: boolean;
  long: boolean;
  bytes: boolean;
  delimited: boolean;
  hasPresence: boolean;
  resolvedType: unknown;
  typeDefault: unknown;
  defaultValue: unknown;
  partOf: { name: string; isProto3Optional?: boolean } | null;
  _features: { utf8_validation?: string };
  resolve(): RField;
};
type REnum = { values: Record<number, string>; valuesById: Record<number, string>; _features: { enum_type?: string } };
type RType = { fieldsArray: RField[] };
type Reader = Protobuf.Reader & {
  len: number;
  tag(): number;
  skipType(wireType: number, depth?: number, fieldNumber?: number): Reader;
} & Record<string, (arg?: unknown) => unknown>;
type Util = {
  Long: (new (low: number, high: number, unsigned: boolean) => { toString(): string }) & {
    fromNumber(n: number, unsigned: boolean): unknown;
    prototype: { toString(): string };
  } | null;
  emptyObject: object;
  recursionLimit: number;
  compareFieldsById(a: RField, b: RField): number;
  longToHash(value: unknown): string;
  longFromKey(key: string, unsigned: boolean): { toString(): string };
  makeProp(obj: object, key: string): void;
  base64: { encode(buf: Uint8Array, start: number, end: number): string };
  ProtocolError: new (message: string, properties: { instance: Msg }) => Error;
};

/** `%j` in protobufjs's generated code: the value as a JSON literal, so a fresh copy. */
const literal = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

const hasOwn = (m: object, key: string) => Object.prototype.hasOwnProperty.call(m, key);

function fieldsOf(type: RType): RField[] {
  return type.fieldsArray.map((f) => f.resolve());
}

/**
 * What protobufjs's generated constructor gives `decode`: the field defaults on the prototype,
 * and an own `{}` / `[]` for each map and repeated field.
 */
function newMessage(type: RType): Msg {
  const proto: Msg = {};
  const m = Object.create(proto) as Msg;
  for (const f of fieldsOf(type)) {
    proto[f.name] = f.defaultValue;
    if (f.map) m[f.name] = {};
    else if (f.repeated) m[f.name] = [];
  }
  return m;
}

/**
 * What Type#setup does before it generates anything: resolve editions features (closed enums,
 * field presence, UTF-8 validation) across the root. The walk reads them, so it needs it too.
 */
function resolveFeatures(type: Protobuf.Type): void {
  const t = type as unknown as { _edition?: string; root: { _needsRecursiveFeatureResolution?: boolean; _edition?: string; _resolveFeaturesRecursive(edition: string): void } | null };
  const root = t.root;
  if (root && root._needsRecursiveFeatureResolution) {
    const edition = root._edition || t._edition;
    if (edition) root._resolveFeaturesRecursive(edition);
  }
}

export function decodeMessage(pb: Pb, type: Protobuf.Type, bytes: Uint8Array): Msg {
  resolveFeatures(type);
  return decode(pb, type as unknown as RType, pb.Reader.create(bytes) as Reader, undefined, undefined, 0, undefined);
}

export function messageToObject(pb: Pb, type: Protobuf.Type, message: Msg): Msg {
  resolveFeatures(type);
  return toObject(pb, type as unknown as RType, message, 0);
}

function decode(
  pb: Pb,
  mtype: RType,
  r: Reader,
  lIn: number | undefined,
  zIn: number | undefined,
  q: number,
  g: Msg | null | undefined,
): Msg {
  const util = pb.util as unknown as Util;
  const types = pb.types as unknown as Record<'basic' | 'defaults' | 'long' | 'mapKey' | 'packed', Record<string, unknown>>;
  let l = lIn;
  let z = zIn;
  if (q > pb.Reader.recursionLimit) throw Error('max depth exceeded');
  let c: number;
  if (l === undefined) c = r.len;
  else {
    c = r.pos + l;
    if (c > r.len) throw RangeError('index out of range');
    l = r.len;
    r.len = c;
  }
  const m = g || newMessage(mtype);
  const fields = fieldsOf(mtype);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const read = (method: string) => r[method]!.call(r) as unknown;
  const stringMethod = (f: RField) => (f._features.utf8_validation === 'VERIFY' ? 'stringVerify' : 'string');

  while (r.pos < c) {
    let t = r.tag();
    if (t === z) {
      z = undefined;
      break;
    }
    if (!fields.length) {
      r.skipType(t & 7, q, t);
      continue;
    }
    let u = t & 7;
    t >>>= 3;
    const field = byId.get(t);
    if (field && decodeField(field)) continue;
    r.skipType(u, q, t);

    /** One `case` of the generated switch: true where it ends in `continue`, false where it `break`s. */
    function decodeField(f: RField): boolean {
      const isEnum = f.resolvedType instanceof pb.Enum;
      const en = f.resolvedType as REnum;
      const type = isEnum ? 'int32' : f.type;
      const closed = isEnum && en._features.enum_type === 'CLOSED';
      const basic = types.basic[type] as number | undefined;
      const sub = f.resolvedType as RType;
      const name = f.name;

      if (f.map) {
        if (u !== 2) return false;
        if (!closed && m[name] === util.emptyObject) m[name] = {};
        const c2 = r.uint32() + r.pos;
        if (c2 > r.len) throw RangeError('index out of range');
        r.len = c2;
        const keyType = f.keyType as string;
        let k: unknown = types.defaults[keyType] !== undefined ? literal(types.defaults[keyType]) : null;
        let v: unknown =
          types.long[type] !== undefined
            ? util.Long
              ? util.Long.fromNumber(0, type === 'uint64' || type === 'fixed64')
              : 0
            : types.defaults[type] !== undefined
              ? literal(types.defaults[type])
              : null;
        while (r.pos < c2) {
          let t2 = r.tag();
          u = t2 & 7;
          t2 >>>= 3;
          if (t2 === 1 && u === types.mapKey[keyType]) {
            k = read(keyType === 'string' ? stringMethod(f) : keyType);
            continue;
          }
          if (t2 === 2 && u === (basic === undefined ? 2 : basic)) {
            v = basic === undefined ? decode(pb, sub, r, r.uint32(), undefined, q + 1, v as Msg | null) : read(type === 'string' ? stringMethod(f) : type);
            continue;
          }
          r.skipType(u, q, t2);
        }
        if (r.pos !== c2) throw RangeError('index out of range');
        r.len = c;
        if (closed) {
          if (en.valuesById[v as number] === undefined) return true;
          if (m[name] === util.emptyObject) m[name] = {};
        }
        const val = basic === undefined ? v || newMessage(sub) : v;
        const target = m[name] as Msg;
        if (types.long[keyType] !== undefined) target[typeof k === 'object' ? util.longToHash(k) : (k as string)] = val;
        else {
          if (keyType === 'string' && k === '__proto__') util.makeProp(target, k);
          target[k as string] = val;
        }
        return true;
      }

      if (f.repeated) {
        const list = () => m[name] as unknown[];
        const ensure = () => {
          if (!(m[name] && list().length)) m[name] = [];
        };
        if (types.packed[type] !== undefined && u === 2) {
          if (closed) {
            const c2 = r.uint32() + r.pos;
            if (c2 > r.len) throw RangeError('index out of range');
            r.len = c2;
            while (r.pos < c2) {
              const v = read(type);
              if (en.valuesById[v as number] !== undefined) {
                ensure();
                list().push(v);
              }
            }
            if (r.pos !== c2) throw RangeError('index out of range');
            r.len = c;
          } else {
            ensure();
            r[`${type}s`]!.call(r, list());
          }
          return true;
        }
        if (u !== (basic === undefined ? (f.delimited ? 3 : 2) : basic)) return false;
        if (!closed) ensure();
        if (basic === undefined) {
          list().push(
            f.delimited
              ? decode(pb, sub, r, undefined, f.id * 8 + 4, q + 1, undefined)
              : decode(pb, sub, r, r.uint32(), undefined, q + 1, undefined),
          );
        } else if (closed) {
          const v = read(type);
          if (en.valuesById[v as number] !== undefined) {
            ensure();
            list().push(v);
          }
        } else list().push(read(type === 'string' ? stringMethod(f) : type));
        if (f.partOf && !closed) m[f.partOf.name] = name;
        return true;
      }

      if (basic === undefined) {
        if (u !== (f.delimited ? 3 : 2)) return false;
        m[name] = f.delimited
          ? decode(pb, sub, r, undefined, f.id * 8 + 4, q + 1, m[name] as Msg | null)
          : decode(pb, sub, r, r.uint32(), undefined, q + 1, m[name] as Msg | null);
      } else if (f.hasPresence) {
        if (u !== basic) return false;
        if (closed) {
          const v = read(type);
          if (en.valuesById[v as number] !== undefined) {
            m[name] = v;
            if (f.partOf) m[f.partOf.name] = name;
          }
        } else m[name] = read(type === 'string' ? stringMethod(f) : type);
      } else {
        if (u !== basic) return false;
        if (closed) {
          const v = read(type);
          if (en.valuesById[v as number] !== undefined) {
            if (v !== f.typeDefault) m[name] = v;
            else delete m[name];
          }
        } else {
          let v: unknown;
          let keep: unknown;
          if (isEnum && f.typeDefault !== 0) keep = (v = read(type)) !== f.typeDefault;
          else if (type === 'string') keep = (v = read(stringMethod(f)) as string).length;
          else if (type === 'bytes') keep = (v = read(type) as Uint8Array).length;
          else if (types.long[type] !== undefined) {
            v = read(type);
            keep = typeof v === 'object' ? (v as Long).low || (v as Long).high : v !== 0;
          } else if (type === 'double' || type === 'float') keep = !Object.is((v = read(type)), 0);
          else keep = v = read(type);
          if (keep) m[name] = v;
          else delete m[name];
        }
      }
      if (f.partOf && !closed) m[f.partOf.name] = name;
      return true;
    }
  }
  if (l !== undefined) {
    if (r.pos !== c) throw RangeError('index out of range');
    r.len = l;
  }
  if (z !== undefined) throw Error('missing end group');
  for (const f of fields) {
    if (f.required && !hasOwn(m, f.name)) throw new util.ProtocolError(`missing required '${f.name}'`, { instance: m });
  }
  return m;
}

function toObject(pb: Pb, mtype: RType, m: Msg, q: number): Msg {
  const util = pb.util as unknown as Util;
  const longTypes = (pb.types as unknown as { long: Record<string, unknown> }).long;
  const fields = fieldsOf(mtype).slice().sort(util.compareFieldsById);
  if (!fields.length) return {};
  if (q > util.recursionLimit) throw Error('max depth exceeded');
  const d: Msg = {};

  const free = fields.filter((f) => !f.partOf);
  for (const f of free) if (f.repeated) d[f.name] = [];
  for (const f of free) if (!f.repeated && f.map) d[f.name] = {};
  for (const f of free) {
    if (f.repeated || f.map) continue;
    const td = f.typeDefault;
    if (f.resolvedType instanceof pb.Enum) d[f.name] = (f.resolvedType as unknown as REnum).valuesById[td as number];
    else if (f.long) {
      const n = td as Long;
      d[f.name] = util.Long ? new util.Long(n.low, n.high, n.unsigned).toString() : String(td);
    } else if (f.bytes) d[f.name] = util.base64.encode(td as Uint8Array, 0, (td as Uint8Array).length);
    else if ((f.type === 'double' || f.type === 'float') && typeof td === 'number' && (!Number.isFinite(td) || Object.is(td, -0)))
      d[f.name] = td;
    else d[f.name] = literal(td);
  }

  const convert = (f: RField, v: unknown): unknown => {
    if (f.resolvedType) {
      if (f.resolvedType instanceof pb.Enum) {
        const named = (f.resolvedType as unknown as REnum).values[v as number];
        return named === undefined ? v : named;
      }
      return toObject(pb, f.resolvedType as RType, v as Msg, q + 1);
    }
    switch (f.type) {
      case 'uint64':
      case 'fixed64':
      case 'int64':
      case 'sint64':
      case 'sfixed64':
        return typeof v === 'number' ? String(v) : util.Long!.prototype.toString.call(v);
      case 'bytes':
        return util.base64.encode(v as Uint8Array, 0, (v as Uint8Array).length);
      default:
        return v;
    }
  };

  for (const f of fields) {
    const v = m[f.name];
    if (f.map) {
      const keys = v ? Object.keys(v as Msg) : [];
      if (!keys.length) continue;
      const out: Msg = {};
      d[f.name] = out;
      const longKey = longTypes[f.keyType as string] !== undefined;
      for (const k of keys) {
        const k2 = longKey ? util.longFromKey(k, f.keyType === 'uint64' || f.keyType === 'fixed64').toString() : k;
        if (k === '__proto__') util.makeProp(out, k);
        out[k2] = convert(f, (v as Msg)[k]);
      }
    } else if (f.repeated) {
      const items = v as unknown[] | undefined;
      if (items && items.length) d[f.name] = items.map((item) => convert(f, item));
    } else if (v != null && hasOwn(m, f.name)) d[f.name] = convert(f, v);
  }
  return d;
}
