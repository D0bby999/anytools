import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'md-html',
  cluster: 'converters',
  title: { en: 'Markdown ↔ HTML Converter', vi: 'Chuyển đổi Markdown ↔ HTML' },
  description: {
    en: 'Convert Markdown to HTML and back. GFM (tables, task lists) supported. Browser-only.',
    vi: 'Chuyển Markdown sang HTML và ngược lại. Hỗ trợ GFM (table, task list). Chỉ trong browser.',
  },
  keywords: ['markdown to html', 'html to markdown', 'gfm', 'commonmark', 'turndown', 'marked'],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'html-entity',
      reason: {
        en: 'Encode HTML entities for safe rendering',
        vi: 'Encode HTML entity để render an toàn',
      },
    },
    {
      tool: 'text-case-converter',
      reason: { en: 'Reformat the result text', vi: 'Đổi case kết quả' },
    },
    {
      tool: 'docx-to-markdown',
      reason: {
        en: 'Start from a Word document instead of Markdown',
        vi: 'Bắt đầu từ file Word thay vì Markdown',
      },
    },
  ],
};
