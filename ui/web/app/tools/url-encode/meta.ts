import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'url-encode',
  cluster: 'encoding',
  title: {
    en: 'URL Encoder & Decoder',
    vi: 'Mã hóa & Giải mã URL',
    es: 'Codificador y decodificador de URL',
    pt: 'Codificador e decodificador de URL',
  },
  description: {
    en: 'Encode and decode URL components per RFC 3986. UTF-8 safe, runs in your browser.',
    vi: 'Mã hóa và giải mã thành phần URL theo RFC 3986. Hỗ trợ UTF-8, chạy trong trình duyệt.',
    es: 'Codifica y decodifica componentes de URL según RFC 3986. Compatible con UTF-8, se ejecuta en tu navegador.',
    pt: 'Codifica e decodifica componentes de URL conforme a RFC 3986. Compatível com UTF-8, roda no seu navegador.',
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
