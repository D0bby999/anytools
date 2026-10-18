import beautify from 'js-beautify';
import { minify } from 'terser';

// js-beautify is CommonJS: Node's ESM loader (the production server) refuses
// named imports from it, so take the function off the default export.
const jsBeautify = beautify.js;

export type JsBeautifyOptions = {
  indentSize?: number;
  preserveNewlines?: boolean;
  endWithNewline?: boolean;
};

export type JsMinifyOptions = {
  mangle?: boolean;
  compress?: boolean;
  module?: boolean;
};

export function beautifyJs(input: string, options: JsBeautifyOptions = {}): string {
  if (!input.trim()) return '';
  return jsBeautify(input, {
    indent_size: options.indentSize ?? 2,
    preserve_newlines: options.preserveNewlines ?? true,
    end_with_newline: options.endWithNewline ?? false,
  });
}

export async function minifyJs(
  input: string,
  options: JsMinifyOptions = {},
): Promise<{ code: string; sizeBefore: number; sizeAfter: number }> {
  if (!input.trim()) {
    return { code: '', sizeBefore: 0, sizeAfter: 0 };
  }
  const result = await minify(input, {
    mangle: options.mangle ?? true,
    compress: options.compress ?? true,
    module: options.module ?? false,
  });
  const code = result.code ?? '';
  return {
    code,
    sizeBefore: input.length,
    sizeAfter: code.length,
  };
}
