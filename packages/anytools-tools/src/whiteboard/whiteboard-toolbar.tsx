'use client';
import { Button } from '@anytools/ui';
import type { RefObject } from 'react';

type Confirming = 'new' | 'import' | null;

type Props = {
  /**
   * The tool's own localized strings and the shared UI strings, passed down rather than looked
   * up here: the parent already resolves them, and re-resolving would double the work on every
   * keystroke that re-renders the board.
   */
  s: Record<string, string>;
  ui: Record<string, string>;
  busy: boolean;
  confirming: Confirming;
  setConfirming: (next: Confirming) => void;
  newBoard: () => void;
  runExport: (kind: 'png' | 'svg' | 'excalidraw') => void;
  openFilePicker: () => void;
  boardHasContent: () => boolean;
  importScene: (file: File | undefined) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

/**
 * The whiteboard's toolbar, split out of a 610-line ui.tsx.
 *
 * Deliberately stateless: every piece of state and every handler stays in the parent and
 * arrives as a prop. The board owns a lazily-loaded Excalidraw API, a debounced localStorage
 * autosave and two baseline refs, and moving any of that down here would mean it remounts when
 * the lazy component resolves — which is how you lose an autosave. Cutting JSX is safe;
 * cutting state is not.
 */
export function WhiteboardToolbar({
  s,
  ui,
  busy,
  confirming,
  setConfirming,
  newBoard,
  runExport,
  openFilePicker,
  boardHasContent,
  importScene,
  fileInputRef,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming === 'new' ? (
        <>
          <span className="text-sm text-muted-foreground">{s.eraseQuestion}</span>
          <Button type="button" variant="outline" size="sm" onClick={newBoard}>
            {s.yesErase}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(null)}>
            {ui.cancel}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirming('new')}
          disabled={busy}
        >
          {s.newBoard}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => runExport('png')}
        disabled={busy}
      >
        {s.exportPng}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => runExport('svg')}
        disabled={busy}
      >
        {s.exportSvg}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => runExport('excalidraw')}
        disabled={busy}
      >
        {s.exportExcalidraw}
      </Button>
      {/*
          Opening a file REPLACES the board, exactly like "New board" does, so it asks first for
          the same reason — but only when there is something to lose. On an empty canvas the
          question would be noise, so the picker opens straight away.
        */}
      {confirming === 'import' ? (
        <>
          <span className="text-sm text-muted-foreground">{s.replaceQuestion}</span>
          <Button type="button" variant="outline" size="sm" onClick={openFilePicker}>
            {s.yesChooseFile}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(null)}>
            {ui.cancel}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (boardHasContent()) setConfirming('import');
            else openFilePicker();
          }}
          disabled={busy}
        >
          {s.openExcalidraw}
        </Button>
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
        aria-label={s.chooseFileAria}
        accept=".excalidraw,application/json"
        className="sr-only"
        onChange={(e) => {
          void importScene(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
