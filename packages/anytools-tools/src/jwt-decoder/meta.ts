import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'jwt-decoder',
  cluster: 'encoding',
  title: { en: 'JWT Decoder', vi: 'Giải mã JWT' },
  description: {
    en: 'Inspect JSON Web Tokens in your browser. Header, payload, expiry. No key required, no data sent.',
    vi: 'Phân tích JSON Web Token trong trình duyệt. Header, payload, expiry. Không cần key, không gửi dữ liệu.',
  },
  keywords: [
    'jwt',
    'jwt decoder',
    'json web token',
    'jwt parser',
    'jwt expiry',
    'rfc 7519',
    'giải mã jwt',
  ],
  priority: 'P1',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'base64-encode',
      reason: {
        en: 'Inspect individual JWT segments as Base64',
        vi: 'Phân tích từng đoạn JWT dưới dạng Base64',
      },
    },
    {
      tool: 'hash-generator',
      reason: { en: 'Compute HMAC for HS256 verification', vi: 'Tính HMAC để verify HS256' },
    },
  ],
};
