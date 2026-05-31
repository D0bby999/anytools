import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'diff-checker',
  cluster: 'text-regex',
  title: { en: 'Diff Checker', vi: 'So sánh Diff' },
  description: {
    en: 'Compare two texts character/word/line. Generate unified patch. Browser-only.',
    vi: 'So sánh hai văn bản theo ký tự/từ/dòng. Tạo unified patch. Chỉ trong browser.',
  },
  keywords: [
    'diff',
    'compare text',
    'unified diff',
    'patch',
    'side by side diff',
    'so sánh văn bản',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'json-formatter',
      reason: {
        en: 'Sort keys before diffing for stable output',
        vi: 'Sort key trước khi diff để output ổn định',
      },
    },
    {
      tool: 'text-case-converter',
      reason: { en: 'Normalize case before comparison', vi: 'Normalize case trước khi so sánh' },
    },
  ],
};
