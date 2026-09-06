import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchThumbnailBlob, parseYouTubeId, thumbnailUrl } from './logic';

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

describe('fetchThumbnailBlob', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves with the blob on a 200 response', async () => {
    const blob = new Blob(['fake-jpeg-bytes']);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob }),
    );
    await expect(fetchThumbnailBlob('https://i.ytimg.com/vi/x/maxresdefault.jpg')).resolves.toBe(
      blob,
    );
  });

  it('throws a ToolError with the status on a non-ok response (e.g. missing maxresdefault)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, blob: async () => new Blob() }),
    );
    await expect(fetchThumbnailBlob('https://i.ytimg.com/vi/x/maxresdefault.jpg')).rejects.toThrow(
      'YouTube returned 404',
    );
  });

  it('throws a ToolError when the network request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchThumbnailBlob('https://i.ytimg.com/vi/x/maxresdefault.jpg')).rejects.toThrow(
      "Could not reach YouTube's image server.",
    );
  });
});
