/**
 * Ambient types for two packages that ship no declarations of their own.
 *
 * `mammoth/mammoth.browser.js` — mammoth's typings sit on its Node entry point, and that entry
 * point cannot read a `.docx` from an ArrayBuffer: `lib/unzip.js` accepts only `path` or
 * `buffer`. The prebuilt browser bundle accepts `arrayBuffer`, works unchanged under Node and
 * under a bundler, and is therefore the one both the tool and its tests load. Declared here is
 * only the surface actually used, not the whole library.
 *
 * `turndown-plugin-gfm` — no typings on npm and no `@types` package.
 *
 * Pulled in by a triple-slash reference from `logic.ts` rather than by `include`: the web app
 * compiles this package's sources through its own tsconfig, whose `include` covers only the
 * app directory, so an ambient file left to be discovered would be found by the package's
 * typecheck and missed by the app's.
 */

declare module 'mammoth/mammoth.browser.js' {
  export interface MammothImage {
    contentType: string;
    readAsBase64String(): Promise<string>;
  }

  export interface MammothMessage {
    type: string;
    message: string;
  }

  export interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }

  /** Opaque token produced by `images.imgElement`; mammoth brands it and never exposes it. */
  export interface MammothImageConverter {
    __mammothBrand: 'ImageConverter';
  }

  export interface MammothApi {
    convertToHtml(
      input: { arrayBuffer: ArrayBuffer },
      options?: { convertImage?: MammothImageConverter },
    ): Promise<MammothResult>;
    images: {
      imgElement(
        convert: (image: MammothImage) => Promise<{ src: string; alt?: string }>,
      ): MammothImageConverter;
    };
  }

  export const convertToHtml: MammothApi['convertToHtml'];
  export const images: MammothApi['images'];
  const mammoth: MammothApi;
  export default mammoth;
}

declare module 'turndown-plugin-gfm' {
  export const gfm: import('turndown').Plugin;
  export const tables: import('turndown').Plugin;
  export const strikethrough: import('turndown').Plugin;
  export const taskListItems: import('turndown').Plugin;
  const plugins: { gfm: import('turndown').Plugin };
  export default plugins;
}
