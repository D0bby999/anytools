import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'url-encode',
  cluster: 'encoding',
  title: { en: 'URL Encoder & Decoder', vi: 'Mã hóa & Giải mã URL' },
  description: {
    en: 'Encode and decode URL components per RFC 3986. UTF-8 safe, runs in your browser.',
    vi: 'Mã hóa và giải mã thành phần URL theo RFC 3986. Hỗ trợ UTF-8, chạy trong trình duyệt.',
  },
  keywords: [
    'url encode',
    'url decode',
    'percent encoding',
    'rfc 3986',
    'encodeuricomponent',
    'mã hóa url',
  ],
  priority: 'P1',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'base64-encode',
      reason: {
        en: 'Chain with Base64 for compact transport',
        vi: 'Kết hợp với Base64 để truyền gọn hơn',
      },
    },
    {
      tool: 'slugify',
      reason: {
        en: 'Generate URL-friendly slugs from text',
        vi: 'Tạo slug thân thiện URL từ text',
      },
    },
  ],
};
