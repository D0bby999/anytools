import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'password-generator',
  cluster: 'generators',
  title: {
    en: 'Password Generator',
    vi: 'Tạo Mật Khẩu',
    es: 'Generador de contraseñas',
    pt: 'Gerador de senhas',
  },
  description: {
    en: 'Generate strong passwords with crypto-grade randomness. Length, charsets, ambiguous-char filter. Browser-only.',
    vi: 'Tạo mật khẩu mạnh bằng randomness mã hóa. Tùy chỉnh độ dài, charset, loại ký tự dễ nhầm. Chỉ trong browser.',
    es: 'Genera contraseñas seguras con aleatoriedad criptográfica. Longitud, conjuntos de caracteres y filtro de caracteres ambiguos. Solo en el navegador.',
    pt: 'Gera senhas fortes com aleatoriedade criptográfica. Comprimento, conjuntos de caracteres e filtro de caracteres ambíguos. Só no navegador.',
  },
  keywords: [
    'password generator',
    'random password',
    'strong password',
    'crypto random',
    'tạo mật khẩu',
    'mật khẩu mạnh',
  ],
  priority: 'P1',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'hash-generator',
      reason: {
        en: 'Hash a password to see why SHA alone is not enough',
        vi: 'Hash mật khẩu để thấy vì sao SHA không đủ',
      },
    },
    {
      tool: 'uuid-generator',
      reason: {
        en: 'Generate a UUID when you need a structured ID',
        vi: 'Tạo UUID khi cần ID có cấu trúc',
      },
    },
  ],
};
