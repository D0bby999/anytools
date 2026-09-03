import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'docx-to-markdown',
  cluster: 'converters',
  title: {
    en: 'DOCX to Markdown Converter',
    vi: 'Chuyển DOCX sang Markdown',
    es: 'Convertidor de DOCX a Markdown',
    pt: 'Conversor de DOCX para Markdown',
  },
  description: {
    en: 'Turn a Word .docx into Markdown — headings, bold, lists, links and GFM tables. Clean HTML too. Runs in your browser.',
    vi: 'Chuyển file Word .docx thành Markdown — heading, bold, list, link và bảng GFM. Có cả HTML sạch. Chạy trong trình duyệt.',
    es: 'Convierte un .docx de Word en Markdown: títulos, negrita, listas, enlaces y tablas GFM. Todo en el navegador.',
    pt: 'Converta um .docx do Word em Markdown: títulos, negrito, listas, links e tabelas GFM. Tudo no navegador.',
  },
  keywords: [
    'docx to markdown',
    'word to markdown',
    'docx to md',
    'docx to html',
    'convert word document',
    'mammoth docx',
  ],
  priority: 'P2',
  effort: 'M',
  availableLocales: ['en'],
  nextStepSuggestions: [
    {
      tool: 'md-html',
      reason: {
        en: 'Render the Markdown to HTML, or edit and convert it back',
        vi: 'Render Markdown ra HTML, hoặc sửa rồi chuyển ngược lại',
      },
    },
    {
      tool: 'word-counter',
      reason: {
        en: 'Count words and reading time in the converted text',
        vi: 'Đếm từ và thời gian đọc của văn bản vừa chuyển',
      },
    },
    {
      tool: 'xlsx-to-csv',
      reason: {
        en: 'Do the same for an Excel workbook',
        vi: 'Làm tương tự với file Excel',
      },
    },
  ],
};
