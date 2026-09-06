import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadThumbnail, parseYouTubeId, thumbnailUrl } from './logic';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeId', () => {
  it('accepts a bare 11-character id', () => {
    expect(parseYouTubeId(ID)).toBe(ID);
  });

  it('parses a watch?v= URL, including with extra query params', () => {
    expect(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://youtube.com/watch?v=${ID}&t=42s&list=PLxyz`)).toBe(ID);
  });

  it('parses a youtu.be short link', () => {
    expect(parseYouTubeId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://youtu.be/${ID}?t=10`)).toBe(ID);
  });

  it('parses a /shorts/ link', () => {
    expect(parseYouTubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
  });

  it('parses an /embed/ link', () => {
    expect(parseYouTubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
  });

  it('parses a /live/ link', () => {
    expect(parseYouTubeId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
  });

  it('accepts input with no scheme', () => {
    expect(parseYouTubeId(`youtu.be/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`m.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('trims surrounding whitespace', () => {
    expect(parseYouTubeId(`  ${ID}  `)).toBe(ID);
  });

  it('rejects unrelated hosts, malformed ids and empty input', () => {
    expect(parseYouTubeId('https://vimeo.com/12345')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseYouTubeId('not a url at all ///')).toBeNull();
    expect(parseYouTubeId('')).toBeNull();
    expect(parseYouTubeId('   ')).toBeNull();
  });

  it('rejects a youtube.com URL with no recognizable path', () => {
    expect(parseYouTubeId('https://www.youtube.com/results?search_query=cats')).toBeNull();
  });
});

describe('thumbnailUrl', () => {
  it('builds the i.ytimg.com URL for each resolution', () => {
    expect(thumbnailUrl(ID, 'maxresdefault')).toBe(
      `https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`,
    );
    expect(thumbnailUrl(ID, 'mqdefault')).toBe(`https://i.ytimg.com/vi/${ID}/mqdefault.jpg`);
  });
});

describe('downloadThumbnail', () => {
  // The blob path needs Image + canvas.toBlob, which happy-dom does not implement; it is
  // covered by the browser lane instead (see the phase file's Verify section). What is worth
  // asserting here is the decision the function makes BEFORE touching a canvas: a decoded
  // 120x90 image is YouTube's grey placeholder, not a thumbnail, and must be rejected.
  it('rejects the 120x90 placeholder YouTube serves for a missing size', async () => {
    class FakeImage {
      crossOrigin = '';
      naturalWidth = 120;
      naturalHeight = 90;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    await expect(downloadThumbnail('https://i.ytimg.com/vi/x/maxresdefault.jpg')).rejects.toThrow(
      /placeholder/i,
    );
    vi.unstubAllGlobals();
  });

  it('rejects when the CDN cannot be reached at all', async () => {
    class FailingImage {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FailingImage);
    await expect(downloadThumbnail('https://i.ytimg.com/vi/x/maxresdefault.jpg')).rejects.toThrow(
      /image server/i,
    );
    vi.unstubAllGlobals();
  });
});
