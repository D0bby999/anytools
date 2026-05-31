import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'base64-encode',
  cluster: 'encoding',
  title: {
    en: 'Base64 Encode & Decode',
    vi: 'Mã hóa & Giải mã Base64',
  },
  description: {
    en: 'Free online Base64 encoder and decoder. UTF-8 safe, works offline, runs entirely in your browser.',
    vi: 'Công cụ mã hóa và giải mã Base64 miễn phí. Hỗ trợ UTF-8, hoạt động offline, xử lý hoàn toàn trong trình duyệt.',
  },
  keywords: [
    'base64',
    'base64 encode',
    'base64 decode',
    'utf-8 base64',
    'base64 url',
    'rfc 4648',
    'mã hóa base64',
    'giải mã base64',
  ],
  priority: 'P1',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'jwt-decoder',
      reason: {
        en: 'Inspect a JWT token (which uses Base64URL inside)',
        vi: 'Phân tích JWT token (dùng Base64URL bên trong)',
      },
    },
    {
      tool: 'url-encode',
      reason: {
        en: 'Encode the result for safe URL transport',
        vi: 'Mã hóa kết quả để truyền an toàn trong URL',
      },
    },
  ],
};
