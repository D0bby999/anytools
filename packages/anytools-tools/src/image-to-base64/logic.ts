/**
 * Image ↔ base64 data URI, entirely in the browser.
 *
 * Deliberately does NOT go through `../shared/canvas-image`. Every other image tool in this
 * cluster redraws pixels onto a canvas — resize, rotate, watermark — and needs `loadBitmap` for
 * that. This tool does not touch a pixel: it base64-encodes the file's ORIGINAL bytes verbatim
 * via `FileReader.readAsDataURL`, and decodes back the same way. Routing it through a canvas
 * would force a format choice, re-encode lossy formats a second time, and — for JPEG — silently
 * drop the EXIF orientation flag `loadBitmap` exists to respect. A data URI is meant to be a
 * byte-for-byte copy of the file; this keeps it one.
 */
import { ToolError } from '../shared/tool-error';

/** Past this many bytes of ENCODED text, inline embedding is worth a warning — see strings.ts. */
export const BASE64_SIZE_WARN_BYTES = 100 * 1024;

export class ImageToBase64Error extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'ImageToBase64Error';
  }
}

export type EncodedImage = {
  name: string;
  mime: string;
  dataUri: string;
  sizeBefore: number;
  /** Length of the base64 payload — the actual size of what gets embedded, ASCII so 1 char = 1 byte. */
  sizeAfter: number;
};

/** Read a file as a `data:` URI. Rejects only on a genuine read failure — FileReader itself
 * does not care what the bytes are, so anything the dropzone let through is encodable. */
export function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else
        reject(
          new ImageToBase64Error('readFailed', `"${file.name}" could not be read.`, {
            name: file.name,
          }),
        );
    };
    reader.onerror = () =>
      reject(
        new ImageToBase64Error('readFailed', `"${file.name}" could not be read.`, {
          name: file.name,
        }),
      );
    reader.readAsDataURL(file);
  });
}

export async function encodeImageFile(file: File): Promise<EncodedImage> {
  if (file.type && !file.type.startsWith('image/')) {
    throw new ImageToBase64Error(
      'notAnImage',
      `"${file.name}" is not an image (its type is "${file.type}").`,
      { name: file.name, mime: file.type },
    );
  }
  const dataUri = await fileToDataUri(file);
  const comma = dataUri.indexOf(',');
  const base64 = comma >= 0 ? dataUri.slice(comma + 1) : '';
  return {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    dataUri,
    sizeBefore: file.size,
    sizeAfter: base64.length,
  };
}

/** `data:<mime>[;charset=...];base64,<payload>` — the shape every browser and email client emits. */
const DATA_URI_RE = /^data:([^;,]+)(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/;

export type ParsedDataUri = { mime: string; base64: string };

export function parseDataUri(input: string): ParsedDataUri {
  const trimmed = input.trim();
  const m = DATA_URI_RE.exec(trimmed);
  if (!m) {
    throw new ImageToBase64Error(
      'badDataUri',
      'That is not a data URI. It should start with "data:image/...;base64,".',
    );
  }
  const [, mime, isBase64, payload] = m as unknown as [string, string, string | undefined, string];
  if (!isBase64) {
    throw new ImageToBase64Error(
      'notBase64DataUri',
      'This data URI is not base64-encoded — paste one that ends in ";base64,<data>".',
    );
  }
  if (!mime.startsWith('image/')) {
    throw new ImageToBase64Error(
      'dataUriNotImage',
      `This data URI's type is "${mime}", not an image.`,
      { mime },
    );
  }
  return { mime, base64: payload.replace(/\s+/g, '') };
}

/** Best-effort file extension for a download name — falls back to a generic one rather than
 * guessing wrong, since a wrong extension is worse than none for opening the file later. */
export function extensionFromMime(mime: string): string {
  const known: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
  };
  return known[mime] ?? 'bin';
}

/** Parse and decode a data URI back into the exact original bytes. */
export function dataUriToBlob(input: string): Blob {
  const { mime, base64 } = parseDataUri(input);
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new ImageToBase64Error(
      'badBase64',
      'The base64 payload could not be decoded — check nothing was cut off when it was copied.',
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export const htmlImgTag = (dataUri: string): string => `<img src="${dataUri}" alt="" />`;
export const cssBackgroundImage = (dataUri: string): string =>
  `background-image: url("${dataUri}");`;
export const cssUrlFunction = (dataUri: string): string => `url("${dataUri}")`;
export const markdownImage = (dataUri: string): string => `![image](${dataUri})`;
