/**
 * Generate the <head> meta tags a page needs for search and social previews.
 * Written from the Open Graph protocol (ogp.me), the Twitter/X cards reference and MDN's
 * documentation for <meta>; no third-party source consulted.
 */

export type MetaInput = {
  title: string;
  description: string;
  url: string;
  imageUrl: string;
  siteName: string;
  author: string;
  twitterHandle: string;
  cardType: 'summary' | 'summary_large_image';
  locale: string;
  robots: 'index, follow' | 'noindex, follow' | 'noindex, nofollow';
};

export const DEFAULT_INPUT: MetaInput = {
  title: '',
  description: '',
  url: '',
  imageUrl: '',
  siteName: '',
  author: '',
  twitterHandle: '',
  cardType: 'summary_large_image',
  locale: 'en_US',
  robots: 'index, follow',
};

/** Lengths at which Google and the social cards start truncating. Advisory, not enforced. */
export const LIMITS = { title: 60, description: 160 } as const;

export type WarningParams = Record<string, string | number>;

/** `message` is the English text; `code` + `params` let a widget render it in the page's language. */
export type Warning = {
  field: keyof MetaInput;
  message: string;
  code: string;
  params?: WarningParams;
};

export function validate(input: MetaInput): Warning[] {
  const out: Warning[] = [];
  if (input.title.length > LIMITS.title) {
    out.push({
      field: 'title',
      message: `${input.title.length} characters — search results usually cut off around ${LIMITS.title}.`,
      code: 'titleLong',
      params: { count: input.title.length, limit: LIMITS.title },
    });
  }
  if (input.description.length > LIMITS.description) {
    out.push({
      field: 'description',
      message: `${input.description.length} characters — snippets usually cut off around ${LIMITS.description}.`,
      code: 'descriptionLong',
      params: { count: input.description.length, limit: LIMITS.description },
    });
  }
  // Relative URLs work in a page but not in a scraper, which fetches og:image on its own.
  if (input.imageUrl && !/^https?:\/\//i.test(input.imageUrl)) {
    out.push({
      field: 'imageUrl',
      message: 'og:image must be an absolute URL — crawlers fetch it without your page context.',
      code: 'imageAbsolute',
    });
  }
  if (input.url && !/^https?:\/\//i.test(input.url)) {
    out.push({ field: 'url', message: 'og:url must be absolute.', code: 'urlAbsolute' });
  }
  if (input.twitterHandle && !input.twitterHandle.startsWith('@')) {
    out.push({ field: 'twitterHandle', message: 'Handles start with @.', code: 'handleAt' });
  }
  if (input.cardType === 'summary_large_image' && !input.imageUrl) {
    out.push({
      field: 'imageUrl',
      message: 'A large-image card with no image falls back to a plain summary card.',
      code: 'largeCardNoImage',
    });
  }
  return out;
}

/** Escape for an HTML attribute value. Titles routinely contain quotes and ampersands. */
function attr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function generateMetaTags(input: MetaInput): string {
  const lines: string[] = [];
  const push = (tag: string) => lines.push(tag);

  if (input.title) push(`<title>${attr(input.title)}</title>`);
  if (input.description) push(`<meta name="description" content="${attr(input.description)}">`);
  if (input.author) push(`<meta name="author" content="${attr(input.author)}">`);
  push(`<meta name="robots" content="${input.robots}">`);
  if (input.url) push(`<link rel="canonical" href="${attr(input.url)}">`);

  if (input.title || input.url || input.imageUrl) {
    push('');
    push('<!-- Open Graph -->');
    push('<meta property="og:type" content="website">');
    if (input.title) push(`<meta property="og:title" content="${attr(input.title)}">`);
    if (input.description)
      push(`<meta property="og:description" content="${attr(input.description)}">`);
    if (input.url) push(`<meta property="og:url" content="${attr(input.url)}">`);
    if (input.imageUrl) push(`<meta property="og:image" content="${attr(input.imageUrl)}">`);
    if (input.siteName) push(`<meta property="og:site_name" content="${attr(input.siteName)}">`);
    if (input.locale) push(`<meta property="og:locale" content="${attr(input.locale)}">`);
  }

  push('');
  push('<!-- Twitter / X -->');
  push(`<meta name="twitter:card" content="${input.cardType}">`);
  if (input.title) push(`<meta name="twitter:title" content="${attr(input.title)}">`);
  if (input.description)
    push(`<meta name="twitter:description" content="${attr(input.description)}">`);
  if (input.imageUrl) push(`<meta name="twitter:image" content="${attr(input.imageUrl)}">`);
  if (input.twitterHandle)
    push(`<meta name="twitter:site" content="${attr(input.twitterHandle)}">`);

  return lines.join('\n').trim();
}
