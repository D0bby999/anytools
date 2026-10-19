/**
 * The API writes its errors the Go way: lower case, a clause joined with a
 * dash ("your model did not return usable questions — try again"). Shown after
 * one of our own sentences that read as "No questions were written. your
 * model…". This makes one a sentence of its own for display, and leaves the
 * text itself alone.
 */
export function asSentence(text: string): string {
  const t = text.trim().replace(/\s+—\s+/g, ": ");
  if (!t) return t;
  const first = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}
