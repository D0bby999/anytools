import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'json-formatter',
  cluster: 'formatters',
  title: { en: 'JSON Formatter & Validator', vi: 'Định dạng & Kiểm tra JSON' },
  description: {
    en: 'Format, minify, sort, and validate JSON. JSON5 mode accepts comments and trailing commas. Browser-only.',
    vi: 'Định dạng, minify, sort, validate JSON. Mode JSON5 chấp nhận comment và trailing comma. Chỉ trong browser.',
  },
  keywords: [
    'json formatter',
    'json validator',
    'json beautifier',
    'json minify',
    'json5',
    'json pretty print',
    'định dạng json',
  ],
  priority: 'P1',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'base64-encode',
      reason: {
        en: 'Encode the formatted JSON as Base64',
        vi: 'Encode JSON đã format thành Base64',
      },
    },
    {
      tool: 'jwt-decoder',
      reason: {
        en: 'Inspect JWT payloads (which are JSON)',
        vi: 'Phân tích payload JWT (vốn là JSON)',
      },
    },
  ],
};
