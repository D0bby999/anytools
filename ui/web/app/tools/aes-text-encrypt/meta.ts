import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'aes-text-encrypt',
  cluster: 'encoding',
  title: {
    en: 'AES Text Encrypt / Decrypt',
    vi: 'Mã hoá / Giải mã text AES',
    es: 'Cifrar / Descifrar texto AES',
    pt: 'Criptografar / Descriptografar texto AES',
  },
  description: {
    en: 'Encrypt or decrypt a piece of text with a password, using AES-256-GCM and PBKDF2. Runs in your browser — nothing is uploaded.',
    vi: 'Mã hoá hoặc giải mã một đoạn text bằng mật khẩu, dùng AES-256-GCM và PBKDF2. Chạy trong trình duyệt, không tải lên đâu cả.',
    es: 'Cifra o descifra un texto con una contraseña, usando AES-256-GCM y PBKDF2. Todo en tu navegador.',
    pt: 'Criptografe ou descriptografe um texto com uma senha, usando AES-256-GCM e PBKDF2. Tudo no seu navegador.',
  },
  keywords: [
    'aes encrypt text',
    'aes decrypt online',
    'encrypt text with password',
    'aes-256-gcm online',
    'text encryption browser',
    'pbkdf2 aes',
    'password based encryption',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'password-generator',
      reason: {
        en: 'Generate a strong password to encrypt with',
        vi: 'Tạo mật khẩu mạnh để mã hoá',
        es: 'Genera una contraseña fuerte para cifrar',
        pt: 'Gere uma senha forte para criptografar',
      },
    },
    {
      tool: 'base64-encode',
      reason: {
        en: 'Understand the Base64 wrapper this tool outputs',
        vi: 'Hiểu định dạng Base64 mà tool này xuất ra',
        es: 'Entiende el formato Base64 que produce esta herramienta',
        pt: 'Entenda o formato Base64 que esta ferramenta produz',
      },
    },
  ],
};
