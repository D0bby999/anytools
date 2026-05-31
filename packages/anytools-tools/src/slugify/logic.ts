import slugify from 'slugify';

const VN_DIACRITIC_MAP: Record<string, string> = {
  đ: 'd',
  Đ: 'D',
};

export type SlugifyOptions = {
  separator?: '-' | '_' | '.';
  lowercase?: boolean;
  strict?: boolean;
  locale?: 'en' | 'vi' | 'de' | 'fr' | 'es' | 'pt';
};

function preprocess(text: string, locale?: string): string {
  if (locale === 'vi') {
    let out = text;
    for (const [k, v] of Object.entries(VN_DIACRITIC_MAP)) {
      out = out.replaceAll(k, v);
    }
    return out;
  }
  return text;
}

export function makeSlug(text: string, options: SlugifyOptions = {}): string {
  const separator = options.separator ?? '-';
  const preprocessed = preprocess(text, options.locale);
  return slugify(preprocessed, {
    replacement: separator,
    lower: options.lowercase ?? true,
    strict: options.strict ?? false,
    remove: options.strict ? /[*+~.()'"!:@]/g : undefined,
    locale: options.locale ?? 'en',
  });
}

export function makeBulkSlugs(lines: string, options?: SlugifyOptions): string[] {
  return lines
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => makeSlug(line, options));
}
