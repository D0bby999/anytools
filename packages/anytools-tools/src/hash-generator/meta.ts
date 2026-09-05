import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'hash-generator',
  cluster: 'generators',
  title: {
    en: 'Hash Generator (MD5, SHA-1/256/384/512)',
    vi: 'Tạo Hash (MD5, SHA-1/256/384/512)',
    es: 'Generador de hash (MD5, SHA-1/256/384/512)',
    pt: 'Gerador de hash (MD5, SHA-1/256/384/512)',
  },
  description: {
    en: 'Compute MD5, SHA-1, SHA-256, SHA-384, SHA-512 hashes of text or files. Hex or Base64 output. Browser-only.',
    vi: 'Tính MD5, SHA-1, SHA-256, SHA-384, SHA-512 hash của text hoặc file. Output hex hoặc Base64. Chỉ trong browser.',
    es: 'Calcula hashes MD5, SHA-1, SHA-256, SHA-384 y SHA-512 de texto o archivos. Salida en hex o Base64. Solo en el navegador.',
    pt: 'Calcula hashes MD5, SHA-1, SHA-256, SHA-384 e SHA-512 de texto ou arquivos. Saída em hex ou Base64. Só no navegador.',
  },
  keywords: [
    'hash',
    'md5',
    'sha1',
    'sha256',
    'sha512',
    'hmac',
    'file hash',
    'tạo hash',
    'kiểm tra md5',
  ],
  priority: 'P1',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'password-generator',
      reason: {
        en: 'Generate then demonstrate hashing a password',
        vi: 'Tạo rồi demo hash mật khẩu',
      },
    },
    {
      tool: 'uuid-generator',
      reason: {
        en: 'Hash a UUID for a shorter fixed-size ID',
        vi: 'Hash UUID cho ID kích thước cố định ngắn hơn',
      },
    },
  ],
};
