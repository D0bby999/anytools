/**
 * Ambient type for sql.js, which ships none of its own (no `types` field in its package.json,
 * and this repo pins no `@types/sql.js`). Declared only as loosely as the real module's default
 * export — `logic.ts` casts the resolved value to a hand-written `SqlJsStatic` covering just the
 * handful of methods this file calls; recreating sql.js's whole API here would just be a second
 * copy of its README to keep in sync.
 *
 * Pulled in by a triple-slash reference from `logic.ts` rather than by `include`: the web app
 * compiles this package's sources through its own tsconfig, whose `include` covers only the app
 * directory, so an ambient file left to be discovered by `include` alone would be found by this
 * package's own typecheck and missed by the app's (same reasoning as
 * docx-to-markdown/office-libs.d.ts).
 */
declare module 'sql.js' {
  const initSqlJs: (config?: { locateFile?: (file: string) => string }) => Promise<unknown>;
  export default initSqlJs;
}
