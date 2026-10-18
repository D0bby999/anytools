import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";

/**
 * One page of an uploaded exam paper, drawn by pdf.js in the browser.
 *
 * A figure is shown as its page, never redrawn by a model, and the Go API has
 * no PDF rasteriser: the stored paper comes through the paper resource route
 * and pdf.js renders it here (red team AS-11). pdf.js is imported inside the
 * effect, never at module scope, because this module is also evaluated during
 * server rendering (see reading/pdf-viewer.tsx).
 */
export function PaperPage({ url, page, label }: { url: string; page: number; label: string }) {
  const { t } = useTranslation("study");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    setState("loading");
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      task = pdfjs.getDocument({ url });
      const doc = await task.promise;
      const pdfPage = await doc.getPage(page);
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const width = Math.min(canvas.parentElement?.clientWidth || 720, 720);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale: (width / base.width) * ratio });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${width}px`;
      await pdfPage.render({ canvas, viewport }).promise;
      if (!cancelled) setState("ready");
    })().catch(() => {
      if (!cancelled) setState("failed");
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url, page]);

  return (
    <figure className="mt-3">
      {state === "failed" ? (
        <p role="alert" className="text-sm text-destructive">
          {t("exams.pageFailed", { page })}
        </p>
      ) : (
        <canvas ref={canvasRef} role="img" aria-label={label} className="max-w-full rounded-md border bg-card" />
      )}
      {state === "loading" ? <p className="mt-1 text-xs text-muted-foreground">{t("exams.pageLoading", { page })}</p> : null}
      <figcaption className="text-xs font-semibold mt-1 text-faint">
        {t("exams.pageCaption", { page })}
      </figcaption>
    </figure>
  );
}
