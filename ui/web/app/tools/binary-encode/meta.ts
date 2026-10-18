import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'binary-encode',
  cluster: 'encoding',
  title: {
    en: 'Binary Encode / Decode',
    vi: 'Encode / Decode Binary',
    es: 'Codificar / Decodificar Binario',
    pt: 'Codificar / Decodificar Binário',
  },
  description: {
    en: 'Convert text to and from 8-bit binary. UTF-8 safe. Configurable byte separator.',
    vi: 'Convert text sang binary 8-bit và ngược lại. UTF-8 safe. Tùy chỉnh separator.',
    es: 'Convierte texto a/desde binario 8 bits. UTF-8 safe. Separador configurable.',
    pt: 'Converta texto para/de binário 8 bits. UTF-8 safe. Separador configurável.',
  },
  keywords: [
    'binary encode',
    'binary decode',
    'text to binary',
    'binary to text',
    '8-bit',
    'utf-8 binary',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'hex-encode',
      reason: {
        en: 'Hex is denser than binary',
        vi: 'Hex gọn hơn binary',
        es: 'Hex es más denso',
        pt: 'Hex é mais denso',
      },
    },
    {
      tool: 'base64-encode',
      reason: {
        en: 'Base64 even denser',
        vi: 'Base64 còn gọn hơn nữa',
        es: 'Base64 aún más denso',
        pt: 'Base64 ainda mais denso',
      },
    },
  ],
};
