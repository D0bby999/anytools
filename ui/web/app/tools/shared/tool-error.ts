/**
 * An error a tool's logic throws for the user to read.
 *
 * `logic.ts` files know nothing about locales, and their messages are asserted by tests, so the
 * English text stays as the Error's `message`. What is added is a stable `code` plus the values
 * the message was built from, so a widget can look up `error_<code>` in its own strings table
 * and render the same error in the page's language. A code the table does not know falls back
 * to the English message — never to nothing.
 */
export class ToolError extends Error {
  readonly code: string;
  readonly params: Record<string, string | number>;

  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.params = params;
  }
}

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in params ? String(params[key]) : m,
  );
}

/**
 * The text to show for a caught error: the localized template for a known ToolError code,
 * the error's own message otherwise, `fallback` when it was not an Error at all.
 */
export function toolErrorText(
  error: unknown,
  strings: Record<string, string>,
  fallback: string,
): string {
  if (error instanceof ToolError) {
    const template = strings[`error_${error.code}`];
    return template ? interpolate(template, error.params) : error.message;
  }
  return error instanceof Error ? error.message : fallback;
}
