/**
 * Orchestrates the two things this tool actually does — read `sfnt-woff.ts` for why the scope
 * stops at TTF/OTF ⇄ WOFF1 (no WOFF2, no true glyf⇄CFF outline conversion) — plus character
 * subsetting via `hb-subset-engine.ts`. Both of those do the binary/wasm work; this file is the
 * decision tree connecting a File to a downloadable result.
 */
import { ToolError } from '../shared/tool-error';
import { HbSubsetEngineError, subsetSfnt } from './hb-subset-engine';
import {
  type Sfnt,
  SfntFormatError,
  buildSfnt,
  detectFontFlavor,
  extensionForFlavor,
  parseSfnt,
  unwrapWoff,
  wrapWoff,
} from './sfnt-woff';

export type ConvertTarget = 'native' | 'woff';

export type FontConvertOptions = {
  /** 'native' unwraps to a raw TTF/OTF; 'woff' (re-)wraps into WOFF 1.0. */
  target: ConvertTarget;
  /** Characters to keep. Omitted or empty (after trimming) means "do not subset". */
  subsetText?: string;
};

export type FontConvertResult = {
  blob: Blob;
  extension: 'ttf' | 'otf' | 'woff';
  inputBytes: number;
  outputBytes: number;
  subsetted: boolean;
  /** How many distinct characters were kept — only meaningful when `subsetted` is true. */
  subsetCharCount: number;
};

export class FontConverterError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'FontConverterError';
  }
}

const MIME: Record<FontConvertResult['extension'], string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
};

/** Distinct Unicode code points in `text`, in first-seen order — duplicates cost hb-subset nothing but a wasted call. */
function uniqueCodepoints(text: string): number[] {
  const seen = new Set<number>();
  for (const ch of text) seen.add(ch.codePointAt(0) as number);
  return Array.from(seen);
}

/** Parse whatever container the file is actually in (WOFF or raw sfnt) into one shape. */
async function readAsSfnt(bytes: Uint8Array): Promise<Sfnt> {
  const flavor = detectFontFlavor(bytes);
  if (flavor === 'woff2') {
    throw new FontConverterError(
      'woff2Unsupported',
      'This is a WOFF2 file. WOFF2 tables are Brotli-compressed, and no Brotli codec is available here (browsers do not expose one via the Compression Streams API, and none is pinned for this tool). Re-export the font as TTF, OTF or WOFF1 first.',
    );
  }
  if (flavor === 'unknown') {
    throw new FontConverterError(
      'unknownFormat',
      'This does not look like a TTF, OTF or WOFF file (the first four bytes do not match any of their signatures).',
    );
  }
  try {
    return flavor === 'woff' ? await unwrapWoff(bytes) : parseSfnt(bytes);
  } catch (e) {
    if (e instanceof SfntFormatError) {
      throw new FontConverterError('parseFailed', `Could not read this font: ${e.message}`, {
        detail: e.message,
      });
    }
    throw e;
  }
}

/** Run the font through hb-subset, keeping every code point in `text`. Caller guarantees `text` is non-blank. */
async function subset(sfnt: Sfnt, text: string): Promise<Sfnt> {
  const codepoints = uniqueCodepoints(text);
  try {
    const subsetBytes = await subsetSfnt(buildSfnt(sfnt), codepoints);
    return parseSfnt(subsetBytes);
  } catch (e) {
    const msg =
      e instanceof HbSubsetEngineError || e instanceof SfntFormatError ? e.message : String(e);
    throw new FontConverterError('subsetFailed', `Subsetting failed: ${msg}`, { detail: msg });
  }
}

/**
 * Convert `file` per `options`. Always reads real bytes first — nothing here trusts the file's
 * name or its declared MIME type, only what `detectFontFlavor` sees in the file itself.
 */
export async function convertFont(
  file: File,
  options: FontConvertOptions,
): Promise<FontConvertResult> {
  const inputBytes = new Uint8Array(await file.arrayBuffer());
  let sfnt = await readAsSfnt(inputBytes);

  let subsetted = false;
  let subsetCharCount = 0;
  const subsetText = options.subsetText?.trim();
  if (subsetText) {
    sfnt = await subset(sfnt, subsetText);
    subsetted = true;
    subsetCharCount = uniqueCodepoints(subsetText).length;
  }

  const extension: FontConvertResult['extension'] =
    options.target === 'woff' ? 'woff' : extensionForFlavor(sfnt.flavor);
  const outBytes = options.target === 'woff' ? await wrapWoff(sfnt) : buildSfnt(sfnt);

  return {
    blob: new Blob([outBytes], { type: MIME[extension] }),
    extension,
    inputBytes: inputBytes.byteLength,
    outputBytes: outBytes.byteLength,
    subsetted,
    subsetCharCount,
  };
}
