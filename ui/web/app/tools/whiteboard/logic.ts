/**
 * Pure helpers for the whiteboard. Everything here runs without Excalidraw loaded, which is
 * what makes it testable: the component itself cannot run under happy-dom (no canvas, no
 * FontFace), so the file-format and storage rules live out here instead of inside the UI.
 *
 * `.excalidraw` is plain JSON with a fixed envelope:
 *   { type: "excalidraw", version: 2, source: "...", elements: [...], appState: {...}, files? }
 * Everything below validates or produces exactly that envelope.
 */

import { ToolError } from '../shared/tool-error';

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

/**
 * The two element types Excalidraw renders as a live `<iframe>` in the page, and the reason this
 * file has an opinion about element contents at all.
 *
 * An `embeddable` carries a URL; an `iframe` carries HTML in `srcdoc`. Both are mounted as real
 * iframes over the canvas, so a `.excalidraw` file — a plain JSON document someone can mail you —
 * would otherwise be able to make this page load and run third-party content the moment it is
 * opened. The editor is configured with `validateEmbeddable={false}`, which stops embeddables
 * being created or rendered, but that prop does not cover `iframe` elements: Excalidraw renders
 * those unconditionally. Dropping both on the way in is the check that does not depend on a prop
 * staying set.
 */
export const EMBED_ELEMENT_TYPES = ['embeddable', 'iframe'] as const;

export type WhiteboardScene = {
  type: typeof SCENE_TYPE;
  version: number;
  source: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

/** A validated scene plus what had to be removed from it to be safe to open. */
export type ParsedScene = WhiteboardScene & { removedEmbeds: number };

/**
 * Remove every element Excalidraw would mount as an iframe, and say how many there were.
 *
 * Removing rather than rejecting the whole file is deliberate: a scene drawn on excalidraw.com
 * may well contain one embedded video among fifty shapes, and refusing to open any of it would
 * be a worse answer than opening the drawing and telling the person what was dropped. The count
 * comes back so the UI can say it out loud instead of quietly changing someone's file.
 */
export function stripEmbedElements(elements: readonly unknown[]): {
  elements: unknown[];
  removed: number;
} {
  const kept: unknown[] = [];
  let removed = 0;
  for (const element of elements) {
    const type =
      typeof element === 'object' && element !== null
        ? (element as { type?: unknown }).type
        : undefined;
    if (typeof type === 'string' && (EMBED_ELEMENT_TYPES as readonly string[]).includes(type)) {
      removed += 1;
      continue;
    }
    kept.push(element);
  }
  return { elements: kept, removed };
}

/**
 * The ids of files still shown on the board: those referenced by an image element that has not
 * been deleted.
 *
 * Excalidraw never drops entries from its `files` map — deleting an image only flags the element
 * `isDeleted`, and the pasted photo stays in memory under the same id so undo can bring it back.
 * Persisting that map wholesale means every screenshot ever pasted here is still eating the
 * origin's ~5 MB storage budget, and the first symptom is autosave failing on an unrelated edit
 * much later. In-session undo is unaffected: the editor keeps its own copy of the files, so an
 * undone delete re-references the file and the next save writes it back.
 */
function referencedFileIds(elements: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const element of elements) {
    if (typeof element !== 'object' || element === null) continue;
    const { type, isDeleted, fileId } = element as {
      type?: unknown;
      isDeleted?: unknown;
      fileId?: unknown;
    };
    if (type !== 'image' || isDeleted === true) continue;
    if (typeof fileId === 'string' && fileId !== '') ids.add(fileId);
  }
  return ids;
}

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
 *
 * `files` is filtered to what the board still shows (see `referencedFileIds`); everything else
 * is copied as given.
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
  const live = referencedFileIds(elements);
  const usedFiles: Record<string, unknown> = {};
  for (const [id, file] of Object.entries(files)) {
    if (live.has(id)) usedFiles[id] = file;
  }
  const scene: WhiteboardScene = {
    type: SCENE_TYPE,
    version: SCENE_VERSION,
    source: 'https://anytools.world',
    elements: [...elements],
    appState: kept,
    files: usedFiles,
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
 * Throws a `ToolError` whose message is written to be shown to the user as-is — every branch
 * says what was wrong with the file rather than "invalid input" — and whose `code` lets the
 * widget render the same complaint in its own language. A `.excalidrawlib` file (a
 * shape library, `type: "excalidrawlib"`) is the mistake people actually make, so it gets
 * named explicitly.
 *
 * Embed elements are FILTERED OUT rather than treated as a reason to reject the file, and the
 * count is reported back in `removedEmbeds` (see `stripEmbedElements`). This is the one place
 * both untrusted routes into the editor meet — a picked `.excalidraw` file and the autosave
 * read back out of localStorage — so it is the one place the rule has to hold.
 */
export function parseSceneFile(text: string): ParsedScene {
  // Size first: a 200 MB string must not reach JSON.parse.
  const bytes = sceneByteLength(text);
  if (bytes > MAX_SCENE_BYTES) {
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    const cap = MAX_SCENE_BYTES / (1024 * 1024);
    throw new ToolError(
      'sceneTooBig',
      `That scene is ${mb} MB. The limit is ${cap} MB — it is too big to open here.`,
      { mb, cap },
    );
  }
  if (text.trim() === '') throw new ToolError('fileEmpty', 'That file is empty.');

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ToolError(
      'notJson',
      'That file is not valid JSON, so it is not an .excalidraw scene.',
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ToolError(
      'notSceneObject',
      'That file does not contain an .excalidraw scene object.',
    );
  }

  const data = raw as Record<string, unknown>;
  if (data.type !== SCENE_TYPE) {
    if (data.type === 'excalidrawlib') {
      throw new ToolError(
        'shapeLibrary',
        'That is an Excalidraw shape library (.excalidrawlib), not a drawing. Open it from the library panel instead.',
      );
    }
    if (typeof data.type === 'string') {
      throw new ToolError(
        'wrongType',
        `Not an Excalidraw scene: its "type" field says "${data.type}", expected "excalidraw".`,
        { type: data.type },
      );
    }
    throw new ToolError(
      'missingType',
      'Not an Excalidraw scene: its "type" field says nothing, expected "excalidraw".',
    );
  }

  const version = data.version;
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    throw new ToolError(
      'noVersion',
      'That scene has no version number, so it cannot be read safely.',
    );
  }
  if (version > SCENE_VERSION) {
    throw new ToolError(
      'newerVersion',
      `That scene is version ${version}; this tool reads up to version ${SCENE_VERSION}. It was saved by a newer Excalidraw.`,
      { version, max: SCENE_VERSION },
    );
  }

  if (!Array.isArray(data.elements)) {
    throw new ToolError('noElements', 'That scene has no "elements" array — nothing to draw.');
  }

  const appState =
    typeof data.appState === 'object' && data.appState !== null && !Array.isArray(data.appState)
      ? (data.appState as Record<string, unknown>)
      : {};
  const files =
    typeof data.files === 'object' && data.files !== null && !Array.isArray(data.files)
      ? (data.files as Record<string, unknown>)
      : {};

  const { elements, removed } = stripEmbedElements(data.elements);

  return {
    type: SCENE_TYPE,
    version,
    source: typeof data.source === 'string' ? data.source : '',
    elements,
    appState,
    files,
    removedEmbeds: removed,
  };
}
