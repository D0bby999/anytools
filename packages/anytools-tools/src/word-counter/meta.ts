import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'word-counter',
  cluster: 'lifestyle',
  title: {
    en: 'Word & Character Counter',
    vi: 'Đếm chữ & ký tự',
    es: 'Contador de palabras y caracteres',
    pt: 'Contador de palavras e caracteres',
  },
  description: {
    en: 'Count words, characters (with/without spaces), sentences, paragraphs. Live updates. Tweet-length tracker built in.',
    vi: 'Đếm chữ, ký tự (có/không khoảng trắng), câu, đoạn. Cập nhật live. Tracker giới hạn tweet sẵn có.',
    es: 'Cuenta palabras, caracteres, oraciones, párrafos en vivo. Incluye contador de límite tweet.',
    pt: 'Conte palavras, caracteres, frases, parágrafos ao vivo. Inclui contador de limite tweet.',
  },
  keywords: ['word counter', 'character counter', 'tweet counter', 'đếm chữ', 'contador palabras'],
  priority: 'P2',
  effort: 'S',
  published: true,
};
