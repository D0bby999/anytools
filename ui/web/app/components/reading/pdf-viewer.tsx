import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

/**
 * The PDF renderer: one `<section id="page-N" data-page="N">` per page, each a
 * canvas with pdf.js's text layer over it so text can be selected.
 *
 * pdf.js is imported inside an effect, never at module scope: it touches
 * `window` and `DOMMatrix` on import, and this module is also evaluated during
 * server rendering. The server renders nothing but the container.
 *
 * Pages render lazily as they approach the viewport. A 400-page textbook
 * rendered eagerly is 400 canvases and several hundred megabytes before the
 * reader has scrolled once.
 *
 * `page-N` is the anchor every citation resolves against (RT-15): it must
 * exist for EVERY page as soon as the page count is known, rendered or not,
 * or a citation to page 212 would have nothing to scroll to.
 */
export function PdfViewer({
  url,
  initialPage,
  onVisiblePage,
  onFailed,
  label,
}: {
  url: string;
  initialPage?: number;
  onVisiblePage?: (page: number, total: number) => void;
  onFailed?: () => void;
  label: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const pdfjsRef = useRef<PdfJs | null>(null);
  const [layout, setLayout] = useState<{ pages: number; aspect: number } | null>(null);

  // Callbacks are read through refs so a parent re-render does not reload the
  // document or re-create the observers.
  const visibleRef = useRef(onVisiblePage);
  const failedRef = useRef(onFailed);
  visibleRef.current = onVisiblePage;
  failedRef.current = onFailed;

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;

    (async () => {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      // pdf.js 6 has no font `eval` path at all (the CVE-2024-4367 surface),
      // which is why there is no isEvalSupported flag to turn off here.
      task = pdfjs.getDocument({ url });
      const loaded = await task.promise;
      if (cancelled) return;
      const first = await loaded.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      pdfjsRef.current = pdfjs;
      docRef.current = loaded;
      setLayout({ pages: loaded.numPages, aspect: vp.height / vp.width });
    })().catch(() => {
      if (!cancelled) failedRef.current?.();
    });

    return () => {
      cancelled = true;
      docRef.current = null;
      void task?.destroy();
    };
  }, [url]);

  // Lazy rendering and visible-page tracking.
  useEffect(() => {
    const root = rootRef.current;
    if (!layout || !root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>("section[data-page]"));
    const rendered = new Set<number>();

    const renderer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (rendered.has(page)) continue;
          rendered.add(page);
          renderer.unobserve(entry.target);
          void renderPage(entry.target as HTMLElement, page).catch(() => rendered.delete(page));
        }
      },
      { rootMargin: "1200px 0px" },
    );

    const ratios = new Map<number, number>();
    const tracker = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(Number((entry.target as HTMLElement).dataset.page), entry.intersectionRatio);
        }
        let best = 0;
        let bestRatio = 0;
        for (const [page, ratio] of ratios) {
          if (ratio > bestRatio) {
            best = page;
            bestRatio = ratio;
          }
        }
        if (best > 0) visibleRef.current?.(best, layout.pages);
      },
      { threshold: [0, 0.25, 0.5, 0.75] },
    );

    for (const section of sections) {
      renderer.observe(section);
      tracker.observe(section);
    }

    if (initialPage && initialPage > 1) {
      root.querySelector(`#page-${initialPage}`)?.scrollIntoView({ block: "start" });
    }

    return () => {
      renderer.disconnect();
      tracker.disconnect();
    };
    // initialPage is deliberately read once, when the pages first exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  async function renderPage(section: HTMLElement, pageNumber: number) {
    const doc = docRef.current;
    const pdfjs = pdfjsRef.current;
    const slot = section.querySelector<HTMLElement>("[data-slot]");
    if (!doc || !pdfjs || !slot) return;

    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = slot.clientWidth / base.width;
    const viewport = page.getViewport({ scale });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    canvas.setAttribute("aria-hidden", "true");

    slot.style.setProperty("--total-scale-factor", String(scale));
    slot.style.setProperty("--scale-round-x", "1px");
    slot.style.setProperty("--scale-round-y", "1px");
    slot.style.aspectRatio = `${viewport.width} / ${viewport.height}`;

    await page.render({
      canvas,
      viewport,
      transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
    }).promise;

    const text = document.createElement("div");
    text.className = "textLayer";
    const layer = new pdfjs.TextLayer({
      textContentSource: page.streamTextContent(),
      container: text,
      viewport,
    });
    await layer.render();

    slot.replaceChildren(canvas, text);
  }

  return (
    <div ref={rootRef} aria-label={label} className="space-y-6">
      {layout
        ? Array.from({ length: layout.pages }, (_, i) => i + 1).map((n) => (
            <section
              key={n}
              id={`page-${n}`}
              data-page={n}
              aria-labelledby={`page-${n}-label`}
              className="scroll-mt-20"
            >
              {/* The same mono page label the text renderer uses: the page
                  number IS this region's heading. */}
              <h2 id={`page-${n}-label`} className="lp-section mb-2">
                {n}
              </h2>
              <div
                data-slot
                className="relative w-full overflow-hidden rounded-sm border bg-card"
                style={{ aspectRatio: `1 / ${layout.aspect}` }}
              />
            </section>
          ))
        : null}
    </div>
  );
}
