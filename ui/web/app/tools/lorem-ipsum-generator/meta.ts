import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'lorem-ipsum-generator',
  cluster: 'generators',
  title: {
    en: 'Lorem Ipsum Generator',
    vi: 'Tạo Lorem Ipsum',
    es: 'Generador de Lorem Ipsum',
    pt: 'Gerador de Lorem Ipsum',
  },
  description: {
    en: 'Generate placeholder text — classic Lorem Ipsum, Vietnamese filler, Spanish, or hipster style. Words, sentences, paragraphs, or HTML.',
    vi: 'Tạo văn bản giả — Lorem Ipsum cổ điển, filler tiếng Việt, Tây Ban Nha, hoặc hipster. Theo từ, câu, đoạn, hoặc HTML.',
    es: 'Genera texto de relleno — Lorem Ipsum clásico, vietnamita, español o hipster. Palabras, frases, párrafos o HTML.',
    pt: 'Gere texto de preenchimento — Lorem Ipsum clássico, vietnamita, espanhol ou hipster. Palavras, frases, parágrafos ou HTML.',
  },
  keywords: [
    'lorem ipsum',
    'placeholder text',
    'filler text',
    'dummy text',
    'lipsum',
    'tạo lorem',
    'texto relleno',
    'texto preenchimento',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'mock-data-generator',
      reason: {
        en: 'Need fake structured data, not just text? Use Mock Data',
        vi: 'Cần data structured giả, không chỉ text? Dùng Mock Data',
        es: '¿Datos estructurados falsos? Usa Mock Data',
        pt: 'Dados estruturados falsos? Use Mock Data',
      },
    },
    {
      tool: 'slugify',
      reason: {
        en: 'Slugify Lorem to URL-safe paths',
        vi: 'Slugify Lorem thành URL path',
        es: 'Convierte Lorem a slugs URL-safe',
        pt: 'Slugify Lorem para paths URL-safe',
      },
    },
  ],
};
