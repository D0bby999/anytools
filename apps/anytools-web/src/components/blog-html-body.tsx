import type { SanitizedHtml } from '@anytools/postclaw-blog-endpoint';

/**
 * Renders content_format='html' posts (ingested via the PostClaw custom_blog
 * endpoints). `html` is sanitized once at ingest (packages/postclaw-blog-endpoint) —
 * the branded SanitizedHtml type is the only input this component accepts, so an
 * unsanitized string can never type-check into dangerouslySetInnerHTML. Mirrors
 * MdxContent's own wrapper (no prose class here — the parent <article> in
 * [slug]/page.tsx already supplies blog typography for both content paths).
 */
export function BlogHtmlBody({ html }: { html: SanitizedHtml }) {
  return (
    <div
      className="max-w-3xl"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: html is sanitized at ingest (SanitizedHtml brand)
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
