/**
 * Byte-array <-> hex/Base64 conversions for tools that accept a pasted or uploaded binary
 * payload (protobuf-decoder, msgpack-decoder). Kept separate from base64-encode/hex-encode:
 * those two decode to a UTF-8 *string*, which is wrong here — a protobuf or MessagePack
 * payload is not text, and running it through a UTF-8 decoder would corrupt bytes above 0x7f.
 */
import { Base64 } from 'js-base64';
import { ToolError } from './tool-error';

/** Above this, decoding a pasted/uploaded payload would stall the tab. */
export const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function assertSize(byteLength: number): void {
  if (byteLength > MAX_PAYLOAD_BYTES) {
    throw new ToolError(
      'payloadTooLarge',
      `This payload is ${formatBytes(byteLength)}, above the ${formatBytes(MAX_PAYLOAD_BYTES)} this tool decodes in the browser.`,
      { size: formatBytes(byteLength), max: formatBytes(MAX_PAYLOAD_BYTES) },
    );
  }
}

const HEX_SEPARATORS = /[\s,;:|_-]/g;

/** Parse pasted hex (same separator styles hex-encode accepts: space, comma, colon, `0x`…) into raw bytes. */
export function bytesFromHex(input: string): Uint8Array {
  const clean = input.replace(/0x/gi, '').replace(HEX_SEPARATORS, '');
  if (clean.length === 0) {
    throw new ToolError('emptyPayload', 'Paste or upload a payload first.');
  }
  const bad = clean.match(/[^0-9a-fA-F]/);
  if (bad) {
    throw new ToolError('notHexDigit', `"${bad[0]}" is not a hex digit — expected 0-9 and a-f`, {
      char: bad[0],
    });
  }
  if (clean.length % 2 !== 0) {
    throw new ToolError('hexOddLength', 'Hex string has an odd number of digits.');
  }
  assertSize(clean.length / 2);
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

/** Parse pasted Base64 (standard or URL-safe, padded or not) into raw bytes. */
export function bytesFromBase64(input: string): Uint8Array {
  const compact = input.replace(/\s+/g, '').replace(/=+$/, '');
  if (compact.length === 0) {
    throw new ToolError('emptyPayload', 'Paste or upload a payload first.');
  }
  if (!/^[A-Za-z0-9+/_-]*$/.test(compact) || compact.length % 4 === 1) {
    throw new ToolError('invalidBase64Input', 'This is not valid Base64.');
  }
  const rem = compact.length % 4;
  assertSize(Math.floor((compact.length * 3) / 4));
  try {
    return Base64.toUint8Array(rem === 0 ? compact : compact + '='.repeat(4 - rem));
  } catch {
    throw new ToolError('invalidBase64Input', 'This is not valid Base64.');
  }
}

/** Validate an uploaded file's bytes against the same size cap pasted text goes through. */
export function bytesFromFile(buffer: ArrayBuffer): Uint8Array {
  assertSize(buffer.byteLength);
  return new Uint8Array(buffer);
}

export function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

export function base64FromBytes(bytes: Uint8Array): string {
  return Base64.fromUint8Array(bytes);
}
