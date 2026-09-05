import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { NOTO_FONT_URL } from './pdf-unicode-font';

/** The web app's staged copy — `pnpm dev`/`build` put it there from vendor-assets.json. */
export const NOTO_FONT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/anytools-web/public/third-party/noto/NotoSans-Regular.ttf',
);

export const hasNotoFont = () => existsSync(NOTO_FONT_PATH);

/**
 * Point `fetch` at the file on disk for the font URL only. Tests that need the Unicode path
 * call this in `beforeAll` and skip themselves with `hasNotoFont()` when the asset is absent.
 */
export function stubNotoFetch(): void {
  const bytes = readFileSync(NOTO_FONT_PATH);
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (!href.endsWith(NOTO_FONT_URL)) throw new Error(`unexpected fetch in test: ${href}`);
    return new Response(bytes, { status: 200 });
  });
}
