import sanitizeHtml from 'sanitize-html';

declare const sanitizedHtmlBrand: unique symbol;
/**
 * Branded string proving the value went through sanitizePostHtml. The render
 * component (per-app blog-html-body) accepts ONLY this type, so an unsanitized
 * string can never type-check into dangerouslySetInnerHTML — ingest-time
 * sanitization is the single XSS boundary and the type system enforces it.
 */
export type SanitizedHtml = string & { readonly [sanitizedHtmlBrand]: true };

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'a',
    'img',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'hr',
    'br',
    'figure',
    'figcaption',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target'],
    img: ['src', 'alt', 'width', 'height'],
  },
  // Global scheme allowlist — covers a[href] AND img[src]; kills javascript:/data:.
  allowedSchemes: ['https', 'mailto'],
  allowProtocolRelative: false,
  // Affiliate SEO sites: a token holder must not be able to plant followed
  // outbound links sitewide. Every anchor in ingested content is nofollow'd.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow ugc noopener' }),
  },
};

export function sanitizePostHtml(html: string): SanitizedHtml {
  return sanitizeHtml(html, OPTIONS) as SanitizedHtml;
}
