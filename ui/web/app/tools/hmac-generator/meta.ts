import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'hmac-generator',
  cluster: 'generators',
  title: {
    en: 'HMAC Generator & Verifier',
    vi: 'Tạo & xác minh HMAC',
    es: 'Generador y verificador de HMAC',
    pt: 'Gerador e verificador de HMAC',
  },
  description: {
    en: 'Compute an HMAC (SHA-1/256/384/512) with a text or hex key, hex or Base64 output, and verify a signature in constant time. Browser-only.',
    vi: 'Tính HMAC (SHA-1/256/384/512) với khoá dạng text hoặc hex, output hex hoặc Base64, và xác minh chữ ký theo cách hằng thời gian. Chỉ chạy trong trình duyệt.',
    es: 'Calcula un HMAC (SHA-1/256/384/512) con clave en texto o hex, salida hex o Base64, y verifica una firma en tiempo constante. Solo en el navegador.',
    pt: 'Calcule um HMAC (SHA-1/256/384/512) com chave em texto ou hex, saída hex ou Base64, e verifique uma assinatura em tempo constante. Só no navegador.',
  },
  keywords: [
    'hmac generator',
    'hmac sha256 online',
    'hmac verify',
    'webhook signature verify',
    'hmac hex key',
    'hmac-sha256 checker',
    'api signature generator',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'hash-generator',
      reason: {
        en: 'Need a plain, unkeyed hash instead?',
        vi: 'Cần hash thường, không có khoá?',
        es: '¿Necesitas un hash simple, sin clave?',
        pt: 'Precisa de um hash simples, sem chave?',
      },
    },
    {
      tool: 'password-generator',
      reason: {
        en: 'Generate a strong random HMAC secret',
        vi: 'Tạo khoá bí mật HMAC mạnh, ngẫu nhiên',
        es: 'Genera un secreto HMAC fuerte y aleatorio',
        pt: 'Gere um segredo HMAC forte e aleatório',
      },
    },
  ],
};
