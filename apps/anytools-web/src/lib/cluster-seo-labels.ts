import type { ClusterId, SupportedLocale } from '@anytools/tools/types';

/**
 * The category word that follows a tool's name in its <title>:
 * "JSON Formatter — Free Online Formatter". It is a keyword slot, so it is written for
 * search intent in each language rather than translated from the English nav label.
 *
 * Kept separate from `catalog.cluster.*` (the visible nav/breadcrumb label): the nav
 * says "Encoding", the title wants "Encoder".
 */
export const CLUSTER_SEO_LABEL: Record<SupportedLocale, Record<ClusterId, string>> = {
  en: {
    encoding: 'Encoder',
    formatters: 'Formatter',
    generators: 'Generator',
    converters: 'Converter',
    'text-regex': 'Text Tool',
    'time-date': 'Date Tool',
    web3: 'Web3 Tool',
    marketing: 'Marketing Tool',
    'ecommerce-vn': 'VN E-commerce',
    finance: 'Calculator',
    health: 'Health Tool',
    lifestyle: 'Tool',
    design: 'Design Tool',
    pdf: 'PDF Tool',
    image: 'Image Tool',
  },
  vi: {
    encoding: 'Công cụ mã hóa',
    formatters: 'Trình định dạng',
    generators: 'Trình tạo',
    converters: 'Bộ chuyển đổi',
    'text-regex': 'Công cụ văn bản',
    'time-date': 'Công cụ ngày giờ',
    web3: 'Công cụ Web3',
    marketing: 'Công cụ marketing',
    'ecommerce-vn': 'TMĐT Việt Nam',
    finance: 'Máy tính',
    health: 'Công cụ sức khỏe',
    lifestyle: 'Công cụ',
    design: 'Công cụ thiết kế',
    pdf: 'Công cụ PDF',
    image: 'Công cụ ảnh',
  },
  es: {
    encoding: 'Codificador',
    formatters: 'Formateador',
    generators: 'Generador',
    converters: 'Conversor',
    'text-regex': 'Herramienta de texto',
    'time-date': 'Herramienta de fechas',
    web3: 'Herramienta Web3',
    marketing: 'Herramienta de marketing',
    'ecommerce-vn': 'E-commerce VN',
    finance: 'Calculadora',
    health: 'Herramienta de salud',
    lifestyle: 'Herramienta',
    design: 'Herramienta de diseño',
    pdf: 'Herramienta PDF',
    image: 'Herramienta de imagen',
  },
  pt: {
    encoding: 'Codificador',
    formatters: 'Formatador',
    generators: 'Gerador',
    converters: 'Conversor',
    'text-regex': 'Ferramenta de texto',
    'time-date': 'Ferramenta de datas',
    web3: 'Ferramenta Web3',
    marketing: 'Ferramenta de marketing',
    'ecommerce-vn': 'E-commerce VN',
    finance: 'Calculadora',
    health: 'Ferramenta de saúde',
    lifestyle: 'Ferramenta',
    design: 'Ferramenta de design',
    pdf: 'Ferramenta PDF',
    image: 'Ferramenta de imagem',
  },
};

export function clusterSeoLabel(locale: string, cluster: ClusterId): string {
  const table = CLUSTER_SEO_LABEL[locale as SupportedLocale] ?? CLUSTER_SEO_LABEL.en;
  return table[cluster];
}

/** The noun a cluster landing page's <title> uses: "Encoding — Free Online Tools". */
const CLUSTER_PAGE_NOUN: Record<SupportedLocale, string> = {
  en: 'Tools',
  vi: 'Công cụ',
  es: 'Herramientas',
  pt: 'Ferramentas',
};

export function clusterPageNoun(locale: string): string {
  return CLUSTER_PAGE_NOUN[locale as SupportedLocale] ?? CLUSTER_PAGE_NOUN.en;
}
