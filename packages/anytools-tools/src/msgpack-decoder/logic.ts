import { ToolError } from '../shared/tool-error';

export type MsgpackDecodeResult = {
  /** Pretty-printed JSON. `@msgpack/msgpack` maps the timestamp extension to `Date`, and
   * `JSON.stringify` calls `Date#toJSON` automatically, so an ext type -1 value already
   * comes out as a readable ISO 8601 string here — no extra handling needed. */
  json: string;
  inputBytes: number;
  outputBytes: number;
};

export type MsgpackEncodeResult = {
  bytes: Uint8Array;
  inputBytes: number;
  outputBytes: number;
};

/** Decode a MessagePack payload to JSON text, with byte counts for the size comparison. */
export async function decodeMsgpack(bytes: Uint8Array): Promise<MsgpackDecodeResult> {
  if (bytes.length === 0) {
    throw new ToolError('emptyPayload', 'Paste or upload a payload first.');
  }
  const { decode } = await import('@msgpack/msgpack');
  let value: unknown;
  try {
    value = decode(bytes);
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'Decode error';
    throw new ToolError('decodeFailed', `This payload does not decode as MessagePack: ${detail}`, {
      detail,
    });
  }
  // `value` can itself be a bare scalar (MessagePack does not require a top-level
  // container), and `JSON.stringify(undefined)` returns `undefined`, not a string.
  const json = JSON.stringify(value, null, 2) ?? 'null';
  return {
    json,
    inputBytes: bytes.length,
    outputBytes: new TextEncoder().encode(json).length,
  };
}

/** Encode pasted JSON text to a MessagePack payload, with byte counts for the size comparison. */
export async function encodeMsgpack(jsonText: string): Promise<MsgpackEncodeResult> {
  let value: unknown;
  try {
    value = JSON.parse(jsonText);
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'Parse error';
    throw new ToolError('invalidJson', `Data is not valid JSON: ${detail}`, { detail });
  }
  const { encode } = await import('@msgpack/msgpack');
  const bytes = encode(value);
  return {
    bytes,
    inputBytes: new TextEncoder().encode(jsonText).length,
    outputBytes: bytes.length,
  };
}
