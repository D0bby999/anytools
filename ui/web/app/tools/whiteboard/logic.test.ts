import { describe, expect, it } from 'vitest';
import { ToolError } from '../shared/tool-error';
import {
  MAX_SCENE_BYTES,
  SCENE_TYPE,
  SCENE_VERSION,
  parseSceneFile,
  sceneByteLength,
  serializeScene,
  storageKey,
  stripEmbedElements,
} from './logic';

const rectangle = { id: 'a1', type: 'rectangle', x: 10, y: 20, width: 100, height: 60 };
const image = (fileId: string, extra: Record<string, unknown> = {}) => ({
  id: `img-${fileId}`,
  type: 'image',
  fileId,
  ...extra,
});
const binaryFile = (id: string) => ({
  id,
  mimeType: 'image/png',
  dataURL: `data:image/png;base64,${'A'.repeat(64)}`,
  created: 1,
});

function sceneFile(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: SCENE_TYPE,
    version: SCENE_VERSION,
    source: 'https://excalidraw.com',
    elements: [rectangle],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
    ...overrides,
  });
}

describe('storageKey', () => {
  it('is namespaced and versioned so it cannot collide with the theme key', () => {
    expect(storageKey()).toBe('anytools:whiteboard:v1');
    expect(storageKey().startsWith('anytools:')).toBe(true);
  });
});

describe('sceneByteLength', () => {
  it('counts UTF-8 bytes, which is what a storage quota counts', () => {
    expect(sceneByteLength('abc')).toBe(3);
    // One UTF-16 code unit, three UTF-8 bytes — the gap that makes String.length wrong here.
    expect('漢'.length).toBe(1);
    expect(sceneByteLength('漢')).toBe(3);
    // A surrogate pair: two code units, four bytes.
    expect(sceneByteLength('😀')).toBe(4);
  });
});

describe('serializeScene', () => {
  it('writes a valid .excalidraw envelope its own parser accepts', () => {
    const json = serializeScene([rectangle], { viewBackgroundColor: '#fff' });
    const back = parseSceneFile(json);
    expect(back.type).toBe('excalidraw');
    expect(back.version).toBe(SCENE_VERSION);
    expect(back.elements).toEqual([rectangle]);
    expect(back.appState.viewBackgroundColor).toBe('#fff');
  });

  it('drops appState the browser cannot round-trip', () => {
    // collaborators is a Map: JSON.stringify turns it into {} and restoring that breaks
    // Excalidraw. width/height describe the window at save time, not the scene.
    const json = serializeScene([], {
      viewBackgroundColor: '#fff',
      collaborators: new Map([['x', { username: 'x' }]]),
      width: 1440,
      height: 900,
      offsetTop: 220,
      offsetLeft: 0,
      selectedElementIds: { a1: true },
    });
    const back = parseSceneFile(json);
    expect(Object.keys(back.appState)).toEqual(['viewBackgroundColor']);
  });

  it('keeps the drawing preferences worth restoring', () => {
    const back = parseSceneFile(
      serializeScene([], {
        currentItemStrokeColor: '#e03131',
        currentItemFontSize: 28,
        gridModeEnabled: true,
        zoom: { value: 1.5 },
      }),
    );
    expect(back.appState).toEqual({
      currentItemStrokeColor: '#e03131',
      currentItemFontSize: 28,
      gridModeEnabled: true,
      zoom: { value: 1.5 },
    });
  });

  it('copies the element list rather than aliasing the caller array', () => {
    const elements = [rectangle];
    const json = serializeScene(elements);
    elements.push({ ...rectangle, id: 'a2' });
    expect(parseSceneFile(json).elements).toHaveLength(1);
  });

  it('tolerates a scene with no appState and no files', () => {
    const back = parseSceneFile(serializeScene([]));
    expect(back.elements).toEqual([]);
    expect(back.appState).toEqual({});
    expect(back.files).toEqual({});
  });

  it('keeps only the files a live image element still points at', () => {
    // Excalidraw never removes an entry from `files` when an image is deleted, so persisting the
    // map as given leaves every pasted photo in storage forever, eating the 5 MB budget.
    const back = parseSceneFile(
      serializeScene(
        [rectangle, image('kept'), image('erased', { isDeleted: true })],
        {},
        {
          kept: binaryFile('kept'),
          erased: binaryFile('erased'),
          orphan: binaryFile('orphan'),
        },
      ),
    );
    expect(Object.keys(back.files)).toEqual(['kept']);
  });

  it('drops the file bytes, not just the reference, so the saved scene actually shrinks', () => {
    const files = { big: binaryFile('big') };
    const withImage = serializeScene([image('big')], {}, files);
    const afterDelete = serializeScene([image('big', { isDeleted: true })], {}, files);
    expect(afterDelete.length).toBeLessThan(withImage.length);
    expect(afterDelete).not.toContain('data:image/png;base64');
  });

  it('keeps files for an image element that is present and not flagged deleted', () => {
    const json = serializeScene(
      [image('a'), image('b', { isDeleted: false })],
      {},
      {
        a: binaryFile('a'),
        b: binaryFile('b'),
      },
    );
    expect(Object.keys(parseSceneFile(json).files).sort()).toEqual(['a', 'b']);
  });

  it('survives elements that are not objects at all', () => {
    const json = serializeScene([null, 'nope', 42, rectangle], {}, { x: binaryFile('x') });
    expect(parseSceneFile(json).files).toEqual({});
  });
});

