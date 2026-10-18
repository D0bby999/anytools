/**
 * pdf-lib object-graph helpers for compress-pdf/logic.ts, split out to keep that file's line
 * count within the tool budget.
 *
 * `PdfLib` below is `typeof import('pdf-lib')` — a TYPE only, erased at compile time. It adds
 * nothing to the runtime bundle; the actual module is still loaded exactly once, dynamically,
 * by `compressPdf`, which passes the live class values in as plain arguments.
 */
type PdfLib = typeof import('pdf-lib');
// PDFRef/PDFName/PDFPage all have PRIVATE constructors (an internal "enforcer" object pattern) —
// InstanceType<> rejects those, so the instance type is read off their public static factory
// instead (`PDFRef.of`, `PDFName.of`, `PDFPage.of`), which returns the same type.
type Ref = ReturnType<PdfLib['PDFRef']['of']>;
type Name = ReturnType<PdfLib['PDFName']['of']>;
type Page = ReturnType<PdfLib['PDFPage']['of']>;

/**
 * Every ref used as an `/SMask` or `/Mask` (a transparency channel) anywhere in the document,
 * mapped to how many TIMES it is used that way. These refs must never be recompressed on their
 * own — see logic.ts's module comment for why. The count also lets a caller that just folded an
 * `/SMask` into a combined image (compress-pdf's FlateDecode path) safely delete the
 * now-orphaned original: only when the count is exactly 1 is it certain nothing else in the
 * document still points to it as a mask.
 */
export function collectMaskRefs(
  objects: [Ref, unknown][],
  PDFRawStream: PdfLib['PDFRawStream'],
  PDFRef: PdfLib['PDFRef'],
  smaskKey: Name,
  maskKey: Name,
): Map<Ref, number> {
  const counts = new Map<Ref, number>();
  for (const [, obj] of objects) {
    if (!(obj instanceof PDFRawStream)) continue;
    for (const key of [smaskKey, maskKey]) {
      const v = obj.dict.get(key);
      if (v instanceof PDFRef) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The size of the first page whose own `/Resources /XObject` dict references `ref` — used only
 * to guess an assumed on-page size for the DPI cap (a scanned page's image is assumed to fill
 * it). Nested Form XObjects are not walked: the common scanned-page case has the image directly
 * on the page.
 */
export function findHostPageSize(
  pages: Page[],
  ref: Ref,
  xObjectKey: Name,
  PDFDict: PdfLib['PDFDict'],
): { width: number; height: number } | null {
  for (const page of pages) {
    const xobjects = page.node.Resources()?.lookupMaybe(xObjectKey, PDFDict);
    if (xobjects?.values().includes(ref)) return page.getSize();
  }
  return null;
}
