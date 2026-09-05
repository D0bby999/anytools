/**
 * Build a tool page's <title> so it survives SERP truncation.
 *
 * Google cuts titles around 60 characters. The full template
 * `{tool} — Free Online {category} | AnyTools` pushed 21 of 76 tool pages past
 * that, and three past 70 — the tail that gets cut is the brand, so those pages
 * paid for the suffix without ever showing it.
 *
 * Rather than shortening the tool titles (which are also the visible H1, and carry
 * the keywords), drop the least valuable parts first. The category word is usually
 * redundant with the title anyway: "Hash Generator — Free Online Generator".
 */
const MAX_TITLE_CHARS = 60;

/**
 * The "free online" phrase is the other keyword in the title, so it has to be in the
 * page's language too. Before this table every locale got the English one, which produced
 * titles like "Mã hóa & Giải mã Base64 — Free Online Encoder": half Vietnamese, half
 * English, and matching neither query.
 */
const CATEGORY_PHRASE: Record<string, (category: string) => string> = {
  en: (c) => `Free Online ${c}`,
  vi: (c) => `${c} online miễn phí`,
  es: (c) => `${c} online gratis`,
  pt: (c) => `${c} online grátis`,
};

export function buildToolTitle(
  title: string,
  category: string,
  locale = 'en',
  brand = 'AnyTools',
): string {
  const toPhrase = CATEGORY_PHRASE[locale] ?? CATEGORY_PHRASE.en;
  const phrase = toPhrase ? toPhrase(category) : `Free Online ${category}`;
  const ladder = [
    `${title} — ${phrase} | ${brand}`,
    `${title} — ${phrase}`,
    `${title} | ${brand}`,
    title,
  ];
  // Falls through to the bare title, which is as short as this can get.
  return ladder.find((candidate) => candidate.length <= MAX_TITLE_CHARS) ?? title;
}

/**
 * Append a suffix to a headline only while the result still fits.
 *
 * Same trade as buildToolTitle: the headline carries the keywords and is what the
 * reader recognises, so a brand suffix that would be truncated away is dropped instead.
 */
export function fitTitle(title: string, suffix: string): string {
  return title.length + suffix.length <= MAX_TITLE_CHARS ? `${title}${suffix}` : title;
}

export { MAX_TITLE_CHARS };

/**
 * Trim a description to something a SERP will show whole.
 *
 * Cluster pages were using their one-line tagline as the meta description, which
 * ran 21–50 characters — too thin to describe the page to anyone. The landing
 * `intro` copy is the better source, but a few run past 200 chars and would be
 * cut mid-clause (the finance intro ends on a "verify with a licensed…" caveat,
 * which is the worst possible place to be truncated).
 *
 * Prefers a sentence boundary, falls back to a word boundary, and only then
 * gives up and hard-cuts.
 */
const MAX_DESCRIPTION_CHARS = 155;

export function clampMetaDescription(text: string, max = MAX_DESCRIPTION_CHARS): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;

  const window = clean.slice(0, max);
  const lastSentence = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
  );
  // Only honour a sentence break if it leaves a substantial description behind.
  if (lastSentence >= max * 0.6) return window.slice(0, lastSentence + 1);

  const lastSpace = window.lastIndexOf(' ');
  const body = lastSpace > 0 ? window.slice(0, lastSpace) : window;
  return `${body.replace(/[,;:—-]$/, '')}…`;
}

export { MAX_DESCRIPTION_CHARS };
