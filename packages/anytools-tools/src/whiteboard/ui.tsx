'use client';
import '@excalidraw/excalidraw/index.css';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote } from '@anytools/ui';
import type { ImportedDataState } from '@excalidraw/excalidraw/data/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  MAX_SCENE_BYTES,
  type WhiteboardScene,
  parseSceneFile,
  sceneByteLength,
  serializeScene,
  storageKey,
} from './logic';

/**
 * Where Excalidraw looks for its canvas fonts (Excalifont, Virgil, Cascadia, Xiaolai…).
 *
 * Verified against the installed 0.18.1 bundle, not guessed: `ExcalidrawFontFace.createUrls`
 * resolves each descriptor's `./fonts/<Family>/<file>.woff2` against this base, so the staged
 * files must sit at `<ASSET_PATH>/fonts/…` — vendor-assets.json copies the package's
 * `dist/prod/fonts` directory to `public/third-party/excalidraw/fonts` for exactly that.
 * (The 0.17-era layout that put them under `<ASSET_PATH>/dist/prod/fonts` is gone.)
 *
 * This is not a nicety. `createUrls` always appends the package's own upstream CDN as a SECOND
 * `src` inside the same FontFace, so a font missing from our origin does not fail visibly — the
 * browser silently falls through and fetches it from that third party instead. Setting this
 * correctly is the difference between "nothing leaves your device" being true and being a claim.
 * (The CDN host is deliberately not written here: `vendor-assets.test.ts` greps this tree for
 * CDN hostnames precisely to stop one being reintroduced, and it should stay able to.)
 */
const EXCALIDRAW_ASSET_PATH = '/third-party/excalidraw/';

type WindowWithAssetPath = Window & { EXCALIDRAW_ASSET_PATH?: string | string[] };

// Must be set before the Excalidraw module is EVALUATED: it builds its FontFace objects at
// module scope, and each one bakes the URL list in at construction. Hence the module below is
// a `lazy()` import rather than a static one — a static import is hoisted above this line by
// the ES module semantics and would read an unset value.
if (typeof window !== 'undefined') {
  (window as WindowWithAssetPath).EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH;
}

// React.lazy rather than next/dynamic: `next` is not a dependency of this package, and the
// renderer that mounts this tool already loads it with `{ ssr: false }`, so there is no server
// pass to opt out of here.
const Excalidraw = lazy(() =>
  import('@excalidraw/excalidraw').then((m) => ({ default: m.Excalidraw })),
);

type ExportKind = 'png' | 'svg' | 'excalidraw';
type ExportResult = { url: string; filename: string; kind: ExportKind };

/**
 * The single point where validated-but-untyped JSON becomes Excalidraw data.
 *
 * `parseSceneFile` checks the envelope — type, version, elements-is-an-array — and deliberately
 * says nothing about individual elements, because Excalidraw's own `restore()` is the thing
 * written to survive them: unknown element types, missing properties, shapes from a version
 * that did not exist when this was written. Re-implementing that here would be a worse copy of
 * it. So the elements stay `unknown` through the validator and get their real type once, here,
 * on the way into a function built to handle whatever they turn out to be.
 */
function toExcalidrawData(scene: WhiteboardScene): ImportedDataState {
  return {
    elements: scene.elements,
    appState: scene.appState,
    files: scene.files,
  } as ImportedDataState;
}

/**
 * Read the autosaved board. Any failure means "start empty" — never a crashed tool page.
 *
 * The raw string comes back alongside the parsed scene because it is what the next save has to
 * compare against: knowing exactly what is in storage is what lets a save that fails leave the
 * older copy there and keep saying so, instead of assuming a write it never made.
 *
 * The scene goes through `parseSceneFile` like a picked file does, so localStorage gets no more
 * trust than a downloaded `.excalidraw`: anything on this origin can write that key, and embed
 * elements are stripped here too.
 */
