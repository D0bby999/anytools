import { css as cssBeautify } from 'js-beautify';

export type CssBeautifyOptions = {
  indentSize?: number;
  selectorSeparatorNewline?: boolean;
  newlineBetweenRules?: boolean;
  endWithNewline?: boolean;
};

export function beautifyCss(input: string, options: CssBeautifyOptions = {}): string {
  if (!input.trim()) return '';
  return cssBeautify(input, {
    indent_size: options.indentSize ?? 2,
    selector_separator_newline: options.selectorSeparatorNewline ?? true,
    newline_between_rules: options.newlineBetweenRules ?? true,
    end_with_newline: options.endWithNewline ?? false,
  });
}

export function minifyCss(input: string): string {
  if (!input.trim()) return '';
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,>+~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\s+/g, ' ')
    .trim();
}
