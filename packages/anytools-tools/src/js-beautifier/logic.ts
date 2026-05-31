import { js as jsBeautify } from 'js-beautify';
import { minify } from 'terser';

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
