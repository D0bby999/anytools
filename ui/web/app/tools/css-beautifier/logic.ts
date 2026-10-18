import beautify from 'js-beautify';
import { protectSegments } from '../shared/protect-segments';

// js-beautify is CommonJS: Node's ESM loader (the production server) refuses
// named imports from it, so take the function off the default export.
const cssBeautify = beautify.css;

/** The sample the Example button loads. Its colours are CSS text, not this page's. */
export const EXAMPLE = `.btn,.cta{display:inline-flex;align-items:center;padding:8px 16px;color:#fff;background:#2563eb;border-radius:6px}.btn:hover,.cta:hover{opacity:.9}`;

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

// String literals and url(...) bodies are content: "x; y" must not become "x;y".
const CSS_LITERALS = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\)/g;

export function minifyCss(input: string): string {
  if (!input.trim()) return '';
  const { text, restore } = protectSegments(input, CSS_LITERALS);
  // `+` and `-` are deliberately not in the operator class: inside calc() they need the
  // surrounding spaces to parse, and calc(1px+2px) is invalid CSS.
  const minified = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,>~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\s+/g, ' ')
    .trim();
  return restore(minified);
}
