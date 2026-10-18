/**
 * Where the batch C tools' run-time files are served: wasm, models, language data and fonts
 * that a library fetches by URL instead of importing (lib/tools/runtime-files.server.ts).
 *
 * Each folder is `<name>@<version>`, staged from scripts/tool-runtime.json at build time, and
 * served with a year-long immutable cache. The version is in the URL, so upgrading a package
 * means moving its folder name here and in the manifest; staging refuses a folder whose version
 * is not the installed one (scripts/stage-tool-runtime.mjs), and app/test/tool-runtime.test.ts
 * checks that every URL below names a file the manifest stages.
 *
 * A single binary that a package exports is not staged: its loader imports it with `?url`
 * instead, and Vite emits it into /assets/ under a content hash (the jsquash codecs, the barcode
 * reader, the ONNX runtime). Staging is for what a library resolves against a base path, and
 * for files no package carries.
 *
 * Everything comes from this origin. The old site's copies sat under /third-party/.
 */
const BASE = '/tool-runtime/';

export const PDFJS_ASSETS = `${BASE}pdfjs-dist@6.3.289/`;

export const TESSERACT_WORKER = `${BASE}tesseract.js@7.0.0/worker.min.js`;
export const TESSERACT_CORE = `${BASE}tesseract.js-core@7.0.0/`;
export const TESSDATA = `${BASE}tessdata-fast@4.1.0/`;

export const NOTO_SANS = `${BASE}noto-sans@2.015/NotoSans-Regular.ttf`;

export const LIBHEIF_SCRIPT = `${BASE}libheif-js@1.19.8/libheif.js`;
export const LIBHEIF_WASM = `${BASE}libheif-js@1.19.8/libheif.wasm`;

export const U2NETP_MODEL = `${BASE}u2netp@0.0.0/u2netp.onnx`;

/** Excalidraw resolves `fonts/<Family>/<file>.woff2` against this. */
export const EXCALIDRAW_ASSETS = `${BASE}excalidraw-excalidraw@0.18.1/`;