describe('stripEmbedElements', () => {
  it('removes both element types Excalidraw renders as an iframe', () => {
    const { elements, removed } = stripEmbedElements([
      rectangle,
      { id: 'e1', type: 'embeddable', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      { id: 'f1', type: 'iframe' },
    ]);
    expect(elements).toEqual([rectangle]);
    expect(removed).toBe(2);
  });

  it('leaves a scene without embeds untouched and reports nothing removed', () => {
    const { elements, removed } = stripEmbedElements([rectangle, image('a')]);
    expect(elements).toEqual([rectangle, image('a')]);
    expect(removed).toBe(0);
  });

  it('ignores entries that are not element objects', () => {
    const { elements, removed } = stripEmbedElements([null, 'embeddable', { type: 7 }]);
    expect(elements).toEqual([null, 'embeddable', { type: 7 }]);
    expect(removed).toBe(0);
  });
});

describe('parseSceneFile', () => {
  it('accepts a scene written by excalidraw.com', () => {
    const scene = parseSceneFile(sceneFile());
    expect(scene.elements).toEqual([rectangle]);
    expect(scene.source).toBe('https://excalidraw.com');
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseSceneFile('<html>nope</html>')).toThrow(/not valid JSON/);
  });

  it('rejects an empty file', () => {
    expect(() => parseSceneFile('   \n ')).toThrow(/empty/);
  });

  it('rejects JSON that is not an object', () => {
    expect(() => parseSceneFile('[1,2,3]')).toThrow(/scene object/);
    expect(() => parseSceneFile('"a string"')).toThrow(/scene object/);
    expect(() => parseSceneFile('null')).toThrow(/scene object/);
  });

  it('names the .excalidrawlib mix-up instead of saying "invalid"', () => {
    const lib = JSON.stringify({ type: 'excalidrawlib', version: 2, libraryItems: [] });
    expect(() => parseSceneFile(lib)).toThrow(/shape library/);
  });

  it('reports what the type field actually said', () => {
    expect(() => parseSceneFile(sceneFile({ type: 'drawing' }))).toThrow(/"drawing"/);
    expect(() => parseSceneFile(sceneFile({ type: undefined }))).toThrow(/says nothing/);
  });

  it('requires a numeric version', () => {
    expect(() => parseSceneFile(sceneFile({ version: '2' }))).toThrow(/no version number/);
    expect(() => parseSceneFile(sceneFile({ version: Number.NaN }))).toThrow(/no version number/);
  });

  it('refuses a scene from a newer Excalidraw', () => {
    expect(() => parseSceneFile(sceneFile({ version: SCENE_VERSION + 1 }))).toThrow(
      /saved by a newer Excalidraw/,
    );
  });

  it('accepts an older version', () => {
    expect(parseSceneFile(sceneFile({ version: 1 })).version).toBe(1);
  });

  it('requires an elements array', () => {
    expect(() => parseSceneFile(sceneFile({ elements: undefined }))).toThrow(/"elements" array/);
    expect(() => parseSceneFile(sceneFile({ elements: {} }))).toThrow(/"elements" array/);
  });

  it('normalises a missing or malformed appState and files to empty objects', () => {
    const scene = parseSceneFile(sceneFile({ appState: 'nope', files: [] }));
    expect(scene.appState).toEqual({});
    expect(scene.files).toEqual({});
  });

  it('refuses a scene over the size cap and says how big it was', () => {
    const padding = 'x'.repeat(MAX_SCENE_BYTES);
    const big = sceneFile({ source: padding });
    let message = '';
    try {
      parseSceneFile(big);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/MB/);
    expect(message).toMatch(/limit is 5 MB/);
  });

  it('measures the cap in UTF-8 bytes, not UTF-16 units', () => {
    // A string of 3-byte characters is over the cap well before its .length is.
    const cjk = '漢'.repeat(Math.ceil(MAX_SCENE_BYTES / 3) + 10);
    expect(cjk.length).toBeLessThan(MAX_SCENE_BYTES);
    expect(() => parseSceneFile(sceneFile({ source: cjk }))).toThrow(/limit is 5 MB/);
  });

  it('tags every refusal with a code the widget can translate', () => {
    const codeOf = (text: string) => {
      try {
        parseSceneFile(text);
      } catch (e) {
        return e instanceof ToolError ? { code: e.code, params: e.params } : null;
      }
      return null;
    };
    expect(codeOf('')).toEqual({ code: 'fileEmpty', params: {} });
    expect(codeOf('<html>')).toEqual({ code: 'notJson', params: {} });
    expect(codeOf('[1]')).toEqual({ code: 'notSceneObject', params: {} });
    expect(codeOf(sceneFile({ type: 'excalidrawlib' }))?.code).toBe('shapeLibrary');
    expect(codeOf(sceneFile({ type: 'drawing' }))).toEqual({
      code: 'wrongType',
      params: { type: 'drawing' },
    });
    expect(codeOf(sceneFile({ type: undefined }))?.code).toBe('missingType');
    expect(codeOf(sceneFile({ version: '2' }))?.code).toBe('noVersion');
    expect(codeOf(sceneFile({ version: SCENE_VERSION + 1 }))).toEqual({
      code: 'newerVersion',
      params: { version: SCENE_VERSION + 1, max: SCENE_VERSION },
    });
    expect(codeOf(sceneFile({ elements: {} }))?.code).toBe('noElements');
    expect(codeOf(sceneFile({ source: 'x'.repeat(MAX_SCENE_BYTES) }))).toEqual({
      code: 'sceneTooBig',
      params: { mb: '5.0', cap: 5 },
    });
  });

  it('filters out embedded frames instead of rejecting the whole file', () => {
    // The route that matters: a hand-made .excalidraw carrying an embeddable would otherwise
    // mount a live iframe the moment the file is opened. Removing the element and saying how
    // many were removed beats refusing a file whose fifty other shapes are fine.
    const scene = parseSceneFile(
      sceneFile({
        elements: [
          rectangle,
          { id: 'e1', type: 'embeddable', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
          { id: 'f1', type: 'iframe', customData: { generationData: { status: 'done' } } },
        ],
      }),
    );
    expect(scene.elements).toEqual([rectangle]);
    expect(scene.removedEmbeds).toBe(2);
    expect(JSON.stringify(scene.elements)).not.toContain('youtube.com');
  });

  it('reports nothing removed for an ordinary scene', () => {
    expect(parseSceneFile(sceneFile()).removedEmbeds).toBe(0);
  });

  it('strips embeds read back out of localStorage too, not only picked files', () => {
    // Same function guards both routes: anything on this origin can write the autosave key.
    const poisoned = JSON.stringify({
      type: SCENE_TYPE,
      version: SCENE_VERSION,
      source: 'https://anytools.world',
      elements: [{ id: 'e1', type: 'embeddable', link: 'https://player.vimeo.com/video/1' }],
      appState: {},
      files: {},
    });
    const scene = parseSceneFile(poisoned);
    expect(scene.elements).toEqual([]);
    expect(scene.removedEmbeds).toBe(1);
  });

  it('accepts a scene just under the cap', () => {
    const json = sceneFile();
    const room = MAX_SCENE_BYTES - new TextEncoder().encode(json).length - 10;
    expect(parseSceneFile(sceneFile({ source: 'x'.repeat(room) })).elements).toHaveLength(1);
  });
});
