import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'regex-tester',
  cluster: 'text-regex',
  title: { en: 'Regex Tester', vi: 'Kiểm tra Regex' },
  description: {
    en: 'Test JavaScript regex patterns against any text. Capture groups, named groups, flags, replace mode. Browser-only.',
    vi: 'Test regex JavaScript trên text bất kỳ. Group capture, named group, flag, mode replace. Chỉ trong browser.',
  },
  keywords: ['regex', 'regex tester', 'regular expression', 'pattern matching', 'kiểm tra regex'],
  priority: 'P1',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'text-case-converter',
      reason: {
        en: 'Transform matched text into another case',
        vi: 'Biến text khớp sang case khác',
      },
    },
    {
      tool: 'json-formatter',
      reason: {
        en: 'Format matches when working with JSON strings',
        vi: 'Format match khi làm việc với chuỗi JSON',
      },
    },
  ],
};
