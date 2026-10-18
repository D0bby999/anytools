/**
 * Excalidraw ships its stylesheet as a package subpath (`"./index.css"` in its exports map,
 * resolved to dist/prod/index.css under webpack's `production` condition). Next's bundler
 * handles that import fine, but TypeScript has no types for a `.css` module and reports
 * "Cannot find module" — and `next-env.d.ts`, which declares `*.css` for the app, is not part
 * of this package's tsconfig program. One ambient declaration, kept next to its only user.
 */
declare module '@excalidraw/excalidraw/index.css';
