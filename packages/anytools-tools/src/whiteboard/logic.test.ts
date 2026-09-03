import { describe, expect, it } from 'vitest';
import {
  MAX_SCENE_BYTES,
  SCENE_TYPE,
  SCENE_VERSION,
  parseSceneFile,
  sceneByteLength,
  serializeScene,
  storageKey,
} from './logic';

const rectangle = { id: 'a1', type: 'rectangle', x: 10, y: 20, width: 100, height: 60 };

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

  it('accepts a scene just under the cap', () => {
    const json = sceneFile();
    const room = MAX_SCENE_BYTES - new TextEncoder().encode(json).length - 10;
    expect(parseSceneFile(sceneFile({ source: 'x'.repeat(room) })).elements).toHaveLength(1);
  });
});
