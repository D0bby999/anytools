'use client';
import type { ReactNode } from 'react';

type Props = {
  title?: string;
  description?: string;
  /** The file picker. Tool-owned because `accept`, `multiple` and the label all differ. */
  dropzone: ReactNode;
  /** Settings that shape the output. Rendered between the files and the run button. */
  options?: ReactNode;
  /** The run control, plus anything that belongs beside it. */
  action?: ReactNode;
  /**
   * Whatever the tool has to say while it works — a spinner line, a per-page counter, a
   * cancel button. Deliberately a free slot rather than a `busy: boolean` and a fixed bar:
   * `ocr-pdf` reports progress per page and `remove-background` needs a cancel control, and
   * a template that only understands "busy" would push both of them back out again.
   */
  progress?: ReactNode;
  error?: ReactNode;
  /**
   * Before/after view that updates as the options change, shown between the action and the
   * result. Added for the image cluster, where seeing the effect of a slider is the point;
   * the PDF tools leave it empty.
   */
  preview?: ReactNode;
  /** Result summary and the download control. */
  result?: ReactNode;
  disclaimer?: ReactNode;
};

/**
 * Drop files → set options → run → see progress → take the result.
 *
 * Written for the PDF cluster, where all twelve tools were hand-rolling that sequence, and
 * reused by the image cluster, which added the `preview` slot. The order is the layout contract's: input,
 * then the options that shape it, then the action, then what came out.
 *
 * There is no Card here, matching the other tool templates — see `docs`/MASTER.md on why
 * template-rendered tools sit bare on the page.
 */
export function FilePipelineTemplate({
  title,
  description,
  dropzone,
  options,
  action,
  progress,
  error,
  preview,
  result,
  disclaimer,
}: Props) {
  return (
    <div className="space-y-6">
      {(title || description) && (
        <header>
          {title && <h2 className="mb-1 text-2xl font-semibold">{title}</h2>}
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </header>
      )}

      {dropzone}

      {options && <div className="space-y-3">{options}</div>}

      {(action || progress) && (
        <div className="flex flex-wrap items-center gap-3">
          {action}
          {progress}
        </div>
      )}

      {error}

      {preview}

      {result && <div className="space-y-3">{result}</div>}

      {/* A div, not a p — the same nested-paragraph trap the other templates hit: the obvious
          thing to pass here is PrivacyNote, which renders its own paragraph. */}
      {disclaimer && (
        <div className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
          {disclaimer}
        </div>
      )}
    </div>
  );
}
