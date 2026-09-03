# Fixtures for verifying file tools in a real browser

Everything in this directory except this file and `manual/.gitkeep` is gitignored.

## Generated — run `pnpm --filter @anytools/tools exec node scripts/make-fixtures.mjs`

| File | Exercises |
|---|---|
| `text-3p.pdf` | three text pages, page 2 has `/Rotate 90` |
| `images-shared.pdf` | one PNG drawn on all three pages — the `g_`/`commonObjs` path and image de-duplication |
| `cjk.pdf` | Japanese text in a non-embedded font via `UniJIS-UCS2-H` — needs `/third-party/pdfjs/cmaps/`; renders blank text by design (fonts are never installed from a document) |

## Manual — owner drops real files into `manual/`

We cannot synthesise these cleanly. A tool whose phase needs one is not verified until it exists here.

| File | Needed by | What it should contain |
|---|---|---|
| `manual/photo.heic` | heic-to-jpg | an iPhone photo, ideally a Live Photo, taken in portrait so EXIF rotation matters |
| `manual/doc.docx` | docx-to-markdown | headings, a table, a bulleted list, one image |
| `manual/book.xlsx` | xlsx-to-csv | two sheets, a date column, a cell containing a comma and a quote |
| `manual/scan.pdf` | ocr-pdf | a real 3–5 page scanned document in English |
| `manual/archive.rar`, `manual/archive.7z` | unzip-archive | a few files in a folder; one password-protected zip is also useful |
| `manual/portrait.jpg`, `product.jpg`, `pet.jpg`, `hair.jpg` | remove-background quality gate | the four cases the gate scores |

See `docs/tool-runtime-verification.md` for the lane itself.
