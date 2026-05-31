import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'hex-encode',
  cluster: 'encoding',
  title: {
    en: 'Hex Encode / Decode',
    vi: 'Encode / Decode Hex',
    es: 'Codificar / Decodificar Hex',
    pt: 'Codificar / Decodificar Hex',
  },
  description: {
    en: 'Convert text to and from hexadecimal bytes. UTF-8 safe — handles emoji, Vietnamese, CJK. Configurable separator and 0x prefix.',
    vi: 'Convert text sang hex và ngược lại. UTF-8 safe — hỗ trợ emoji, tiếng Việt, CJK. Tùy chỉnh separator và prefix 0x.',
    es: 'Convierte texto a/desde hexadecimal. UTF-8 safe — emoji, vietnamita, CJK. Separador y prefijo 0x configurables.',
    pt: 'Converta texto para/de hexadecimal. UTF-8 safe — emoji, vietnamita, CJK. Separador e prefixo 0x configuráveis.',
  },
  keywords: ['hex encode', 'hex decode', 'hexadecimal', 'text to hex', 'hex to text', 'utf-8 hex'],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'base64-encode',
      reason: {
        en: 'Base64 is denser than hex',
        vi: 'Base64 gọn hơn hex',
        es: 'Base64 es más denso',
        pt: 'Base64 é mais denso',
      },
    },
    {
      tool: 'binary-encode',
      reason: {
        en: 'See binary representation',
        vi: 'Xem dạng binary',
        es: 'Ver representación binaria',
        pt: 'Ver representação binária',
      },
    },
  ],
};
