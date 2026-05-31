import { html as htmlBeautify } from 'js-beautify';

export type HtmlBeautifyOptions = {
  indentSize?: number;
  wrapLineLength?: number;
  preserveNewlines?: boolean;
  maxPreserveNewlines?: number;
  endWithNewline?: boolean;
};

export function beautifyHtml(input: string, options: HtmlBeautifyOptions = {}): string {
  if (!input.trim()) return '';
  return htmlBeautify(input, {
    indent_size: options.indentSize ?? 2,
    wrap_line_length: options.wrapLineLength ?? 0,
    preserve_newlines: options.preserveNewlines ?? true,
    max_preserve_newlines: options.maxPreserveNewlines ?? 2,
    end_with_newline: options.endWithNewline ?? false,
  });
}

export function minifyHtml(input: string): string {
  if (!input.trim()) return '';
  // Conservative minify: strip comments + collapse whitespace between tags
  return input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