function loadSavedScene(): { data: ImportedDataState; raw: string } | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey());
  } catch {
    // Safari in private mode throws on localStorage access itself.
    return null;
  }
  if (!raw) return null;
  try {
    return { data: toExcalidrawData(parseSceneFile(raw)), raw };
  } catch {
    return null;
  }
}

const AUTOSAVE_DEBOUNCE_MS = 500;

const buttonClass =
  'inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-40';

export function WhiteboardUi() {
  const objectUrls = useObjectUrls();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tracked = useRef(false);
  // The scene JSON believed to be in localStorage right now — set from what was read at mount and
  // then ONLY after a write actually succeeds. A failed write must not advance it: if it did, the
  // next edit would compare equal, skip the write, and leave the older scene sitting in storage to
  // be silently restored on reload.
  const lastSaved = useRef<string | null>(null);
  // JSON of the elements as last seen. Only used to decide whether the person actually drew
  // something, which is what `tool_run` means; appState-only changes (panning, colours) are saved
  // but are not a run.
  const drawnBaseline = useRef('[]');

  const [initial] = useState<ImportedDataState | null>(() => {
    const scene = loadSavedScene();
    if (!scene) return null;
    lastSaved.current = scene.raw;
    drawnBaseline.current = JSON.stringify(scene.data.elements ?? []);
    return scene.data;
  });
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from `error`: that one reports what an action the person just took did, and any
  // next action clears it. This one is a standing condition — the board is not being saved — and
  // it has to stay on screen until a save succeeds or the board is emptied.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'new' | 'import' | null>(null);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [busy, setBusy] = useState(false);

  // next-themes writes the resolved theme as a class on <html> (`attribute="class"` in
  // ThemeProvider). Reading that class is how a package outside the app learns the theme
  // without taking a dependency on next-themes; it is the same value useTheme() would give.
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.classList.contains('dark') ? 'dark' : 'light');
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const trackOnce = useCallback(() => {
    if (tracked.current) return;
    tracked.current = true;
    trackEvent('tool_run', { tool: 'whiteboard' });
  }, []);

  /** What is (or is not) in storage while a save is failing — the half people need to hear. */
  const staleCopyNote = useCallback(
    () =>
      lastSaved.current
        ? 'The copy in this browser is an earlier version of it.'
        : 'Nothing is saved in this browser yet.',
    [],
  );

  const handleChange = useCallback(
    (elements: readonly unknown[], appState: unknown, files: unknown) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        // An untouched board with nothing already in storage stays out of storage. This is the
        // state on a first visit — Excalidraw fires onChange once while mounting — and the state
        // right after "New board", which has just deleted the key on purpose. Without this, both
        // would put an empty scene back.
        if (elements.length === 0 && lastSaved.current === null) return;

        const elementsJson = JSON.stringify(elements);
        if (elementsJson !== drawnBaseline.current) {
          drawnBaseline.current = elementsJson;
          trackOnce();
        }

        // Compare the whole payload, not just the elements: the background colour, grid, zoom and
        // scroll position are part of what gets persisted, so an appState-only change is a real
        // change. Comparing elements alone is why a new background colour used to survive until
        // the next reload and no further.
        const json = serializeScene(
          elements,
          (appState ?? {}) as Record<string, unknown>,
          (files ?? {}) as Record<string, unknown>,
        );
        if (json === lastSaved.current) return;

        // Pasted images live in `files` as data URLs, so a board with photos on it can pass
        // the ~5 MB localStorage budget quickly. Say so rather than let setItem throw on a
        // later, unrelated edit — and keep saying it, because until the board gets smaller
        // every later edit is unsaved too.
        if (sceneByteLength(json) > MAX_SCENE_BYTES) {
          setStatus(null);
          setSaveError(
            `This board is past the ${MAX_SCENE_BYTES / (1024 * 1024)} MB browser-storage limit, so it is no longer being saved. ${staleCopyNote()} Export it as .excalidraw to keep this version.`,
          );
          return;
        }
        try {
          window.localStorage.setItem(storageKey(), json);
          lastSaved.current = json;
          setSaveError(null);
          setStatus('Saved in this browser');
        } catch {
          setStatus(null);
          setSaveError(
            `Could not save the board — browser storage is full or blocked. ${staleCopyNote()} Export it as .excalidraw to keep this version.`,
          );
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [staleCopyNote, trackOnce],
  );

  const newBoard = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    api.resetScene();
    api.history.clear();
    drawnBaseline.current = '[]';
    lastSaved.current = null;
    try {
      window.localStorage.removeItem(storageKey());
    } catch {
      // Nothing to clean up if storage is unavailable; the canvas is already empty.
    }
    setConfirming(null);
    setExported((prev) => {
      objectUrls.revoke(prev?.url);
      return null;
    });
    setError(null);
    setSaveError(null);
    setStatus('New board');
  }, [objectUrls]);

  /** Is there anything on the canvas that an import would replace? */
  const boardHasContent = useCallback(
    () => (apiRef.current?.getSceneElements().length ?? 0) > 0,
    [],
  );

  const openFilePicker = useCallback(() => {
    setConfirming(null);
    fileInputRef.current?.click();
  }, []);

  const runExport = useCallback(
    async (kind: ExportKind) => {
      const api = apiRef.current;
      if (!api) return;
      setBusy(true);
      setError(null);
      trackOnce();
      try {
        const elements = api.getSceneElements();
        if (elements.length === 0) throw new Error('The board is empty — draw something first.');
        const appState = api.getAppState();
        const files = api.getFiles();
        const mod = await import('@excalidraw/excalidraw');

        let blob: Blob;
        if (kind === 'png') {
          blob = await mod.exportToBlob({
            elements,
            appState,
            files,
            mimeType: 'image/png',
            exportPadding: 16,
          });
        } else if (kind === 'svg') {
          // Font inlining is left on: without it the SVG's text falls back to a system font
          // anywhere Excalifont is not installed, which is everywhere.
          //
          // Known console line on the FIRST svg export of a board containing text: Excalidraw
          // subsets the fonts in a module worker whose URL it derives from `import.meta.url`,
          // and webpack rewrites that to a `file://` path, so constructing the worker throws
          // SecurityError. Excalidraw catches it, logs "Failed to use workers for subsetting,
          // falling back to the main thread", sets its own flag so it never retries, and subsets
          // on the main thread instead. Nothing here can supply a different worker URL; the two
          // error types Excalidraw suppresses the log for are not reachable from outside.
          //
          // Measured, rather than assumed: two consecutive exports of the same board — the one
          // that logs the fallback and the one after it, which does not — are byte-identical
          // (sha256 f091c325…, 3 363 B, fonts inlined in both). What is NOT measured is worker
          // output against main-thread output: the worker never constructs in this build, so
          // there is nothing to compare it with. Treat "the fallback matches the worker" as
          // unverified rather than true.
          const svg = await mod.exportToSvg({ elements, appState, files, exportPadding: 16 });
          blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
        } else {
          // The .excalidraw file has to be readable by other Excalidraw instances, so it uses
          // the library's own serializer — not serializeScene, which trims appState for storage.
          blob = new Blob([mod.serializeAsJSON(elements, appState, files, 'local')], {
            type: 'application/json',
          });
        }

        setExported((prev) => {
          objectUrls.revoke(prev?.url);
          return { url: objectUrls.create(blob), filename: `whiteboard.${kind}`, kind };
        });
        setStatus(null);
      } catch (e) {
        setExported((prev) => {
          objectUrls.revoke(prev?.url);
          return null;
        });
        setError(e instanceof Error ? e.message : 'Could not export the board.');
      } finally {
        setBusy(false);
      }
    },
    [objectUrls, trackOnce],
  );

  const importScene = useCallback(
    async (file: File | undefined) => {
      const api = apiRef.current;
      if (!api || !file) return;
      setBusy(true);
      setError(null);
      try {
        if (file.size > MAX_SCENE_BYTES) {
          throw new Error(
            `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is ${MAX_SCENE_BYTES / (1024 * 1024)} MB.`,
          );
        }
        const scene = parseSceneFile(await file.text());
        const data = toExcalidrawData(scene);
        // `restore` upgrades elements written by older Excalidraw versions and drops anything
        // malformed. Passing raw file contents to updateScene puts the editor in a state it
        // cannot render.
        const { restore } = await import('@excalidraw/excalidraw');
        const restored = restore(data, null, null);
        api.updateScene({ elements: restored.elements });
        api.addFiles(Object.values(restored.files));
        api.scrollToContent(restored.elements, { fitToContent: true });
        trackOnce();
        // Replaced by "Saved in this browser" half a second later, when the autosave the import
        // just triggered lands. Both are true and the later one is the one worth leaving on
        // screen; this names the file so a mis-picked one is obvious immediately.
        //
        // Anything the parser had to drop is named rather than left for the person to notice a
        // missing box: their file was changed on the way in, and being told why is the point.
        setStatus(
          scene.removedEmbeds > 0
            ? `Opened ${file.name} — removed ${scene.removedEmbeds} embedded ${
                scene.removedEmbeds === 1 ? 'frame' : 'frames'
              }, which this board does not load.`
            : `Opened ${file.name}`,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not open that file.');
      } finally {
        setBusy(false);
      }
    },
    [trackOnce],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Online whiteboard</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {confirming === 'new' ? (
            <>
              <span className="text-sm text-muted-foreground">Erase this board?</span>
              <button type="button" onClick={newBoard} className={buttonClass}>
                Yes, erase it
              </button>
              <button type="button" onClick={() => setConfirming(null)} className={buttonClass}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming('new')}
              className={buttonClass}
              disabled={busy}
            >
              New board
            </button>
          )}
          <button
            type="button"
            onClick={() => runExport('png')}
            className={buttonClass}
            disabled={busy}
          >
            Export PNG
          </button>
          <button
            type="button"
            onClick={() => runExport('svg')}
            className={buttonClass}
            disabled={busy}
          >
            Export SVG
          </button>
          <button
            type="button"
            onClick={() => runExport('excalidraw')}
            className={buttonClass}
            disabled={busy}
          >
            Export .excalidraw
          </button>
          {/*
            Opening a file REPLACES the board, exactly like "New board" does, so it asks first for
            the same reason — but only when there is something to lose. On an empty canvas the
            question would be noise, so the picker opens straight away.
          */}
          {confirming === 'import' ? (
            <>
              <span className="text-sm text-muted-foreground">Replace this board with a file?</span>
              <button type="button" onClick={openFilePicker} className={buttonClass}>
                Yes, choose a file
              </button>
              <button type="button" onClick={() => setConfirming(null)} className={buttonClass}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (boardHasContent()) setConfirming('import');
                else openFilePicker();
              }}
              className={buttonClass}
              disabled={busy}
            >
              Open .excalidraw
            </button>
          )}
          {/*
            Driven by the button above rather than a <label for>, because the button has to decide
            whether to ask first. It keeps an aria-label: the input stays in the accessibility tree
            (sr-only, not hidden), and the label it used to borrow from the <label> is gone.
          */}
          <input
            ref={fileInputRef}
            id="whiteboard-import"
            type="file"
            aria-label="Choose an .excalidraw file to open"
            accept=".excalidraw,application/json"
            className="sr-only"
            onChange={(e) => {
              void importScene(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}
        {saveError && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {saveError}
          </output>
        )}
        {!error && !saveError && status && (
          <output className="block text-sm text-muted-foreground">{status}</output>
        )}

        {exported && (
          <a
            href={exported.url}
            download={exported.filename}
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Download {exported.filename}
          </a>
        )}

        {/*
          Excalidraw needs a container with a real height; it fills 100% of whatever it is given.
          The arbitrary variant hides the one control in the editor that leaves this origin —
          "Browse libraries", a link to libraries.excalidraw.com. Everything else in the library
          panel is local: importing an .excalidrawlib file from disk still works.
        */}
        <div className="anytools-whiteboard h-[70vh] min-h-[520px] w-full overflow-hidden rounded-md border [&_.library-menu-browse-button]:hidden">
          {/*
            "Web Embed" sits in the toolbar's "More tools" dropdown and, left alone, drops an
            iframe onto the canvas. `validateEmbeddable={false}` below already stops anything
            being embedded, so the entry can only produce a "cannot embed" toast — hide it rather
            than leave a control that does nothing.

            This is a stylesheet rather than an arbitrary Tailwind variant (the trick used for the
            library button above) because the selector cannot be written as a class: Excalidraw
            0.18.1 gives BOTH the Web Embed item and the Mermaid item the same
            `data-testid="toolbar-embeddable"`, so the testid alone would also hide Mermaid, which
            is local and worth keeping. Position within the dropdown is the only thing separating
            them. Being doubly anchored means a future reorder makes the rule match nothing and
            the entry comes back — cosmetic, not a hole: the prop is what does the blocking.
          */}
          <style>
            {
              '.anytools-whiteboard .App-toolbar__extra-tools-dropdown button[data-testid="toolbar-embeddable"]:nth-of-type(2){display:none}'
            }
          </style>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading the board…
              </div>
            }
          >
            <Excalidraw
              excalidrawAPI={(api) => {
                apiRef.current = api;
              }}
              initialData={initial}
              onChange={handleChange}
              theme={theme}
              langCode="en"
              name="anytools-whiteboard"
              // Every network feature Excalidraw ships, switched off explicitly.
              // isCollaborating stays false and no LiveCollaborationTrigger is rendered, so the
              // editor never opens a socket. aiEnabled defaults to TRUE and adds the
              // "wireframe to code" action, which posts the canvas to oss-ai.excalidraw.com.
              // libraryReturnUrl is deliberately unset: setting it is what turns the library
              // panel into an OAuth-ish round trip through libraries.excalidraw.com.
              //
              // validateEmbeddable decides which links may become live iframes on the canvas.
              // UNSET IS NOT OFF: Excalidraw then falls back to its own allowlist — YouTube,
              // Vimeo, Figma, X, gists, Giphy, Reddit, val.town, StackBlitz and more — and three
              // routes reach it, all of them without a prompt: the Web Embed tool, pasting a URL
              // (auto-converted to an embed), and opening a .excalidraw file that already
              // contains one. `false` is the documented "never" (`embeddableURLValidator` returns
              // it verbatim for a boolean), so no embed is created, validated or rendered. Not
              // sufficient on its own: `iframe` elements render regardless of this prop, which is
              // why parseSceneFile strips both kinds before anything reaches the editor.
              isCollaborating={false}
              aiEnabled={false}
              validateEmbeddable={false}
              autoFocus={false}
              UIOptions={{
                canvasActions: {
                  loadScene: true,
                  export: { saveFileToDisk: true },
                  saveAsImage: true,
                  changeViewBackgroundColor: true,
                  clearCanvas: true,
                  saveToActiveFile: false,
                  // The page theme drives the canvas theme; a second toggle inside the canvas
                  // would be overwritten the next time the site theme changed.
                  toggleTheme: false,
                },
              }}
              renderTopRightUI={(isMobile) =>
                isMobile ? null : (
                  <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
                    Saved in this browser only
                  </span>
                )
              }
            />
          </Suspense>
        </div>

        <p className="text-sm text-muted-foreground">
          The board autosaves to this browser&rsquo;s storage about half a second after you stop
          drawing. Clearing site data erases it. Export a <code>.excalidraw</code> file to keep a
          copy you can reopen here or on excalidraw.com.
        </p>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
