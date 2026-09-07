import { describe, expect, it } from 'vitest';
import { filterFontSources, isSameOriginSource, splitFontSources } from './same-origin-font-guard';

const ORIGIN = 'https://anytools.world';
const LOCAL = 'url(/third-party/excalidraw/fonts/Excalifont/Excalifont-Regular.woff2)';
const REMOTE = 'url(https://cdn.example.com/excalidraw/fonts/Excalifont-Regular.woff2)';

describe('splitFontSources', () => {
  it('splits on top-level commas only', () => {
    expect(splitFontSources("url(/a.woff2) format('woff2'), url(/b.woff2)")).toEqual([
      "url(/a.woff2) format('woff2')",
      'url(/b.woff2)',
    ]);
  });

  it('keeps a comma that lives inside a data: URL intact', () => {
    // The whole reason this is not String.split(','): base64 payloads are introduced by one.
    const src = 'url(data:font/woff2;base64,AAAA), url(/local.woff2)';
    expect(splitFontSources(src)).toEqual(['url(data:font/woff2;base64,AAAA)', 'url(/local.woff2)']);
  });

  it('keeps a comma inside a quoted family name intact', () => {
    expect(splitFontSources("local('Foo, Bold'), url(/x.woff2)")).toEqual([
      "local('Foo, Bold')",
      'url(/x.woff2)',
    ]);
  });
});

describe('isSameOriginSource', () => {
  it('keeps relative and same-origin absolute urls', () => {
    expect(isSameOriginSource(LOCAL, ORIGIN)).toBe(true);
    expect(isSameOriginSource(`url(${ORIGIN}/x.woff2)`, ORIGIN)).toBe(true);
  });

  it('drops a cross-origin url', () => {
    expect(isSameOriginSource(REMOTE, ORIGIN)).toBe(false);
  });

  it('keeps data:, blob: and local() — no third party is involved in any of them', () => {
    expect(isSameOriginSource('url(data:font/woff2;base64,AAAA)', ORIGIN)).toBe(true);
    expect(isSameOriginSource('url(blob:https://x/y)', ORIGIN)).toBe(true);
    expect(isSameOriginSource("local('Excalifont')", ORIGIN)).toBe(true);
  });
});

describe('filterFontSources', () => {
  it('drops the CDN fallback Excalidraw appends, keeping ours', () => {
    const src = `${LOCAL} format('woff2'), ${REMOTE} format('woff2')`;
    expect(filterFontSources(src, ORIGIN)).toBe(`${LOCAL} format('woff2')`);
  });

  it('returns the input untouched when every source is already local', () => {
    const src = "url(/a.woff2) format('woff2')";
    expect(filterFontSources(src, ORIGIN)).toBe(src);
  });

  it('leaves a wholly cross-origin list alone rather than emptying it', () => {
    // Breaking a caller that has no local copy would be worse than the request it makes: CSP
    // still blocks the fetch, and an empty src is a construction error.
    expect(filterFontSources(REMOTE, ORIGIN)).toBe(REMOTE);
  });
});
