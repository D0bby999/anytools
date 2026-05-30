import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TARGETS = new Set(['fetch', 'node-fetch', 'python', 'php', 'go']);

type CurlConverter = {
  toJavaScript: (c: string) => string;
  toNodeFetch: (c: string) => string;
  toPython: (c: string) => string;
  toPhp: (c: string) => string;
  toGo: (c: string) => string;
};

// curlconverter is ESM-only and depends on tree-sitter native bindings.
// next.config.ts marks it in serverExternalPackages so webpack does NOT bundle
// it; dynamic import resolves it at runtime from real node_modules.
let _cc: CurlConverter | null = null;
async function loadCurlConverter(): Promise<CurlConverter> {
  if (_cc) return _cc;
  // Hide module name from webpack static analysis by computing it at runtime.
  const pkg = ['curl', 'converter'].join('');
  const mod = await import(/* webpackIgnore: true */ pkg);
  _cc = (mod.default ?? mod) as CurlConverter;
  return _cc;
}

export async function POST(req: Request) {
  let body: { curl?: unknown; target?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { curl, target } = body;
  if (typeof curl !== 'string' || !curl.trim()) {
    return NextResponse.json({ error: 'curl is required' }, { status: 400 });
  }
  if (curl.length > 8000) {
    return NextResponse.json({ error: 'curl too long (max 8000 chars)' }, { status: 413 });
  }
  if (typeof target !== 'string' || !TARGETS.has(target)) {
    return NextResponse.json({ error: 'Invalid target' }, { status: 400 });
  }

  try {
    const cc = await loadCurlConverter();
    let code: string;
    switch (target) {
      case 'fetch':
        code = cc.toJavaScript(curl);
        break;
      case 'node-fetch':
        code = cc.toNodeFetch(curl);
        break;
      case 'python':
        code = cc.toPython(curl);
        break;
      case 'php':
        code = cc.toPhp(curl);
        break;
      case 'go':
        code = cc.toGo(curl);
        break;
      default:
        return NextResponse.json({ error: 'Unsupported target' }, { status: 400 });
    }
    return NextResponse.json({ code });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Parse failed';
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
