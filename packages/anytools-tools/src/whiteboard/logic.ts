/**
 * Pure helpers for the whiteboard. Everything here runs without Excalidraw loaded, which is
 * what makes it testable: the component itself cannot run under happy-dom (no canvas, no
 * FontFace), so the file-format and storage rules live out here instead of inside the UI.
 *
 * `.excalidraw` is plain JSON with a fixed envelope:
 *   { type: "excalidraw", version: 2, source: "...", elements: [...], appState: {...}, files? }
 * Everything below validates or produces exactly that envelope.
 */

/** The `type` discriminator every `.excalidraw` file carries. */
export const SCENE_TYPE = 'excalidraw';

/** Envelope version Excalidraw has written since 2020 and the newest we know how to read. */
export const SCENE_VERSION = 2;

/**
 * Refuse scenes above this before parsing them. Two reasons: `JSON.parse` on a large string
 * blocks the main thread with no way to cancel, and localStorage in every browser tops out
 * around 5–10 MB per origin, so a scene bigger than this could never have been autosaved
 * anyway. Picking the file is the moment to say so, not the moment it silently fails to save.
 */
export const MAX_SCENE_BYTES = 5 * 1024 * 1024;

export type WhiteboardScene = {
  type: typeof SCENE_TYPE;
  version: number;
  source: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

/**
 * localStorage key for the autosaved board. Namespaced and versioned: `anytools:` keeps it
 * clear of anything else on the origin (the theme uses `anytools:theme`), and the trailing
 * `:v1` means a future change to what we store can start clean instead of trying to migrate
 * a shape it no longer understands.
 */
export function storageKey(): string {
  return 'anytools:whiteboard:v1';
}

const KEPT_APP_STATE = [
  'viewBackgroundColor',
  'gridSize',
  'gridModeEnabled',
  'currentItemStrokeColor',
  'currentItemBackgroundColor',
  'currentItemFontFamily',
  'currentItemFontSize',
  'currentItemStrokeWidth',
  'currentItemRoughness',
  'currentItemOpacity',
  'zoom',
  'scrollX',
  'scrollY',
] as const;

/**
 * Build the JSON we autosave. Deliberately NOT Excalidraw's `serializeAsJSON`: the live
 * appState carries values that must not be persisted — `collaborators` is a Map (JSON.stringify
 * turns it into `{}`), and `width`/`height`/`offsetTop`/`offsetLeft` describe the viewport that
 * happened to be on screen when the save fired, so restoring them on a different window size
 * puts the scene off-screen. Only the fields below survive a reload usefully.
 *
 * The exported `.excalidraw` file is a different thing and does use `serializeAsJSON` — that
 * one has to be readable by excalidraw.com, so it must carry the full appState Excalidraw
 * writes itself.
 */
export function serializeScene(
  elements: readonly unknown[],
  appState: Readonly<Record<string, unknown>> = {},
  files: Readonly<Record<string, unknown>> = {},
): string {
  const kept: Record<string, unknown> = {};
  for (const key of KEPT_APP_STATE) {
    if (appState[key] !== undefined) kept[key] = appState[key];
  }
  const scene: WhiteboardScene = {
    type: SCENE_TYPE,
    version: SCENE_VERSION,
    source: 'https://anytools.world',
    elements: [...elements],
    appState: kept,
    files: { ...files },
  };
  return JSON.stringify(scene);
}

/**
 * Size of a scene as the browser will store it: UTF-8 bytes, not UTF-16 code units.
 *
 * `String.length` under-reports by up to 3x — a CJK label is one code unit and three bytes —
 * and localStorage quotas are counted in bytes. Both the import guard and the autosave guard
 * use this so they agree on what "5 MB" means.
 */
export function sceneByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Parse and validate a `.excalidraw` file (or our own autosave, which uses the same envelope).
 *
 * Throws an `Error` whose message is written to be shown to the user as-is — every branch
 * says what was wrong with the file rather than "invalid input". A `.excalidrawlib` file (a
 * shape library, `type: "excalidrawlib"`) is the mistake people actually make, so it gets
 * named explicitly.
 */
export function parseSceneFile(text: string): WhiteboardScene {
  // Size first: a 200 MB string must not reach JSON.parse.
  const bytes = sceneByteLength(text);
  if (bytes > MAX_SCENE_BYTES) {
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    const cap = MAX_SCENE_BYTES / (1024 * 1024);
    throw new Error(`That scene is ${mb} MB. The limit is ${cap} MB — it is too big to open here.`);
  }
  if (text.trim() === '') throw new Error('That file is empty.');

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON, so it is not an .excalidraw scene.');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('That file does not contain an .excalidraw scene object.');
  }

  const data = raw as Record<string, unknown>;
  if (data.type !== SCENE_TYPE) {
    if (data.type === 'excalidrawlib') {
      throw new Error(
        'That is an Excalidraw shape library (.excalidrawlib), not a drawing. Open it from the library panel instead.',
      );
    }
    const got = typeof data.type === 'string' ? `"${data.type}"` : 'nothing';
    throw new Error(
      `Not an Excalidraw scene: its "type" field says ${got}, expected "excalidraw".`,
    );
  }

  const version = data.version;
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    throw new Error('That scene has no version number, so it cannot be read safely.');
  }
  if (version > SCENE_VERSION) {
    throw new Error(
      `That scene is version ${version}; this tool reads up to version ${SCENE_VERSION}. It was saved by a newer Excalidraw.`,
    );
  }

  if (!Array.isArray(data.elements)) {
    throw new Error('That scene has no "elements" array — nothing to draw.');
  }

  const appState =
    typeof data.appState === 'object' && data.appState !== null && !Array.isArray(data.appState)
      ? (data.appState as Record<string, unknown>)
      : {};
  const files =
    typeof data.files === 'object' && data.files !== null && !Array.isArray(data.files)
      ? (data.files as Record<string, unknown>)
      : {};

  return {
    type: SCENE_TYPE,
    version,
    source: typeof data.source === 'string' ? data.source : '',
    elements: data.elements,
    appState,
    files,
  };
}
