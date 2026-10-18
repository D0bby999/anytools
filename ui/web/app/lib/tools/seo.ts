/**
 * tools/seo.ts
 * Titles, alternates and JSON-LD for the public tool pages, ported from the
 * old site's seo-metadata.ts, cluster-seo-labels.ts and schema.ts with the
 * reasons they gave. Pure functions: the loader knows the origin and which
 * locales are indexable, and each route's `meta` turns that into tags.
 */
import type { ClusterId } from "~/tools/types";
import type { PublicLng } from "~/lib/i18n";

/** Google cuts titles around 60 characters, and what it cuts is the brand. */
export const MAX_TITLE_CHARS = 60;

/**
 * Bumped whenever the share cards change look. Cloudflare and the social
 * networks cache an og:image for a day or more; a new query string is the
 * only way a redesign reaches a link that was already shared.
 */
export const OG_VERSION = "20261019";

/** The share card under `base`: the site's (`/og.png`) or a tool page's. */
export function ogImage(base: string): string {
  return `${base}/og.png?v=${OG_VERSION}`;
}
export const MAX_DESCRIPTION_CHARS = 155;
const BRAND = "AnyTools";

/** "Free online" is a keyword slot, so it is in the page's language. */
const CATEGORY_PHRASE: Record<PublicLng, (category: string) => string> = {
  en: (c) => `Free Online ${c}`,
  vi: (c) => `${c} online miễn phí`,
  es: (c) => `${c} online gratis`,
  pt: (c) => `${c} online grátis`,
};

/** `{tool} — Free Online {category} | AnyTools`, dropping the least useful part first. */
export function buildToolTitle(title: string, category: string, locale: PublicLng): string {
  const phrase = CATEGORY_PHRASE[locale](category);
  const ladder = [`${title} — ${phrase} | ${BRAND}`, `${title} — ${phrase}`, `${title} | ${BRAND}`, title];
  return ladder.find((c) => c.length <= MAX_TITLE_CHARS) ?? title;
}

/** Trim to what a result page shows whole: a sentence break, else a word break. */
export function clampMetaDescription(text: string, max = MAX_DESCRIPTION_CHARS): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const window = clean.slice(0, max);
  const lastSentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (lastSentence >= max * 0.6) return window.slice(0, lastSentence + 1);
  const lastSpace = window.lastIndexOf(" ");
  const body = lastSpace > 0 ? window.slice(0, lastSpace) : window;
  return `${body.replace(/[,;:—-]$/, "")}…`;
}

/**
 * The category word after a tool's name in its title. Written for search
 * intent per language, not translated from the cluster's nav label: the nav
 * says "Encoding", the title wants "Encoder".
 */
const CLUSTER_SEO_LABEL: Record<PublicLng, Record<ClusterId, string>> = {
  en: {
    encoding: "Encoder", formatters: "Formatter", generators: "Generator", converters: "Converter",
    "text-regex": "Text Tool", "time-date": "Date Tool", web3: "Web3 Tool", marketing: "Marketing Tool",
    "ecommerce-vn": "VN E-commerce", finance: "Calculator", health: "Health Tool", lifestyle: "Tool",
    design: "Design Tool", pdf: "PDF Tool", image: "Image Tool",
  },
  vi: {
    encoding: "Công cụ mã hóa", formatters: "Trình định dạng", generators: "Trình tạo", converters: "Bộ chuyển đổi",
    "text-regex": "Công cụ văn bản", "time-date": "Công cụ ngày giờ", web3: "Công cụ Web3", marketing: "Công cụ marketing",
    "ecommerce-vn": "TMĐT Việt Nam", finance: "Máy tính", health: "Công cụ sức khỏe", lifestyle: "Công cụ",
    design: "Công cụ thiết kế", pdf: "Công cụ PDF", image: "Công cụ ảnh",
  },
  es: {
    encoding: "Codificador", formatters: "Formateador", generators: "Generador", converters: "Conversor",
    "text-regex": "Herramienta de texto", "time-date": "Herramienta de fechas", web3: "Herramienta Web3",
    marketing: "Herramienta de marketing", "ecommerce-vn": "E-commerce VN", finance: "Calculadora",
    health: "Herramienta de salud", lifestyle: "Herramienta", design: "Herramienta de diseño", pdf: "Herramienta PDF",
    image: "Herramienta de imagen",
  },
  pt: {
    encoding: "Codificador", formatters: "Formatador", generators: "Gerador", converters: "Conversor",
    "text-regex": "Ferramenta de texto", "time-date": "Ferramenta de datas", web3: "Ferramenta Web3",
    marketing: "Ferramenta de marketing", "ecommerce-vn": "E-commerce VN", finance: "Calculadora",
    health: "Ferramenta de saúde", lifestyle: "Ferramenta", design: "Ferramenta de design", pdf: "Ferramenta PDF",
    image: "Ferramenta de imagem",
  },
};

