/**
 * anytools-mark.tsx
 * AnyTools' four tiles, drawn inline beside the wordmark (the logo in
 * public/brand, DESIGN.md "Marks"). The favicon's geometry, filled with the
 * world's tokens so the dark theme lifts it the way it lifts the favicon.
 * Decorative: the wordmark beside it is the name.
 */
export function AnyToolsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="262 262 500 500" aria-hidden="true" focusable="false" className={className}>
      <rect x="282" y="282" width="210" height="210" rx="52" fill="var(--lp-brand)" />
      <rect x="547" y="297" width="180" height="180" rx="42" fill="var(--lp-selected)" stroke="var(--lp-brand)" strokeWidth="30" />
      <rect x="297" y="547" width="180" height="180" rx="42" fill="var(--lp-selected)" stroke="var(--lp-brand)" strokeWidth="30" />
      <rect x="532" y="532" width="210" height="210" rx="52" fill="var(--lp-highlight)" />
    </svg>
  );
}
