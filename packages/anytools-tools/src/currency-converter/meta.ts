import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'currency-converter',
  cluster: 'finance',
  title: {
    en: 'Currency Converter',
    vi: 'Đổi tiền tệ',
    es: 'Conversor de divisas',
    pt: 'Conversor de moedas',
  },
  description: {
    en: 'Convert between 30+ currencies. Rates from Frankfurter (ECB) cached 24h. Free, no API key needed.',
    vi: 'Đổi giữa 30+ tiền tệ. Rates từ Frankfurter (ECB) cache 24h. Miễn phí, không cần API key.',
    es: 'Convierte entre 30+ divisas. Tasas de Frankfurter (BCE) cacheadas 24h. Gratis, sin API key.',
    pt: 'Converta entre 30+ moedas. Taxas do Frankfurter (BCE) cacheadas 24h. Grátis, sem API key.',
  },
  keywords: ['currency converter', 'fx rate', 'exchange rate', 'forex', 'đổi tiền tệ', 'cambio'],
  priority: 'P2',
  effort: 'M',
  published: true,
};
