'use client';
/**
 * Multi-file picker with drag-to-drop, drag-to-reorder and per-file removal.
 *
 * Written rather than adapted: image-format-converter, the only prior file tool, holds a
 * single `useState<File | null>`, converts inside a useEffect, and has no drag handling at
 * all — its input carries `accept` and nothing else. Order matters for merging, so the list
 * and its ordering are the component's whole job.
 *
 * The size limit is a WARNING, not a throw. image-format-converter hard-throws above 10 MB,
 * which is right for a photo and wrong for a 200-page scan; PDF work routinely exceeds it and
 * the real constraint is the tab's memory, which no constant knows. So: tell the user a large
 * file may be slow, and let them decide.
 */
import { useCallback, useRef, useState } from 'react';

/** Above this, warn about memory. Not enforced — see the note above. */
export const LARGE_FILE_WARN_BYTES = 100 * 1024 * 1024;

export type MultiFileDropzoneProps = {
  files: File[];
  onChange: (files: File[]) => void;
  /** `accept` attribute, e.g. 'application/pdf' */
  accept: string;
  /** false for tools that operate on exactly one file (rotate, split) */
  multiple?: boolean;
  /** Shown above the control. */
  label: string;
  /** Reordering only makes sense where order changes the output. */
  reorderable?: boolean;
};

const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;

export function MultiFileDropzone({
  files,
  onChange,
  accept,
  multiple = true,
  label,
  reorderable = false,
}: MultiFileDropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accepted = useCallback(
    (incoming: File[]) => {
      // Filter by the same accept list the input enforces — a drop bypasses it entirely.
      const patterns = accept.split(',').map((s) => s.trim().toLowerCase());
      const ok = incoming.filter((f) => {
        const type = f.type.toLowerCase();
        const ext = `.${f.name.split('.').pop()?.toLowerCase() ?? ''}`;
        return patterns.some((p) =>
          // `*/*` (create-zip takes anything at all) matches no rule below — `*/*`.slice(0,-1)
          // is `*/`, which no MIME type starts with — so a drop silently discarded every file.
          p === '*' || p === '*/*'
            ? true
            : p.startsWith('.')
              ? ext === p
              : p.endsWith('/*')
                ? type.startsWith(p.slice(0, -1))
                : type === p,
        );
      });
      onChange(multiple ? [...files, ...ok] : ok.slice(0, 1));
    },
    [accept, files, multiple, onChange],
  );

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= files.length) return;
    const next = [...files];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onChange(next);
  };

  const oversized = files.filter((f) => f.size > LARGE_FILE_WARN_BYTES);

  return (
    <div className="space-y-3">
      <span className="block text-sm text-muted-foreground">{label}</span>

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the nested <input type=file> is the keyboard path; this div is a pointer-only convenience */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          accepted([...e.dataTransfer.files]);
        }}
        onClick={() => inputRef.current?.click()}
        className={`rounded-md border-2 border-dashed px-4 py-8 text-center text-sm transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-input'
        }`}
      >
        <p className="text-muted-foreground">
          Drop {multiple ? 'files' : 'a file'} here, or click to choose
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          // The input is a descendant of the clickable container above, and
          // HTMLElement.click() dispatches a BUBBLING click — without this the container's
          // handler re-enters and re-opens the file dialog.
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            accepted([...(e.target.files ?? [])]);
            // Allow re-selecting the same file after a removal.
            e.target.value = '';
          }}
          className="sr-only"
        />
      </div>

      {oversized.length > 0 && (
        <output className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {oversized.length === 1 ? 'This file is' : 'Some files are'} over{' '}
          {fmtSize(LARGE_FILE_WARN_BYTES)}. Everything runs in this tab, so a file that large may be
          slow or run the tab out of memory. It will still be attempted.
        </output>
      )}

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li
              key={`${i}-${f.name}-${f.size}-${f.lastModified}`}
              draggable={reorderable}
              onDragStart={() => {
                dragIndex.current = i;
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex.current !== null) move(dragIndex.current, i);
                dragIndex.current = null;
              }}
              className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"
            >
              {reorderable && (
                <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{i + 1}.</span>
              )}
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-muted-foreground">{fmtSize(f.size)}</span>
              {reorderable && files.length > 1 && (
                // Buttons as well as dragging: dragging is unusable on touch and with a
                // keyboard, and reordering is the whole point of the merge tool.
                <>
                  <button
                    type="button"
                    onClick={() => move(i, i - 1)}
                    disabled={i === 0}
                    aria-label={`Move ${f.name} up`}
                    className="shrink-0 rounded px-1 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, i + 1)}
                    disabled={i === files.length - 1}
                    aria-label={`Move ${f.name} down`}
                    className="shrink-0 rounded px-1 disabled:opacity-30"
                  >
                    ↓
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                aria-label={`Remove ${f.name}`}
                className="shrink-0 rounded px-1 text-muted-foreground hover:text-destructive"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