export function clusterSeoLabel(locale: PublicLng, cluster: ClusterId): string {
  return CLUSTER_SEO_LABEL[locale][cluster];
}

/** The noun a cluster page's title uses: "Encoding — Free Online Tools". */
const CLUSTER_PAGE_NOUN: Record<PublicLng, string> = {
  en: "Tools",
  vi: "Công cụ",
  es: "Herramientas",
  pt: "Ferramentas",
};

export function clusterPageNoun(locale: PublicLng): string {
  return CLUSTER_PAGE_NOUN[locale];
}

/** Schema.org applicationCategory: a BMI calculator is not a developer tool. */
const APPLICATION_CATEGORY: Record<ClusterId, string> = {
  encoding: "DeveloperApplication",
  formatters: "DeveloperApplication",
  generators: "DeveloperApplication",
  "text-regex": "DeveloperApplication",
  web3: "DeveloperApplication",
  converters: "UtilitiesApplication",
  "time-date": "UtilitiesApplication",
  pdf: "UtilitiesApplication",
  image: "MultimediaApplication",
  design: "DesignApplication",
  finance: "FinanceApplication",
  health: "HealthApplication",
  lifestyle: "LifestyleApplication",
  marketing: "BusinessApplication",
  "ecommerce-vn": "BusinessApplication",
};

export function softwareAppSchema(input: {
  name: string;
  description: string;
  url: string;
  cluster: ClusterId;
  locale: PublicLng;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: input.name,
    applicationCategory: APPLICATION_CATEGORY[input.cluster],
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    inLanguage: input.locale,
    description: input.description,
    url: input.url,
  };
}

/** `item` is the absolute canonical URL of each step, or Google drops the trail. */
export function breadcrumbSchema(trail: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({ "@type": "ListItem", position: i + 1, name: step.name, item: step.url })),
  };
}

export function faqSchema(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
}

type MetaTag = Record<string, unknown>;

/**
 * Canonical and hreflang links. `x-default` points at English when English is
 * among the alternates: it is the one locale with a body for every tool, so it
 * is never a noindex page.
 */
export function alternateLinks(origin: string, path: (l: PublicLng) => string, self: PublicLng, indexable: readonly PublicLng[]): MetaTag[] {
  const links: MetaTag[] = [{ tagName: "link", rel: "canonical", href: `${origin}${path(self)}` }];
  for (const l of indexable) links.push({ tagName: "link", rel: "alternate", hrefLang: l, href: `${origin}${path(l)}` });
  if (indexable.includes("en")) links.push({ tagName: "link", rel: "alternate", hrefLang: "x-default", href: `${origin}${path("en")}` });
  return links;
}

/** title, description, robots and the Open Graph / Twitter card. */
export function pageMeta(input: {
  title: string;
  description: string;
  url: string;
  image: string;
  locale: PublicLng;
  indexable: boolean;
  alternateLocales: readonly PublicLng[];
}): MetaTag[] {
  return [
    { title: input.title },
    { name: "description", content: input.description },
    // follow stays on for a noindex page: its links to sibling tools still count.
    { name: "robots", content: input.indexable ? "index, follow, max-image-preview:large" : "noindex, follow" },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: BRAND },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:url", content: input.url },
    { property: "og:locale", content: input.locale },
    ...input.alternateLocales.filter((l) => l !== input.locale).map((l) => ({ property: "og:locale:alternate", content: l })),
    { property: "og:image", content: input.image },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
  ];
}
